import { vi } from 'vitest';

/**
 * Test double for the real continuousSessionApi client. Every function is a
 * vi.fn() with a sane default resolution — tests override per-call behavior
 * with mockResolvedValueOnce/mockRejectedValueOnce as needed. Never hits the
 * network.
 */
export const createContinuousSession = vi.fn(() => Promise.resolve({ sessionId: 'test-session-id' }));
export const startContinuousSession = vi.fn(() => Promise.resolve({}));
export const submitEvents = vi.fn(() => Promise.resolve({ accepted: 0 }));
export const getNextChallenge = vi.fn(() => Promise.resolve({ none: true, reason: 'COOLDOWN' }));
export const submitChallengeResult = vi.fn(() => Promise.resolve({}));
export const endContinuousSession = vi.fn(() => Promise.resolve({ riskState: 'INCONCLUSIVE' }));
export const getReport = vi.fn(() => Promise.resolve({ riskState: 'INCONCLUSIVE' }));

export class ContinuousSessionError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'ContinuousSessionError';
    this.status = status;
    this.body = body;
  }
}
