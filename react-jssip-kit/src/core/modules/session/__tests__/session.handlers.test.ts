import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionHandlers } from "../session.handlers";

class FakePeerConnection extends EventTarget {
  iceConnectionState: RTCIceConnectionState = "new";
}

const createIceHandlers = (restartIce: () => boolean, delayMs = 7000) => {
  const emitter = { emit: vi.fn() };
  const handlers = createSessionHandlers({
    emitter: emitter as never,
    state: {
      getState: () => ({ sessionsById: {} }),
      setState: vi.fn(),
    } as never,
    cleanupSession: vi.fn(),
    autoIceRestart: true,
    autoIceRestartMaxAttempts: 1,
    autoIceRestartDisconnectedDelayMs: delayMs,
    autoIceRestartRetryDelayMs: 250,
    restartIce,
    sessionId: "session-1",
  });
  const peerConnection = new FakePeerConnection();
  (handlers.peerconnection as (event: unknown) => void)({
    peerconnection: peerConnection,
  });

  return { emitter, peerConnection };
};

describe("createSessionHandlers auto ICE restart", () => {
  afterEach(() => vi.useRealTimers());

  it("retries after a competing renegotiation rejects the first request", () => {
    vi.useFakeTimers();
    const restartIce = vi
      .fn<() => boolean>()
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const { peerConnection } = createIceHandlers(restartIce);

    peerConnection.iceConnectionState = "failed";
    peerConnection.dispatchEvent(new Event("iceconnectionstatechange"));
    expect(restartIce).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(250);
    expect(restartIce).toHaveBeenCalledTimes(2);

    peerConnection.dispatchEvent(new Event("iceconnectionstatechange"));
    expect(restartIce).toHaveBeenCalledTimes(2);
  });

  it("does not restart a transient disconnected ICE transport", () => {
    vi.useFakeTimers();
    const restartIce = vi.fn<() => boolean>().mockReturnValue(true);
    const { peerConnection } = createIceHandlers(restartIce, 7000);

    peerConnection.iceConnectionState = "disconnected";
    peerConnection.dispatchEvent(new Event("iceconnectionstatechange"));
    vi.advanceTimersByTime(6999);
    expect(restartIce).not.toHaveBeenCalled();

    peerConnection.iceConnectionState = "connected";
    peerConnection.dispatchEvent(new Event("iceconnectionstatechange"));
    vi.advanceTimersByTime(1);
    expect(restartIce).not.toHaveBeenCalled();
  });

  it("cancels the recovery watchdog when ICE reconnects", () => {
    vi.useFakeTimers();
    const restartIce = vi.fn<() => boolean>().mockReturnValue(true);
    const { peerConnection } = createIceHandlers(restartIce);

    peerConnection.iceConnectionState = "failed";
    peerConnection.dispatchEvent(new Event("iceconnectionstatechange"));
    expect(restartIce).toHaveBeenCalledTimes(1);

    peerConnection.iceConnectionState = "connected";
    peerConnection.dispatchEvent(new Event("iceconnectionstatechange"));
    vi.advanceTimersByTime(10_000);
    expect(restartIce).toHaveBeenCalledTimes(1);
  });
});
