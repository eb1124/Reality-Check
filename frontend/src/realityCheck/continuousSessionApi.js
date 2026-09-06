/**
 * Client for the Phase 7 continuous-session backend
 * (backend/app/continuous_routes.py, under /sessions/continuous/...).
 * Mirrors the existing one-shot client's (../api/sessionApi.js) error
 * shape and same-origin /api proxy convention. Never fabricates a local
 * session/challenge on failure — every function throws a structured error
 * on any non-2xx response instead of returning a guessed value.
 *
 * Phase 9: every function takes an optional trailing `{ apiBaseUrl }`,
 * defaulting to the same-origin `/api` proxy this project's own
 * demo-interview.html relies on. An embedding OA is a genuinely separate
 * web app (its own origin/port) rather than another page of this same Vite
 * dev server, so it cannot rely on that proxy — createRealityCheckSession's
 * own `apiBaseUrl` option threads down to here so such a consumer can point
 * directly at wherever the Reality Check backend is actually deployed
 * (e.g. "http://localhost:8000"). Omitting it reproduces the pre-Phase-9
 * same-origin behavior exactly, which is why every call site in
 * useContinuousVerification.js that doesn't have an apiBaseUrl configured
 * calls these functions with the exact same argument lists as before.
 */
const DEFAULT_BASE = '/api/sessions/continuous';

function resolveBase(apiBaseUrl) {
  return apiBaseUrl ? `${apiBaseUrl.replace(/\/+$/, '')}/sessions/continuous` : DEFAULT_BASE;
}

class ContinuousSessionError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'ContinuousSessionError';
    this.status = status;
    this.body = body;
  }
}

async function request(apiBaseUrl, path, options) {
  let response;
  try {
    response = await fetch(`${resolveBase(apiBaseUrl)}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
  } catch (err) {
    throw new ContinuousSessionError(`Network error calling ${path}: ${err.message}`);
  }
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await response.json() : null;
  if (!response.ok) {
    throw new ContinuousSessionError(`${path} failed (HTTP ${response.status})`, {
      status: response.status,
      body
    });
  }
  return body;
}

/** options: { apiBaseUrl?, externalRef?, disableLightChallenge? } —
 * externalRef is an opaque caller-supplied correlation id (e.g. an
 * assessmentAttemptId), persisted and echoed back verbatim on every
 * subsequent session/report read. disableLightChallenge (Phase 11) is the
 * candidate's own photosensitivity disclosure at the consent gate — when
 * true, the backend scheduler never draws a LIGHT challenge for this
 * session (see backend/app/continuous_models.py's request_next_challenge). */
export function createContinuousSession({ apiBaseUrl, externalRef, disableLightChallenge } = {}) {
  return request(apiBaseUrl, '', {
    method: 'POST',
    body: JSON.stringify({ externalRef: externalRef ?? null, disableLightChallenge: !!disableLightChallenge })
  });
}

export function startContinuousSession(sessionId, { apiBaseUrl } = {}) {
  return request(apiBaseUrl, `/${sessionId}/start`, { method: 'POST' });
}

export function submitEvents(sessionId, events, { apiBaseUrl } = {}) {
  return request(apiBaseUrl, `/${sessionId}/events`, {
    method: 'POST',
    body: JSON.stringify({ events })
  });
}

/** trigger: 'RANDOM' | 'EVENT'. Returns a NextChallenge or NoNextChallenge shape (see continuousTypes.js). */
export function getNextChallenge(sessionId, trigger = 'RANDOM', { apiBaseUrl } = {}) {
  return request(apiBaseUrl, `/${sessionId}/next-challenge?trigger=${trigger}`, { method: 'GET' });
}

export function submitChallengeResult(sessionId, challengeId, { nonce, outcome, detail }, { apiBaseUrl } = {}) {
  return request(apiBaseUrl, `/${sessionId}/challenges/${challengeId}/result`, {
    method: 'POST',
    body: JSON.stringify({ nonce, outcome, detail })
  });
}

/** reason: 'ENDED' | 'CANCELLED' | 'ERROR', defaults to 'ENDED'. Returns the final report. */
export function endContinuousSession(sessionId, reason = 'ENDED', { apiBaseUrl } = {}) {
  return request(apiBaseUrl, `/${sessionId}/end`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  });
}

export function getReport(sessionId, { apiBaseUrl } = {}) {
  return request(apiBaseUrl, `/${sessionId}/report`, { method: 'GET' });
}

export { ContinuousSessionError };
