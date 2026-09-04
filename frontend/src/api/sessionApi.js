/**
 * Minimal client for the Phase 1 verification-session backend
 * (backend/app/routes.py). Proxied in dev via vite.config.js so the browser
 * fetch is same-origin (/api/* -> http://127.0.0.1:8000/*).
 */
const API_BASE = '/api';

/**
 * Creates a new backend-authoritative verification session. Throws a
 * structured error (same {type, title, message, resolution} shape used by
 * useCamera's CAMERA_ERROR_MESSAGES / ErrorBanner) on any failure — network
 * unreachable, non-2xx response, or an unexpected response shape. Never
 * returns a fabricated/local session.
 */
export async function createVerificationSession() {
  let response;
  try {
    response = await fetch(`${API_BASE}/sessions`, { method: 'POST' });
  } catch (err) {
    throw {
      type: 'NetworkError',
      title: 'Backend Unreachable',
      message: 'Could not reach the verification backend to start a session.',
      resolution: 'Confirm the backend server is running (uvicorn app.main:app), then retry.',
      rawError: err.message
    };
  }

  if (!response.ok) {
    throw {
      type: 'BackendError',
      title: 'Session Creation Failed',
      message: `The backend rejected the session request (HTTP ${response.status}).`,
      resolution: 'Retry, or check the backend server logs if this persists.',
      rawError: `HTTP ${response.status}`
    };
  }

  const data = await response.json();
  const validDirection = data?.headTurnDirection === 'LEFT' || data?.headTurnDirection === 'RIGHT';
  if (!data?.sessionId || !validDirection) {
    throw {
      type: 'BackendError',
      title: 'Malformed Session Response',
      message: 'The backend returned an unexpected response shape for session creation.',
      resolution: 'Retry, or check backend/frontend version compatibility.',
      rawError: JSON.stringify(data)
    };
  }

  return data;
}

/**
 * Persists the already-computed client-side verdict (see
 * useVerificationOrchestrator's VERIFICATION_VERDICT) against its backend
 * session, so the session no longer stays PENDING forever once a
 * verification attempt actually concludes. This is best-effort evidence
 * recording, not re-verification — the backend does not independently
 * confirm the measurements, only records what the browser reported (see
 * backend/README.md's trust-boundary note). Callers should treat failures
 * here as non-fatal: the result already shown to the user is unaffected.
 */
export async function submitVerificationResult(sessionId, { outcome, headTurnOutcome, lightChallengeOutcome }) {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outcome, headTurnOutcome, lightChallengeOutcome })
  });

  if (!response.ok) {
    throw new Error(`Result submission failed for session ${sessionId} (HTTP ${response.status})`);
  }

  return response.json();
}
