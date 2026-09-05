/**
 * Public entry point for the Phase 7 Reality Check continuous-session
 * integration. A consuming application must import only from this file —
 * everything else under realityCheck/ (EngineBridge, scheduler, monitor,
 * config, continuousTypes, continuousSessionApi) is an implementation
 * detail, not part of the public surface.
 */
export { createRealityCheckSession } from './createRealityCheckSession';
