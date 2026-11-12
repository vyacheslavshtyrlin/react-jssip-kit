import { afterEach, describe, expect, it, vi } from "vitest";
import type { RTCSession } from "../../../sip/types";
import { createAudioBindRetry } from "../audio-bind.retry";

type Listener = (...args: unknown[]) => void;

class FakePeerConnection extends EventTarget {}

class FakeSession {
  connection?: RTCPeerConnection;
  private readonly listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener): void {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: string, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of Array.from(this.listeners.get(event) ?? [])) {
      listener(...args);
    }
  }

  listenerCount(): number {
    return Array.from(this.listeners.values()).reduce(
      (count, listeners) => count + listeners.size,
      0
    );
  }
}

const asPeerConnection = (pc: FakePeerConnection): RTCPeerConnection =>
  pc as unknown as RTCPeerConnection;

const asRtcSession = (session: FakeSession): RTCSession =>
  session as unknown as RTCSession;

describe("createAudioBindRetry", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("polls until audio binding succeeds", async () => {
    vi.useFakeTimers();
    const pc = new FakePeerConnection();
    const session = new FakeSession();
    session.connection = asPeerConnection(pc);
    const tryBind = vi
      .fn<(pc: RTCPeerConnection | null) => boolean>()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const onStop = vi.fn();

    createAudioBindRetry({
      session: asRtcSession(session),
      tryBind,
      onStop,
      maxAttempts: 3,
      retryDelayMs: 100,
    });

    expect(tryBind).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(100);
    expect(tryBind).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100);

    expect(tryBind).toHaveBeenCalledTimes(3);
    expect(onStop).toHaveBeenCalledWith(true);
    expect(session.listenerCount()).toBe(0);
  });

  it("reports exhaustion and allows only one event-driven final check", async () => {
    vi.useFakeTimers();
    const pc = new FakePeerConnection();
    const session = new FakeSession();
    session.connection = asPeerConnection(pc);
    const tryBind = vi.fn<() => boolean>().mockReturnValue(false);
    const onExhausted = vi.fn();

    const dispose = createAudioBindRetry({
      session: asRtcSession(session),
      tryBind,
      onExhausted,
      maxAttempts: 2,
      retryDelayMs: 100,
    });
    await vi.advanceTimersByTimeAsync(200);

    expect(onExhausted).toHaveBeenCalledWith(asPeerConnection(pc), 2);
    expect(tryBind).toHaveBeenCalledTimes(3);

    pc.dispatchEvent(new Event("connectionstatechange"));
    pc.dispatchEvent(new Event("iceconnectionstatechange"));
    expect(tryBind).toHaveBeenCalledTimes(4);

    dispose();
  });

  it("can recover on the final event-driven check after exhaustion", async () => {
    vi.useFakeTimers();
    const pc = new FakePeerConnection();
    const session = new FakeSession();
    session.connection = asPeerConnection(pc);
    const tryBind = vi
      .fn<() => boolean>()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const onStop = vi.fn();

    createAudioBindRetry({
      session: asRtcSession(session),
      tryBind,
      onStop,
      maxAttempts: 2,
      retryDelayMs: 100,
    });
    await vi.advanceTimersByTimeAsync(200);
    pc.dispatchEvent(new Event("connectionstatechange"));

    expect(onStop).toHaveBeenCalledWith(true);
    expect(session.listenerCount()).toBe(0);
    pc.dispatchEvent(new Event("connectionstatechange"));
    expect(tryBind).toHaveBeenCalledTimes(4);
  });

  it("cancels retries and detaches listeners when the session ends", async () => {
    vi.useFakeTimers();
    const pc = new FakePeerConnection();
    const session = new FakeSession();
    session.connection = asPeerConnection(pc);
    const tryBind = vi.fn<() => boolean>().mockReturnValue(false);
    const onStop = vi.fn();

    createAudioBindRetry({
      session: asRtcSession(session),
      tryBind,
      onStop,
      retryDelayMs: 100,
    });
    session.emit("ended");
    await vi.runAllTimersAsync();

    expect(onStop).toHaveBeenCalledWith(false);
    expect(tryBind).toHaveBeenCalledOnce();
    expect(session.listenerCount()).toBe(0);
    pc.dispatchEvent(new Event("connectionstatechange"));
    expect(tryBind).toHaveBeenCalledOnce();
  });

  it("moves state listeners to a replacement PeerConnection", () => {
    const firstPc = new FakePeerConnection();
    const secondPc = new FakePeerConnection();
    const session = new FakeSession();
    const tryBind = vi.fn<() => boolean>().mockReturnValue(false);

    const dispose = createAudioBindRetry({
      session: asRtcSession(session),
      tryBind,
      retryDelayMs: 10_000,
    });
    session.emit("peerconnection", {
      peerconnection: asPeerConnection(firstPc),
    });
    session.emit("peerconnection", {
      peerconnection: asPeerConnection(secondPc),
    });
    const callsBeforeStateEvents = tryBind.mock.calls.length;

    firstPc.dispatchEvent(new Event("connectionstatechange"));
    expect(tryBind).toHaveBeenCalledTimes(callsBeforeStateEvents);
    secondPc.dispatchEvent(new Event("connectionstatechange"));
    expect(tryBind).toHaveBeenCalledTimes(callsBeforeStateEvents + 1);

    dispose();
  });

  it("uses track events only when requested", () => {
    const pc = new FakePeerConnection();
    const session = new FakeSession();
    session.connection = asPeerConnection(pc);
    const tryBind = vi.fn<() => boolean>().mockReturnValue(false);

    const dispose = createAudioBindRetry({
      session: asRtcSession(session),
      tryBind,
      listenPcTrackEvent: true,
      retryDelayMs: 10_000,
    });
    pc.dispatchEvent(new Event("track"));

    expect(tryBind).toHaveBeenCalledTimes(2);
    dispose();
    pc.dispatchEvent(new Event("track"));
    expect(tryBind).toHaveBeenCalledTimes(2);
  });

  it("stops successfully when confirmed binding succeeds", () => {
    const pc = new FakePeerConnection();
    const session = new FakeSession();
    session.connection = asPeerConnection(pc);
    const tryBind = vi.fn<() => boolean>().mockReturnValue(true);
    const onStop = vi.fn();

    createAudioBindRetry({
      session: asRtcSession(session),
      tryBind,
      onStop,
    });
    session.emit("confirmed");

    expect(tryBind).toHaveBeenCalledTimes(2);
    expect(onStop).toHaveBeenCalledWith(true);
    expect(session.listenerCount()).toBe(0);
  });
});
