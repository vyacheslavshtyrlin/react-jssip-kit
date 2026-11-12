import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RTCSession } from "../../../sip/types";
import { MicRecoveryManager } from "../mic-recovery.manager";
import type { WebRTCSessionController } from "../webrtc-session.controller";

type Listener = (...args: unknown[]) => void;

class FakeTrack extends EventTarget {
  readonly kind = "audio";
  readonly id: string;
  readyState: MediaStreamTrackState;

  constructor(id: string, readyState: MediaStreamTrackState = "live") {
    super();
    this.id = id;
    this.readyState = readyState;
  }
}

class FakeMediaStream {
  constructor(private readonly tracks: MediaStreamTrack[] = []) {}

  getTracks(): MediaStreamTrack[] {
    return [...this.tracks];
  }

  getAudioTracks(): MediaStreamTrack[] {
    return [...this.tracks];
  }
}

class FakePeerConnection extends EventTarget {
  connectionState: RTCPeerConnectionState = "connected";
  iceConnectionState: RTCIceConnectionState = "connected";
  senders: RTCRtpSender[] = [];

  getSenders(): RTCRtpSender[] {
    return this.senders;
  }
}

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

  listenerCount(): number {
    return Array.from(this.listeners.values()).reduce(
      (count, listeners) => count + listeners.size,
      0
    );
  }
}

const asTrack = (track: FakeTrack): MediaStreamTrack =>
  track as unknown as MediaStreamTrack;

const asStream = (stream: FakeMediaStream): MediaStream =>
  stream as unknown as MediaStream;

const asPeerConnection = (pc: FakePeerConnection): RTCPeerConnection =>
  pc as unknown as RTCPeerConnection;

const asRtcSession = (session: FakeSession): RTCSession =>
  session as unknown as RTCSession;

const createHarness = (options?: {
  track?: FakeTrack | null;
  senderTrack?: FakeTrack | null;
  muted?: boolean;
}) => {
  const track =
    options?.track === undefined ? new FakeTrack("local") : options.track;
  const senderTrack =
    options?.senderTrack === undefined ? track : options.senderTrack;
  const stream = new FakeMediaStream(track ? [asTrack(track)] : []);
  const pc = new FakePeerConnection();
  if (senderTrack) {
    pc.senders = [
      {
        track: asTrack(senderTrack),
      } as RTCRtpSender,
    ];
  }
  const session = new FakeSession();
  session.connection = asPeerConnection(pc);
  const rtc = {
    mediaStream: asStream(stream),
    replaceAudioTrack: vi.fn().mockResolvedValue(true),
  } as unknown as WebRTCSessionController;
  const deps = {
    getRtc: vi.fn(() => rtc),
    getSession: vi.fn(() => asRtcSession(session)),
    getSessionState: vi.fn(() => ({ muted: options?.muted ?? false })),
    setSessionMedia: vi.fn(),
    onDrop: vi.fn(),
  };

  return { deps, pc, rtc, session, senderTrack, stream, track };
};

describe("MicRecoveryManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubGlobal("MediaStream", FakeMediaStream);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("validates polling configuration", () => {
    const { deps } = createHarness();
    const manager = new MicRecoveryManager(deps);

    expect(() => manager.configure({ intervalMs: 0 })).toThrow(RangeError);
    expect(() => manager.configure({ intervalMs: Number.NaN })).toThrow(
      "micRecoveryIntervalMs"
    );
    expect(() => manager.configure({ maxRetries: -1 })).toThrow(RangeError);
    expect(() => manager.configure({ maxRetries: 1.5 })).toThrow(
      "micRecoveryMaxRetries"
    );
    expect(() =>
      manager.configure({ intervalMs: 100, maxRetries: Infinity })
    ).not.toThrow();
  });

  it("does nothing while recovery is disabled", async () => {
    const { deps } = createHarness({ track: new FakeTrack("dead", "ended") });
    const manager = new MicRecoveryManager(deps);

    manager.enable("session-1");
    await vi.runAllTimersAsync();

    expect(deps.getRtc).not.toHaveBeenCalled();
    expect(deps.onDrop).not.toHaveBeenCalled();
  });

  it("reports an already-ended track immediately", () => {
    const { deps, session } = createHarness({
      track: new FakeTrack("dead", "ended"),
      senderTrack: null,
    });
    const manager = new MicRecoveryManager(deps);
    manager.configure({ enabled: true, intervalMs: 100 });

    const stop = manager.enable("session-1");

    expect(deps.onDrop).toHaveBeenCalledWith("session-1", false, false);
    stop();
    expect(session.listenerCount()).toBe(0);
  });

  it("reacts to track ended unless the session is muted", () => {
    const liveTrack = new FakeTrack("live");
    const active = createHarness({ track: liveTrack });
    const activeManager = new MicRecoveryManager(active.deps);
    activeManager.configure({ enabled: true });
    const stopActive = activeManager.enable("active");

    liveTrack.dispatchEvent(new Event("ended"));
    expect(active.deps.onDrop).toHaveBeenCalledWith("active", false, false);
    stopActive();

    const mutedTrack = new FakeTrack("muted");
    const muted = createHarness({ track: mutedTrack, muted: true });
    const mutedManager = new MicRecoveryManager(muted.deps);
    mutedManager.configure({ enabled: true });
    const stopMuted = mutedManager.enable("muted");

    mutedTrack.dispatchEvent(new Event("ended"));
    expect(muted.deps.onDrop).not.toHaveBeenCalled();
    stopMuted();
  });

  it("repairs a dead sender from a live local track after warmup", async () => {
    const localTrack = new FakeTrack("local");
    const deadSenderTrack = new FakeTrack("sender", "ended");
    const { deps, rtc } = createHarness({
      track: localTrack,
      senderTrack: deadSenderTrack,
    });
    const manager = new MicRecoveryManager(deps);
    manager.configure({ enabled: true, intervalMs: 100, maxRetries: 1 });

    manager.enable("session-1");
    await vi.advanceTimersByTimeAsync(2_000);

    expect(deps.onDrop).toHaveBeenCalledWith("session-1", true, false);
    expect(rtc.replaceAudioTrack).toHaveBeenCalledWith(asTrack(localTrack));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(rtc.replaceAudioTrack).toHaveBeenCalledOnce();
  });

  it("synchronizes a live sender when the local stream has no track", async () => {
    const senderTrack = new FakeTrack("sender");
    const { deps } = createHarness({ track: null, senderTrack });
    const manager = new MicRecoveryManager(deps);
    manager.configure({ enabled: true, intervalMs: 100 });

    const stop = manager.enable("session-1");
    await vi.advanceTimersByTimeAsync(500);

    expect(deps.setSessionMedia).toHaveBeenCalledOnce();
    const syncedStream = deps.setSessionMedia.mock.calls[0]?.[1];
    expect(syncedStream?.getAudioTracks()).toEqual([asTrack(senderTrack)]);
    stop();
  });

  it("does not recover while the PeerConnection is still negotiating", async () => {
    const deadSenderTrack = new FakeTrack("sender", "ended");
    const { deps, pc, rtc } = createHarness({
      track: new FakeTrack("local"),
      senderTrack: deadSenderTrack,
    });
    pc.connectionState = "connecting";
    pc.iceConnectionState = "checking";
    const manager = new MicRecoveryManager(deps);
    manager.configure({ enabled: true, intervalMs: 100 });

    const stop = manager.enable("session-1");
    await vi.advanceTimersByTimeAsync(3_000);

    expect(deps.onDrop).not.toHaveBeenCalled();
    expect(rtc.replaceAudioTrack).not.toHaveBeenCalled();
    stop();
  });

  it("supports synchronous disable from the drop callback", async () => {
    const { deps, rtc } = createHarness({
      track: new FakeTrack("local"),
      senderTrack: new FakeTrack("sender", "ended"),
    });
    const manager = new MicRecoveryManager(deps);
    manager.configure({ enabled: true, intervalMs: 100 });
    deps.onDrop.mockImplementation((sessionId) => {
      manager.disable(sessionId);
    });

    manager.enable("session-1");
    await vi.advanceTimersByTimeAsync(2_000);

    expect(deps.onDrop).toHaveBeenCalledOnce();
    expect(rtc.replaceAudioTrack).not.toHaveBeenCalled();
    expect(manager.disable("session-1")).toBe(false);
  });

  it("cleans up every active session", () => {
    const first = createHarness();
    const second = createHarness();
    const manager = new MicRecoveryManager({
      getRtc: (id) => (id === "first" ? first.rtc : second.rtc),
      getSession: (id) =>
        asRtcSession(id === "first" ? first.session : second.session),
      getSessionState: () => ({ muted: false }),
      setSessionMedia: vi.fn(),
      onDrop: vi.fn(),
    });
    manager.configure({ enabled: true });
    manager.enable("first");
    manager.enable("second");

    manager.cleanupAll();

    expect(first.session.listenerCount()).toBe(0);
    expect(second.session.listenerCount()).toBe(0);
    expect(manager.disable("first")).toBe(false);
    expect(manager.disable("second")).toBe(false);
  });
});
