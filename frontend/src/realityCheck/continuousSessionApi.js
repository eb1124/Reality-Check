/**
 * Client for the Phase 7 continuous-session backend
 * (backend/app/continuous_routes.py, under /sessions/continuous/...).
 * Mirrors the existing one-shot client's (../api/sessionApi.js) error
 * shape and same-origin /api proxy convention. Never fabricates a local
 * session/challenge on failure — every function throws a structured error
 * on any non-2xx response instead of returning a guessed value.
 */
const API_BASE = '/api/sessions/continuous';

class ContinuousSessionError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'ContinuousSessionError';
    this.status = status;
    this.body = body;
  }
}

async function request(path, options) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
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

export function createContinuousSession() {
  return request('', { method: 'POST' });
}

export function startContinuousSession(sessionId) {
  return request(`/${sessionId}/start`, { method: 'POST' });
}

export function submitEvents(sessionId, events) {
  return request(`/${sessionId}/events`, {
    method: 'POST',
    body: JSON.stringify({ events })
  });
}

/** trigger: 'RANDOM' | 'EVENT'. Returns a NextChallenge or NoNextChallenge shape (see continuousTypes.js). */
export function getNextChallenge(sessionId, trigger = 'RANDOM') {
  return request(`/${sessionId}/next-challenge?trigger=${trigger}`, { method: 'GET' });
}

export function submitChallengeResult(sessionId, challengeId, { nonce, outcome, detail }) {
  return request(`/${sessionId}/challenges/${challengeId}/result`, {
    method: 'POST',
    body: JSON.stringify({ nonce, outcome, detail })
  });
}

/** reason: 'ENDED' | 'CANCELLED' | 'ERROR', defaults to 'ENDED'. Returns the final report. */
export function endContinuousSession(sessionId, reason = 'ENDED') {
  return request(`/${sessionId}/end`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  });
}

export function getReport(sessionId) {
  return request(`/${sessionId}/report`, { method: 'GET' });
}

export { ContinuousSessionError };
