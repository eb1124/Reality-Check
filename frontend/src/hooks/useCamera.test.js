globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useCamera } from './useCamera';

// Phase 9: useCamera gained the ability to analyze an externally-supplied
// MediaStream (an embedding OA's own camera, which it also records) instead
// of always acquiring its own via getUserMedia. The critical invariant
// under test throughout this file: Reality Check may stop tracks it
// acquired itself, but must NEVER stop tracks it didn't open — on
// stopCamera(), on unmount, or ever.

function renderHook(initialProps) {
  let hookResult;
  function Harness({ hookProps }) {
    hookResult = useCamera(hookProps);
    return null;
  }
  let renderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(Harness, { hookProps: initialProps }));
  });
  return {
    get current() {
      return hookResult;
    },
    rerender(nextProps) {
      act(() => {
        renderer.update(React.createElement(Harness, { hookProps: nextProps }));
      });
    },
    unmount() {
      act(() => renderer.unmount());
    }
  };
}

function makeFakeStream(trackCount = 2) {
  const tracks = Array.from({ length: trackCount }, () => ({ stop: vi.fn() }));
  return { getTracks: () => tracks };
}

afterEach(() => {
  delete navigator.mediaDevices;
});

describe('useCamera: internally-owned camera (pre-Phase-9 behavior, unchanged)', () => {
  beforeEach(() => {
    navigator.mediaDevices = { getUserMedia: vi.fn(async () => makeFakeStream(2)) };
  });

  it('acquires its own stream via getUserMedia when no externalStream is given', async () => {
    const hook = renderHook();
    await act(async () => {
      await hook.current.startCamera();
    });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(hook.current.isCameraActive).toBe(true);
  });

  it('stops its own tracks on stopCamera()', async () => {
    const hook = renderHook();
    await act(async () => {
      await hook.current.startCamera();
    });
    const acquiredStream = hook.current.stream;
    act(() => {
      hook.current.stopCamera();
    });
    acquiredStream.getTracks().forEach((track) => expect(track.stop).toHaveBeenCalledTimes(1));
    expect(hook.current.isCameraActive).toBe(false);
  });

  it('stops its own tracks on unmount', async () => {
    const hook = renderHook();
    await act(async () => {
      await hook.current.startCamera();
    });
    const acquiredStream = hook.current.stream;
    hook.unmount();
    acquiredStream.getTracks().forEach((track) => expect(track.stop).toHaveBeenCalledTimes(1));
  });
});

describe('useCamera: externally-supplied MediaStream (Phase 9)', () => {
  it('adopts an external stream via startCamera() without ever calling getUserMedia', async () => {
    navigator.mediaDevices = { getUserMedia: vi.fn() };
    const externalStream = makeFakeStream();
    const hook = renderHook({ externalStream });

    await act(async () => {
      await hook.current.startCamera();
    });

    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(hook.current.isCameraActive).toBe(true);
    expect(hook.current.stream).toBe(externalStream);
  });

  it('adopts the external stream live, even without an explicit startCamera() call', () => {
    const externalStream = makeFakeStream();
    const hook = renderHook({ externalStream });
    expect(hook.current.stream).toBe(externalStream);
    expect(hook.current.isCameraActive).toBe(true);
  });

  it('never calls track.stop() on the external stream when stopCamera() is called', async () => {
    const externalStream = makeFakeStream();
    const hook = renderHook({ externalStream });
    await act(async () => {
      await hook.current.startCamera();
    });

    act(() => {
      hook.current.stopCamera();
    });

    externalStream.getTracks().forEach((track) => expect(track.stop).not.toHaveBeenCalled());
    expect(hook.current.isCameraActive).toBe(false);
  });

  it('never calls track.stop() on the external stream when the hook unmounts', async () => {
    const externalStream = makeFakeStream();
    const hook = renderHook({ externalStream });
    await act(async () => {
      await hook.current.startCamera();
    });

    hook.unmount();

    externalStream.getTracks().forEach((track) => expect(track.stop).not.toHaveBeenCalled());
  });

  it('stops a previously-owned internal stream when an external stream is adopted in its place', async () => {
    navigator.mediaDevices = { getUserMedia: vi.fn(async () => makeFakeStream(1)) };
    const hook = renderHook({ externalStream: null });
    await act(async () => {
      await hook.current.startCamera();
    });
    const internalStream = hook.current.stream;
    expect(internalStream).toBeTruthy();

    // Not exercised by EngineBridge today (mediaStream is a fixed prop for a
    // session's lifetime), but proves useCamera doesn't leak a camera it
    // opened itself if a caller ever does switch modes mid-session: the
    // live-adopt effect must stop the stream it owned before switching over.
    const externalStream = makeFakeStream();
    hook.rerender({ externalStream });

    internalStream.getTracks().forEach((track) => expect(track.stop).toHaveBeenCalledTimes(1));
    expect(hook.current.stream).toBe(externalStream);
    externalStream.getTracks().forEach((track) => expect(track.stop).not.toHaveBeenCalled());
  });
});
