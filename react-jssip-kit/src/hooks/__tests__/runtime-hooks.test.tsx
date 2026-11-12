// @vitest-environment jsdom

import type { ComponentType, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CallStatus, SipStatus } from "../../core/contracts/state";
import type {
  InternalSipState,
  SipSessionState,
} from "../../core/contracts/state";
import type { SipKernel } from "../../core/kernel";
import type {
  MicDropPayload,
  SessionIceFailedPayload,
  SessionIceRecoveryExhaustedPayload,
} from "../../core/sip/types";
import { SipProvider } from "../../provider";
import { useCallQuality } from "../useCallQuality";
import { useCallTimer } from "../useCallTimer";
import { useMicDrop } from "../useMicDrop";
import { useSessionIceFailed } from "../useSessionIceFailed";
import { useSessionIceRecoveryExhausted } from "../useSessionIceRecoveryExhausted";
import { useSessionMedia } from "../useSessionMedia";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots = new Set<{ container: HTMLElement; root: Root }>();

function cleanup() {
  for (const mounted of mountedRoots) {
    act(() => mounted.root.unmount());
    mounted.container.remove();
  }
  mountedRoots.clear();
}

function renderHook<TResult>(
  callback: () => TResult,
  wrapper: ComponentType<{ children: ReactNode }>
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const mounted = { container, root };
  mountedRoots.add(mounted);
  const result = {} as { current: TResult };
  const Hook = () => {
    result.current = callback();
    return null;
  };

  function render() {
    const Wrapper = wrapper;
    root.render(
      <Wrapper>
        <Hook />
      </Wrapper>
    );
  }

  act(render);
  return {
    result,
    unmount() {
      if (!mountedRoots.delete(mounted)) return;
      act(() => root.unmount());
      container.remove();
    },
  };
}

const createSession = (
  id: string,
  status: SipSessionState["status"],
  acceptedAt: number | null = null
): SipSessionState => ({
  id,
  status,
  direction: "remote",
  from: "100",
  to: "200",
  muted: false,
  acceptedAt,
  headers: {},
});

type PeerObserver = (peerConnection: RTCPeerConnection | null) => void;

const createHarness = (sessions: SipSessionState[] = []) => {
  let state: InternalSipState = {
    sipStatus: SipStatus.Connected,
    error: null,
    sessions,
    sessionsById: Object.fromEntries(
      sessions.map((session) => [session.id, session])
    ),
    sessionIds: sessions.map((session) => session.id),
  };
  const subscribers = new Set<() => void>();
  let peerObserver: PeerObserver | undefined;
  const offPeerConnection = vi.fn();
  const observePeerConnection = vi.fn(
    (_sessionId: string, observer: PeerObserver) => {
      peerObserver = observer;
      return offPeerConnection;
    }
  );
  const buildRemoteStream = vi.fn<
    (peerConnection: RTCPeerConnection | null) => MediaStream | null
  >(() => null);
  const onMicDrop = vi.fn<
    (handler: (payload: MicDropPayload) => void) => () => void
  >(() => vi.fn());
  const onSessionIceFailed = vi.fn<
    (handler: (payload: SessionIceFailedPayload) => void) => () => void
  >(() => vi.fn());
  const onSessionIceRecoveryExhausted = vi.fn<
    (
      handler: (payload: SessionIceRecoveryExhaustedPayload) => void
    ) => () => void
  >(() => vi.fn());
  const kernel = {
    store: {
      getState: () => state,
      subscribe: (listener: () => void) => {
        subscribers.add(listener);
        return () => subscribers.delete(listener);
      },
    },
    events: {
      onMicDrop,
      onSessionIceFailed,
      onSessionIceRecoveryExhausted,
    },
    media: {
      getSession: vi.fn((id: string) => ({ id })),
      observePeerConnection,
      buildRemoteStream,
    },
  } as unknown as SipKernel;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SipProvider kernel={kernel}>{children}</SipProvider>
  );
  const setState = (partial: Partial<InternalSipState>) => {
    state = { ...state, ...partial };
    subscribers.forEach((listener) => listener());
  };

  return {
    buildRemoteStream,
    getPeerObserver: () => peerObserver,
    offPeerConnection,
    observePeerConnection,
    onMicDrop,
    onSessionIceFailed,
    onSessionIceRecoveryExhausted,
    setState,
    wrapper,
  };
};

class FakePeerConnection extends EventTarget {
  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState: RTCIceConnectionState = "new";
  receivers: Array<{ track: MediaStreamTrack | null }> = [];
  getStats = vi.fn<() => Promise<RTCStatsReport>>();

  getReceivers() {
    return this.receivers as RTCRtpReceiver[];
  }
}

const track = (id: string, kind: "audio" | "video") =>
  ({ id, kind }) as MediaStreamTrack;

const stream = (...tracks: MediaStreamTrack[]) =>
  ({ getTracks: () => tracks }) as MediaStream;

const stats = (...entries: RTCStats[]) => {
  const report = new Map(entries.map((entry, index) => [String(index), entry]));
  return report as unknown as RTCStatsReport;
};

describe("SIP runtime hooks", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("observes the active session media and cleans peer listeners", () => {
    const ringing = createSession("ringing", CallStatus.Ringing);
    const active = createSession("active", CallStatus.Active);
    const harness = createHarness([ringing, active]);
    const audio = track("audio-1", "audio");
    const video = track("video-1", "video");
    const remoteStream = stream(audio, video);
    const pc = new FakePeerConnection();
    pc.receivers = [{ track: audio }, { track: video }];
    harness.buildRemoteStream.mockReturnValue(remoteStream);
    const removeEventListener = vi.spyOn(pc, "removeEventListener");

    const { result, unmount } = renderHook(
      () => useSessionMedia(),
      harness.wrapper
    );
    act(() => harness.getPeerObserver()?.(pc as unknown as RTCPeerConnection));

    expect(harness.observePeerConnection).toHaveBeenCalledWith(
      "active",
      expect.any(Function)
    );
    expect(result.current.sessionId).toBe("active");
    expect(result.current.peerConnection).toBe(pc);
    expect(result.current.remoteStream).toBe(remoteStream);
    expect(result.current.audioTracks).toEqual([audio]);

    pc.receivers.push({ track: track("audio-2", "audio") });
    pc.dispatchEvent(new Event("track"));
    expect(harness.buildRemoteStream).toHaveBeenCalledTimes(2);

    unmount();
    expect(harness.offPeerConnection).toHaveBeenCalledOnce();
    expect(removeEventListener).toHaveBeenCalledWith(
      "track",
      expect.any(Function)
    );
  });

  it("resets media when no session or peer connection is available", () => {
    const harness = createHarness();
    const { result } = renderHook(() => useSessionMedia(), harness.wrapper);

    expect(result.current).toEqual({
      sessionId: "",
      session: null,
      peerConnection: null,
      remoteStream: null,
      audioTracks: [],
    });
    expect(harness.observePeerConnection).not.toHaveBeenCalled();
  });

  it("tracks elapsed call time and clears it when the call resets", () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);
    const active = createSession("active", CallStatus.Active, 2_000);
    const harness = createHarness([active]);
    const { result } = renderHook(() => useCallTimer(), harness.wrapper);

    expect(result.current).toBe(3);
    vi.setSystemTime(7_000);
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current).toBe(6);

    const reset = { ...active, acceptedAt: null };
    act(() =>
      harness.setState({
        sessions: [reset],
        sessionsById: { active: reset },
      })
    );
    expect(result.current).toBeNull();
  });

  it("forwards mic and ICE recovery events and unsubscribes", () => {
    const harness = createHarness();
    const micHandler = vi.fn();
    const iceHandler = vi.fn();
    const exhaustedHandler = vi.fn();
    const offMic = vi.fn();
    const offIce = vi.fn();
    const offExhausted = vi.fn();
    harness.onMicDrop.mockReturnValue(offMic);
    harness.onSessionIceFailed.mockReturnValue(offIce);
    harness.onSessionIceRecoveryExhausted.mockReturnValue(offExhausted);
    const { unmount } = renderHook(() => {
      useMicDrop(micHandler);
      useSessionIceFailed(iceHandler);
      useSessionIceRecoveryExhausted(exhaustedHandler);
    }, harness.wrapper);
    const micCallback = harness.onMicDrop.mock.calls[0]?.[0] as
      | ((payload: MicDropPayload) => void)
      | undefined;
    const iceCallback = harness.onSessionIceFailed.mock.calls[0]?.[0] as
      | ((payload: SessionIceFailedPayload) => void)
      | undefined;
    const exhaustedCallback = harness.onSessionIceRecoveryExhausted.mock
      .calls[0]?.[0] as
      | ((payload: SessionIceRecoveryExhaustedPayload) => void)
      | undefined;

    micCallback?.({ sessionId: "s1", trackLive: false, senderLive: true });
    iceCallback?.({ sessionId: "s1" });
    exhaustedCallback?.({
      sessionId: "s1",
      attempts: 2,
      maxAttempts: 2,
      source: "failed",
    });
    expect(micHandler).toHaveBeenCalledOnce();
    expect(iceHandler).toHaveBeenCalledOnce();
    expect(exhaustedHandler).toHaveBeenCalledOnce();

    unmount();
    expect(offMic).toHaveBeenCalledOnce();
    expect(offIce).toHaveBeenCalledOnce();
    expect(offExhausted).toHaveBeenCalledOnce();
  });

  it("computes call quality from audio and candidate-pair stats", async () => {
    vi.useFakeTimers();
    const active = createSession("active", CallStatus.Active);
    const harness = createHarness([active]);
    const pc = new FakePeerConnection();
    pc.getStats.mockResolvedValue(
      stats(
        {
          type: "inbound-rtp",
          kind: "audio",
          jitter: 0.01,
          packetsReceived: 100,
          packetsLost: 0,
        } as unknown as RTCStats,
        {
          type: "candidate-pair",
          state: "succeeded",
          currentRoundTripTime: 0.1,
        } as unknown as RTCStats
      )
    );
    const { result } = renderHook(() => useCallQuality(), harness.wrapper);

    await act(async () => {
      harness.getPeerObserver()?.(pc as unknown as RTCPeerConnection);
      await Promise.resolve();
    });

    expect(result.current).toEqual({
      rtt: 100,
      packetLoss: 0,
      jitter: 10,
      level: "good",
    });

    pc.getStats.mockResolvedValue(
      stats({
        type: "inbound-rtp",
        kind: "audio",
        jitter: 0.08,
        packetsReceived: 101,
        packetsLost: 2,
      } as unknown as RTCStats)
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(result.current?.level).toBe("poor");
    expect(result.current?.packetLoss).toBeCloseTo(2 / 3);
  });
});
