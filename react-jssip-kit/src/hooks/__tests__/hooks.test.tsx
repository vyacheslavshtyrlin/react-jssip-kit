// @vitest-environment jsdom

import type { ComponentType, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CallStatus, SipStatus } from "../../core/contracts/state";
import type {
  InternalSipState,
  SipSessionState,
  SipState,
} from "../../core/contracts/state";
import type { SipKernel } from "../../core/kernel";
import type { UAEventPayload } from "../../core/sip/types";
import { SipProvider } from "../../provider";
import { useSipKernel } from "../useSip";
import { useSipActions } from "../useSipActions";
import { useSipEvent, useSipSessionEvent } from "../useSipEvent";
import { useSipInternalSelector } from "../useSipInternalSelector";
import { useSipMessages } from "../useSipMessages";
import { useSipSelector } from "../useSipSelector";
import { useActiveSipSession, useSipSession } from "../useSipSession";
import { useSipSessions } from "../useSipSessions";
import { useSipState } from "../useSipState";

const mountedRoots = new Set<{ container: HTMLElement; root: Root }>();

function cleanup() {
  for (const mounted of mountedRoots) {
    act(() => mounted.root.unmount());
    mounted.container.remove();
  }
  mountedRoots.clear();
}

function renderHook<TResult, TProps = undefined>(
  callback: (props: TProps) => TResult,
  options: {
    initialProps?: TProps;
    wrapper?: ComponentType<{ children: ReactNode }>;
  } = {}
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const mounted = { container, root };
  mountedRoots.add(mounted);
  let props = options.initialProps as TProps;
  const result = {} as { current: TResult };

  const Hook = () => {
    result.current = callback(props);
    return null;
  };
  const render = () => {
    const hook = <Hook />;
    const Wrapper = options.wrapper;
    root.render(Wrapper ? <Wrapper>{hook}</Wrapper> : hook);
  };

  act(render);

  return {
    result,
    rerender(nextProps?: TProps) {
      if (nextProps !== undefined) props = nextProps;
      act(render);
    },
    unmount() {
      if (!mountedRoots.delete(mounted)) return;
      act(() => root.unmount());
      container.remove();
    },
  };
}

const createSession = (
  id: string,
  status: SipSessionState["status"] = CallStatus.Ringing
): SipSessionState => ({
  id,
  status,
  direction: "remote",
  from: "100",
  to: "200",
  muted: false,
  acceptedAt: null,
  headers: {},
});

const initialState = (): InternalSipState => ({
  sipStatus: SipStatus.Disconnected,
  error: null,
  sessions: [],
  sessionsById: {},
  sessionIds: [],
});

type EventHandler = (payload?: unknown) => void;
type ConnectedHandler = (payload?: UAEventPayload<"connected">) => void;

const createHarness = () => {
  let state = initialState();
  const subscribers = new Set<() => void>();
  const subscribe = vi.fn((listener: () => void) => {
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  });
  const commands = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    register: vi.fn(),
    setDebug: vi.fn(),
    call: vi.fn(),
    sendMessage: vi.fn(),
    sendOptions: vi.fn(),
    answer: vi.fn(),
    hangup: vi.fn(),
    hangupAll: vi.fn(),
    toggleMute: vi.fn(),
    toggleHold: vi.fn(),
    sendDTMF: vi.fn(),
    transfer: vi.fn(),
    attendedTransfer: vi.fn(),
    sendInfo: vi.fn(),
    update: vi.fn(),
    reinvite: vi.fn(),
    getSession: vi.fn(),
    getSessionIds: vi.fn(),
    getSessions: vi.fn(),
    setSessionMedia: vi.fn(),
  };
  const onUA = vi.fn<(event: string, handler: EventHandler) => () => void>(() =>
    vi.fn()
  );
  const onSession = vi.fn<
    (sessionId: string, event: string, handler: EventHandler) => () => void
  >(() => vi.fn());
  const kernel = {
    store: {
      getState: vi.fn(() => state),
      subscribe,
    },
    commands,
    events: {
      onUA,
      onSession,
      onMicDrop: vi.fn(),
      onSessionIceFailed: vi.fn(),
      onSessionIceRecoveryExhausted: vi.fn(),
      onSessionIceRecoveryStarted: vi.fn(),
      onSessionIceRecoverySucceeded: vi.fn(),
    },
    media: {
      getSession: vi.fn(() => null),
      observePeerConnection: vi.fn(() => vi.fn()),
      buildRemoteStream: vi.fn(() => null),
    },
  } as unknown as SipKernel;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SipProvider kernel={kernel}>{children}</SipProvider>
  );
  const setState = (partial: Partial<InternalSipState>) => {
    state = { ...state, ...partial };
    subscribers.forEach((listener) => listener());
  };

  return { commands, kernel, onSession, onUA, setState, subscribe, wrapper };
};

describe("SIP React hooks", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("requires SipProvider and exposes its kernel", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const preventErrorLog = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener("error", preventErrorLog);
    try {
      expect(() => renderHook(() => useSipKernel())).toThrow(
        "Must be used within SipProvider"
      );
    } finally {
      window.removeEventListener("error", preventErrorLog);
    }

    const { kernel, wrapper } = createHarness();
    const { result } = renderHook(() => useSipKernel(), { wrapper });
    expect(result.current).toBe(kernel);
  });

  it("subscribes to public state updates", () => {
    const { setState, subscribe, wrapper } = createHarness();
    const { result, unmount } = renderHook(() => useSipState(), { wrapper });

    act(() => setState({ sipStatus: SipStatus.Connected }));
    expect(result.current.sipStatus).toBe(SipStatus.Connected);
    expect(subscribe).toHaveBeenCalledOnce();

    unmount();
    act(() => setState({ sipStatus: SipStatus.Registered }));
    expect(result.current.sipStatus).toBe(SipStatus.Connected);
  });

  it("preserves a selected reference when custom equality matches", () => {
    const { setState, wrapper } = createHarness();
    const selector = vi.fn((state: SipState) => ({
      status: state.sipStatus,
    }));
    const { result } = renderHook(
      () =>
        useSipSelector(selector, (left, right) => left.status === right.status),
      { wrapper }
    );
    const first = result.current;

    act(() => setState({ error: "unrelated" }));
    expect(result.current).toBe(first);

    act(() => setState({ sipStatus: SipStatus.Connected }));
    expect(result.current).not.toBe(first);
    expect(result.current.status).toBe(SipStatus.Connected);
  });

  it("selects internal state, sessions and the active session", () => {
    const ringing = createSession("ringing");
    const active = createSession("active", CallStatus.Active);
    const { setState, wrapper } = createHarness();
    act(() =>
      setState({
        sessions: [ringing, active],
        sessionsById: { ringing, active },
        sessionIds: ["ringing", "active"],
      })
    );

    const internal = renderHook(
      () => useSipInternalSelector((state) => state.sessionIds),
      { wrapper }
    );
    const sessions = renderHook(() => useSipSessions(), { wrapper });
    const selected = renderHook(() => useSipSession("ringing"), { wrapper });
    const missing = renderHook(() => useSipSession(), { wrapper });
    const activeSession = renderHook(() => useActiveSipSession(), { wrapper });

    expect(internal.result.current).toEqual(["ringing", "active"]);
    expect(sessions.result.current).toEqual({ sessions: [ringing, active] });
    expect(selected.result.current).toBe(ringing);
    expect(missing.result.current).toBeNull();
    expect(activeSession.result.current).toBe(active);
  });

  it("returns stable command references", () => {
    const { commands, wrapper } = createHarness();
    const { result, rerender } = renderHook(() => useSipActions(), { wrapper });
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
    expect(result.current.connect).toBe(commands.connect);
    expect(result.current.reinvite).toBe(commands.reinvite);
    expect(result.current.setSessionMedia).toBe(commands.setSessionMedia);
  });

  it("keeps the latest UA handler without resubscribing", () => {
    const { onUA, wrapper } = createHarness();
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    const { rerender } = renderHook<void, { handler?: ConnectedHandler }>(
      ({ handler }) => useSipEvent("connected", handler),
      { initialProps: { handler: firstHandler }, wrapper }
    );
    const subscribedHandler = onUA.mock.calls[0]?.[1];

    rerender({ handler: secondHandler });
    act(() => subscribedHandler?.({ socket: "wss" }));

    expect(onUA).toHaveBeenCalledOnce();
    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalledWith({ socket: "wss" });
  });

  it("unsubscribes UA events when the handler disappears", () => {
    const { onUA, wrapper } = createHarness();
    const off = vi.fn();
    onUA.mockReturnValue(off);
    const { rerender } = renderHook<void, { handler?: ConnectedHandler }>(
      ({ handler }) => useSipEvent("connected", handler),
      { initialProps: { handler: vi.fn() }, wrapper }
    );

    rerender({ handler: undefined });

    expect(off).toHaveBeenCalledOnce();
    expect(onUA).toHaveBeenCalledOnce();
  });

  it("subscribes and cleans up session events", () => {
    const { onSession, wrapper } = createHarness();
    const off = vi.fn();
    const handler = vi.fn();
    onSession.mockReturnValue(off);
    const { unmount } = renderHook(
      () => useSipSessionEvent("session-1", "accepted", handler),
      { wrapper }
    );
    const subscribedHandler = onSession.mock.calls[0]?.[2];

    act(() => subscribedHandler?.({ originator: "remote" }));
    unmount();

    expect(onSession).toHaveBeenCalledWith(
      "session-1",
      "accepted",
      expect.any(Function)
    );
    expect(handler).toHaveBeenCalledWith({ originator: "remote" });
    expect(off).toHaveBeenCalledOnce();
  });

  it("collects and filters incoming and outgoing messages", () => {
    const { onUA, wrapper } = createHarness();
    vi.spyOn(Date, "now").mockReturnValue(123);
    const { result, rerender } = renderHook<
      ReturnType<typeof useSipMessages>,
      { from?: string }
    >(({ from }: { from?: string }) => useSipMessages({ from }), {
      initialProps: { from: undefined },
      wrapper,
    });
    const messageHandler = onUA.mock.calls[0]?.[1];

    act(() => {
      messageHandler?.();
      messageHandler?.({
        originator: "remote",
        request: {
          from: { uri: { user: "100" } },
          to: { uri: { user: "200" } },
          body: "hello",
        },
      });
      messageHandler?.({
        originator: "local",
        message: {
          from: { uri: { user: "300" } },
          to: { uri: { user: "400" } },
          body: "bye",
        },
      });
    });

    expect(result.current).toEqual([
      { from: "100", to: "200", body: "hello", at: 123, direction: "in" },
      { from: "300", to: "400", body: "bye", at: 123, direction: "out" },
    ]);

    rerender({ from: "100" });
    expect(result.current).toEqual([
      { from: "100", to: "200", body: "hello", at: 123, direction: "in" },
    ]);
  });
});
