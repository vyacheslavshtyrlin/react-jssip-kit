import { afterEach, describe, expect, it, vi } from "vitest";
import { SipStatus } from "../../../contracts/state";
import { SipStateStore } from "../sip.state.store";

describe("SipStateStore", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("notifies both listener groups when public state changes", () => {
    const store = new SipStateStore();
    const onInternalChange = vi.fn();
    const onPublicChange = vi.fn();
    store.subscribeInternal(onInternalChange);
    store.subscribe(onPublicChange);

    store.setState({ sipStatus: SipStatus.Connected });

    expect(onInternalChange).toHaveBeenCalledOnce();
    expect(onPublicChange).toHaveBeenCalledOnce();
    expect(onPublicChange).toHaveBeenCalledWith({
      sipStatus: SipStatus.Connected,
      error: null,
      sessions: [],
    });
  });

  it("does not notify public listeners for an internal-only change", () => {
    const store = new SipStateStore();
    const onInternalChange = vi.fn();
    const onPublicChange = vi.fn();
    store.subscribeInternal(onInternalChange);
    store.subscribe(onPublicChange);

    store.setState({ sessionIds: ["session-1"] });

    expect(onInternalChange).toHaveBeenCalledOnce();
    expect(onPublicChange).not.toHaveBeenCalled();
    expect(store.getState().sessionIds).toEqual(["session-1"]);
  });

  it("ignores empty and referentially equal updates", () => {
    const store = new SipStateStore();
    const listener = vi.fn();
    store.subscribeInternal(listener);
    const sessions = store.getState().sessions;

    store.setState({});
    store.setState({ sessions });
    store.setState({ sipStatus: SipStatus.Disconnected });

    expect(listener).not.toHaveBeenCalled();
  });

  it("stops notifying a listener after unsubscribe", () => {
    const store = new SipStateStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.setState({ error: "registration failed" });

    expect(listener).not.toHaveBeenCalled();
  });

  it("continues notifying listeners when another listener throws", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const store = new SipStateStore();
    const error = new Error("listener failed");
    const healthyListener = vi.fn();
    store.subscribeInternal(() => {
      throw error;
    });
    store.subscribeInternal(healthyListener);

    store.setState({ sipStatus: SipStatus.Registered });

    expect(healthyListener).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      "[react-jssip-kit] state listener failed",
      error
    );
  });

  it("resets state and applies overrides", () => {
    const store = new SipStateStore();
    store.setState({
      sipStatus: SipStatus.Connected,
      error: "old error",
      sessionIds: ["session-1"],
    });

    store.reset({ sipStatus: SipStatus.Reconnecting });

    expect(store.getState()).toEqual({
      sipStatus: SipStatus.Reconnecting,
      error: null,
      sessions: [],
      sessionsById: {},
      sessionIds: [],
    });
  });
});
