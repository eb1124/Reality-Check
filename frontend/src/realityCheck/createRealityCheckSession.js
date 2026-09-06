import React, { createRef } from 'react';
import ReactDOM from 'react-dom/client';
import EngineBridge from './EngineBridge';

/**
 * The public integration interface for embedding Reality Check into another
 * application (Phase 7 spec §9, formalized as the external-integration
 * contract in Phase 9). This is the ONLY module a consuming application
 * should import — it deliberately does not re-export MediaPipe, the
 * challenge engines, the orchestrator, the scheduler/monitor, or
 * risk-scoring internals (see EngineBridge.jsx, which composes all of that
 * but is never exported from this file).
 *
 * Internally mounts a hidden React root wrapping EngineBridge, which
 * itself reuses the existing camera/MediaPipe/challenge-engine hooks
 * unmodified — this project's real-time vision code is React-hook-based,
 * so a small React tree is how that gets bridged into a plain imperative
 * API, not a reimplementation of any of it.
 *
 * @param {object} [options]
 * @param {HTMLVideoElement} [options.videoElement] - Optional. If given,
 *   the live camera stream (whichever source it came from — see
 *   `mediaStream` below) is mirrored onto it for display. Independent of
 *   `mediaStream`: even in internally-owned-camera mode, this is purely a
 *   convenience so the caller doesn't need its own reference to the stream
 *   just to show a preview.
 * @param {MediaStream} [options.mediaStream] - Optional. An
 *   already-open, externally-owned camera MediaStream (e.g. one an
 *   embedding online-assessment app opened itself via its own
 *   getUserMedia call so it can record the candidate). When supplied,
 *   Reality Check analyzes this exact stream instead of requesting its
 *   own — it never calls getUserMedia and never calls `track.stop()` on
 *   any of this stream's tracks, on end() or otherwise. The stream's
 *   lifecycle belongs entirely to the caller for as long as this session
 *   exists. Omit this to keep the original behavior: Reality Check
 *   acquires and owns its own camera (used by this project's own
 *   demo-interview.html).
 * @param {string} [options.apiBaseUrl] - Optional. Overrides the
 *   same-origin `/api` proxy this project's own demo relies on (see
 *   vite.config.js) with an absolute backend origin (e.g.
 *   "http://localhost:8000") — needed by any consumer that is a genuinely
 *   separate web app rather than another page of this same dev server.
 *   The backend enables permissive CORS specifically for this case (see
 *   backend/app/main.py).
 * @param {string} [options.externalRef] - Optional. An opaque
 *   caller-supplied correlation id — e.g. the OA's own assessmentAttemptId
 *   — attached once at session creation and echoed back on every session
 *   read and in the final report, so the OA can associate
 *   `assessmentAttemptId <-> realityCheckSessionId` without Reality Check
 *   depending on the OA's own data model. Max 200 characters.
 * @param {boolean} [options.disableLightChallenge] - Optional, default
 *   false. Set true when the candidate has disclosed photosensitive
 *   epilepsy or a sensitivity to flashing/bright lights (see
 *   ContinuousConsentGate.jsx) — the backend will then never draw a LIGHT
 *   challenge for this session. Head Turn (and Depth/Proximity, where
 *   enabled) are unaffected; the session's risk/report scoring degrades
 *   cleanly to non-Light evidence exactly as it already does whenever no
 *   LIGHT challenge happens to run.
 * @param {object} [options.config] - Accepted for interface completeness;
 *   this build's timing/threshold profile is chosen once, at import time,
 *   via VITE_REALITY_CHECK_ENV (see realityCheck/config.js) — there is
 *   currently no per-session override.
 * @returns {{
 *   start: () => Promise<{ sessionId: string|null }>,
 *   on: (type: 'event'|'challenge', handler: (payload: object) => void) => void,
 *   getStatus: () => { state: string, riskState: string|null, challengesRun: number, sessionId: string|null },
 *   end: (reason?: 'ENDED'|'CANCELLED'|'ERROR') => Promise<object|null>
 * }}
 */
export function createRealityCheckSession({ videoElement, mediaStream, apiBaseUrl, externalRef, disableLightChallenge } = {}) {
  const listeners = { event: [], challenge: [] };
  let status = { state: 'IDLE', riskState: null, challengesRun: 0, sessionId: null };
  let started = false;
  let ended = false;
  let container = null;
  let root = null;
  const bridgeRef = createRef();

  function emit(type, payload) {
    for (const handler of listeners[type] || []) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`Reality Check "${type}" listener threw:`, err);
      }
    }
  }

  function mount() {
    container = document.createElement('div');
    container.setAttribute('data-reality-check-engine', '');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    root.render(
      React.createElement(EngineBridge, {
        ref: bridgeRef,
        videoElement,
        mediaStream,
        apiBaseUrl,
        externalRef,
        disableLightChallenge,
        onStatus: (s) => { status = s; },
        onEvent: (e) => emit('event', e),
        onChallenge: (c) => emit('challenge', c),
        onReport: () => {} // consumed via end()'s return value, not a listener
      })
    );
  }

  function unmount() {
    root?.unmount();
    container?.remove();
    root = null;
    container = null;
  }

  /**
   * Waits for `bridgeRef.current` to be populated by React's commit of the
   * hidden root. A single `setTimeout(..., 0)` tick is NOT reliable here:
   * it only covers the case where React's Scheduler (which uses a
   * MessageChannel task, not a timer) happens to flush before that timer
   * fires. In a real browser, concurrent main-thread work from camera
   * acquisition and MediaPipe WASM loading can delay that commit well
   * past one tick, so a fixed single wait silently produces a no-op
   * start() (this was a real, reproduced bug — see EngineBridge.jsx's
   * imperative handle never getting called). Polling with a generous
   * timeout is what actually waits for the commit rather than gambling on
   * scheduler timing.
   */
  function waitForBridge(timeoutMs = 10000, intervalMs = 20) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      (function poll() {
        if (bridgeRef.current) return resolve();
        if (Date.now() >= deadline) {
          return reject(new Error('Reality Check failed to initialize (engine did not mount in time).'));
        }
        setTimeout(poll, intervalMs);
      })();
    });
  }

  return {
    /**
     * Starts continuous monitoring. Idempotent against a second call
     * (a no-op once already started). Resolves once the backend session
     * exists and monitoring is active.
     * @returns {Promise<{ sessionId: string|null }>} sessionId is the
     *   backend-issued continuous-session id — store it immediately
     *   against your own assessment/attempt record; it is also always
     *   available afterwards via getStatus().sessionId.
     */
    async start() {
      if (started) return { sessionId: bridgeRef.current?.getStatus()?.sessionId ?? null };
      started = true;
      mount();
      // Wait for the hidden root to actually commit before invoking the
      // imperative handle — see waitForBridge()'s docstring.
      await waitForBridge();
      const result = await bridgeRef.current?.start();
      return result ?? { sessionId: null };
    },

    /**
     * Subscribes to a stable event feed. 'event' = passive/informational
     * and risk-relevant occurrences (face_missing, camera interruptions,
     * etc — see continuousTypes.js's EVENT_TYPES for the fixed
     * vocabulary); 'challenge' = challenge lifecycle
     * ({status:'started'|'passed'|'failed', type}). No 'off' — this
     * integration is one session per createRealityCheckSession() call;
     * call end() (which unmounts everything, listeners included) rather
     * than unsubscribing individual handlers mid-session.
     */
    on(type, handler) {
      if (!listeners[type]) {
        throw new Error(`Unknown Reality Check event type: "${type}" (expected "event" or "challenge")`);
      }
      listeners[type].push(handler);
    },

    getStatus() {
      return bridgeRef.current?.getStatus() ?? status;
    },

    /**
     * Ends the session and returns the final integrity report. Idempotent:
     * a second call (or any call after the session was never started)
     * resolves to null without re-contacting the backend or re-running
     * teardown. Always releases Reality Check's own resources (MediaPipe,
     * timers, listeners, the hidden React root); an externally-supplied
     * `mediaStream` (see the constructor option above) is never stopped
     * here — that stream's owner decides when to stop it, independently.
     */
    async end(reason = 'ENDED') {
      if (ended) return null;
      ended = true;
      const report = started ? await bridgeRef.current?.end(reason) : null;
      // Let the ENDED state's final render — and therefore the onStatus
      // callback that updates the getStatus() fallback below — commit
      // before tearing the root down. Without this, a consumer calling
      // getStatus() immediately after end() resolves could still observe
      // a stale pre-ENDED snapshot (the last one committed before end()
      // was called), since unmount() would otherwise race React's own
      // scheduling of that final update.
      await new Promise((resolve) => setTimeout(resolve, 0));
      unmount();
      return report;
    }
  };
}
