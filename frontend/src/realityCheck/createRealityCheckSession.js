import React, { createRef } from 'react';
import ReactDOM from 'react-dom/client';
import EngineBridge from './EngineBridge';

/**
 * The Phase 7 public integration interface (spec §9). This is the ONLY
 * module a consuming application should import — it deliberately does not
 * re-export MediaPipe, the challenge engines, the orchestrator, the
 * scheduler/monitor, or risk-scoring internals (see EngineBridge.jsx,
 * which composes all of that but is never exported from this file).
 *
 * Internally mounts a hidden React root wrapping EngineBridge, which
 * itself reuses the existing camera/MediaPipe/challenge-engine hooks
 * unmodified — this project's real-time vision code is React-hook-based,
 * so a small React tree is how that gets bridged into a plain imperative
 * API, not a reimplementation of any of it.
 *
 * @param {{ videoElement?: HTMLVideoElement, apiBaseUrl?: string, config?: object }} options
 *   videoElement — optional; if given, the live camera stream is mirrored
 *   onto it for display. apiBaseUrl/config are accepted for interface
 *   completeness; this build talks to the same-origin /api proxy
 *   (see vite.config.js) and the dev/prod profile in realityCheck/config.js
 *   — a future multi-deployment build could thread them through here.
 */
export function createRealityCheckSession({ videoElement } = {}) {
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

  return {
    async start() {
      if (started) return;
      started = true;
      mount();
      // Let the hidden root render before invoking the imperative handle.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await bridgeRef.current?.start();
    },

    on(type, handler) {
      if (!listeners[type]) {
        throw new Error(`Unknown Reality Check event type: "${type}" (expected "event" or "challenge")`);
      }
      listeners[type].push(handler);
    },

    getStatus() {
      return bridgeRef.current?.getStatus() ?? status;
    },

    async end(reason = 'ENDED') {
      if (ended) return null;
      ended = true;
      const report = started ? await bridgeRef.current?.end(reason) : null;
      unmount();
      return report;
    }
  };
}
