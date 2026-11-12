import type { UA } from "jssip";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CallStatus,
  SipStatus,
  type SipSessionState,
} from "../../contracts/state";
import type { RTCSession, SipConfiguration } from "../../sip/types";
import { SipClient, createSipClientInstance } from "../sip.client";

type SessionModuleView = {
  setDebugEnabled: (enabled: boolean) => void;
  setPendingMedia: (stream: MediaStream | null) => void;
  cleanupSessionById: (sessionId: string) => void;
  cleanupAllSessions: () => void;
  answerSession: (...args: unknown[]) => boolean;
  hangupSession: (...args: unknown[]) => boolean;
  toggleMuteSession: (...args: unknown[]) => boolean;
  toggleHoldSession: (...args: unknown[]) => boolean;
  sendDTMFSession: (...args: unknown[]) => boolean;
  transferSession: (...args: unknown[]) => boolean;
  attendedTransferSession: (...args: unknown[]) => boolean;
  sendInfoSession: (...args: unknown[]) => boolean;
  updateSession: (...args: unknown[]) => boolean;
  setSessionMedia: (...args: unknown[]) => void;
  getSession: (...args: unknown[]) => RTCSession | null;
  getSessionIds: () => string[];
  getSessions: () => Array<{ id: string; session: RTCSession }>;
};

type ClientInternals = {
  sessionModule: SessionModuleView;
  micRecovery: {
    validateConfig: (config: unknown) => void;
    configure: (config: unknown) => void;
  };
  unloadRuntime: {
    attach: (handler: () => void) => void;
    detach: () => void;
  };
  debugRuntime: {
    persistDebugOverride: (debug?: boolean | string) => void;
    syncInspector: (debug?: boolean | string) => void;
  };
  _onUADisconnected: () => void;
  _onUAConnected: () => void;
};

const internals = (client: SipClient): ClientInternals =>
  client as unknown as ClientInternals;

const baseConfig = (): SipConfiguration =>
  ({ sockets: [{}] }) as unknown as SipConfiguration;

const createConnectedHarness = () => {
  const client = new SipClient();
  const preparedUa = {} as UA;
  const prepareStart = vi
    .spyOn(client.userAgent, "prepareStart")
    .mockReturnValue(preparedUa);
  const startPrepared = vi
    .spyOn(client.userAgent, "startPrepared")
    .mockReturnValue(preparedUa);
  const stop = vi.spyOn(client.userAgent, "stop").mockImplementation(() => {});
  return { client, prepareStart, preparedUa, startPrepared, stop };
};

const createSessionState = (
  id: string,
  status: SipSessionState["status"]
): SipSessionState => ({
  id,
  status,
  direction: "local",
  from: "100",
  to: "200",
  muted: false,
  acceptedAt: null,
  headers: {},
});

describe("SipClient", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("creates an instance through the public factory", () => {
    expect(createSipClientInstance()).toBeInstanceOf(SipClient);
  });

  it("prepares wrapper configuration and starts the UA", () => {
    const { client, prepareStart, preparedUa, startPrepared, stop } =
      createConnectedHarness();
    const view = internals(client);
    const validateRecovery = vi.spyOn(view.micRecovery, "validateConfig");
    const configureRecovery = vi.spyOn(view.micRecovery, "configure");
    const attachUnload = vi.spyOn(view.unloadRuntime, "attach");
    const setDebugEnabled = vi.spyOn(view.sessionModule, "setDebugEnabled");
    const config: SipConfiguration = {
      ...baseConfig(),
      register: false,
      debug: "JsSIP:*",
      enableMicRecovery: true,
      micRecoveryIntervalMs: 500,
      micRecoveryMaxRetries: 3,
      maxSessionCount: 2,
      iceCandidateReadyDelayMs: 10,
      autoIceRestart: {
        maxAttempts: 2,
        disconnectedDelayMs: 100,
        retryDelayMs: 20,
      },
      reconnect: {
        enabled: true,
        maxAttempts: 2,
        delayMs: 100,
        backoffMultiplier: 2,
      },
    };

    client.connect("sip:100@example.test", "secret", config);

    expect(prepareStart).toHaveBeenCalledWith(
      "sip:100@example.test",
      "secret",
      { sockets: [{}], register: false }
    );
    expect(startPrepared).toHaveBeenCalledWith(
      preparedUa,
      expect.objectContaining({
        debug: "JsSIP:*",
        beforeStart: expect.any(Function),
        onStartError: expect.any(Function),
      })
    );
    expect(stop).toHaveBeenCalledTimes(2);
    expect(validateRecovery).toHaveBeenCalledWith({
      enabled: true,
      intervalMs: 500,
      maxRetries: 3,
    });
    expect(configureRecovery).toHaveBeenCalledWith({
      enabled: true,
      intervalMs: 500,
      maxRetries: 3,
    });
    expect(setDebugEnabled).toHaveBeenCalledWith(true);
    expect(attachUnload).toHaveBeenCalledOnce();
    expect(client.state.sipStatus).toBe(SipStatus.Connecting);
  });

  it("resets state when UA startup fails", () => {
    const { client, startPrepared } = createConnectedHarness();
    const error = new Error("UA start failed");
    startPrepared.mockImplementation(() => {
      throw error;
    });

    expect(() =>
      client.connect("sip:100@example.test", "secret", baseConfig())
    ).toThrow(error);
    expect(client.state).toEqual({
      sipStatus: SipStatus.Disconnected,
      error: null,
      sessions: [],
    });
  });

  it.each([
    [{ maxSessionCount: -1 }, "maxSessionCount"],
    [{ iceCandidateReadyDelayMs: -1 }, "iceCandidateReadyDelayMs"],
    [{ autoIceRestart: { maxAttempts: -1 } }, "autoIceRestart.maxAttempts"],
    [
      { autoIceRestart: { disconnectedDelayMs: -1 } },
      "autoIceRestart.disconnectedDelayMs",
    ],
    [
      { autoIceRestart: { retryDelayMs: Number.NaN } },
      "autoIceRestart.retryDelayMs",
    ],
    [
      { reconnect: { enabled: true, maxAttempts: -1 } },
      "reconnect.maxAttempts",
    ],
    [{ reconnect: { enabled: true, delayMs: -1 } }, "reconnect.delayMs"],
    [
      { reconnect: { enabled: true, backoffMultiplier: 0 } },
      "reconnect.backoffMultiplier",
    ],
    [{ micRecoveryIntervalMs: 0 }, "micRecoveryIntervalMs"],
    [{ micRecoveryMaxRetries: -1 }, "micRecoveryMaxRetries"],
  ] as Array<[Partial<SipConfiguration>, string]>)(
    "validates config before replacing the active UA: %s",
    (override, message) => {
      const { client, prepareStart, stop } = createConnectedHarness();

      expect(() =>
        client.connect("sip:100@example.test", "secret", {
          ...baseConfig(),
          ...override,
        })
      ).toThrow(message);
      expect(prepareStart).not.toHaveBeenCalled();
      expect(stop).not.toHaveBeenCalled();
    }
  );

  it("registers and intentionally disconnects", () => {
    const client = new SipClient();
    const register = vi
      .spyOn(client.userAgent, "register")
      .mockImplementation(() => {});
    const stop = vi
      .spyOn(client.userAgent, "stop")
      .mockImplementation(() => {});
    const cleanup = vi.spyOn(
      internals(client).sessionModule,
      "cleanupAllSessions"
    );
    client.stateStore.setState({ sipStatus: SipStatus.Registered });

    client.registerUA();
    client.disconnect();

    expect(register).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(client.state.sipStatus).toBe(SipStatus.Disconnected);
  });

  it("sets and always clears pending media around an outgoing call", () => {
    const client = new SipClient();
    const view = internals(client);
    const stream = {} as MediaStream;
    const call = vi.fn();
    vi.spyOn(client.userAgent, "getUA").mockReturnValue({
      call,
    } as unknown as UA);
    const setPendingMedia = vi.spyOn(view.sessionModule, "setPendingMedia");

    client.call("sip:200@example.test", { mediaStream: stream });

    expect(setPendingMedia).toHaveBeenNthCalledWith(1, stream);
    expect(call).toHaveBeenCalledWith("sip:200@example.test", {
      mediaStream: stream,
    });
    expect(setPendingMedia).toHaveBeenLastCalledWith(null);

    vi.mocked(client.userAgent.getUA).mockReturnValue(null);
    client.call("sip:300@example.test");
    expect(setPendingMedia).toHaveBeenLastCalledWith(null);
  });

  it("cleans only newly-created dialing sessions when call throws", () => {
    const client = new SipClient();
    const view = internals(client);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(client, "getSessionIds").mockReturnValue(["existing"]);
    const cleanup = vi.spyOn(view.sessionModule, "cleanupSessionById");
    const existing = createSessionState("existing", CallStatus.Dialing);
    const call = vi.fn(() => {
      const created = createSessionState("created", CallStatus.Dialing);
      const active = createSessionState("active", CallStatus.Active);
      client.stateStore.setState({
        sessions: [existing, created, active],
        sessionIds: ["existing", "created", "active"],
        sessionsById: { existing, created, active },
      });
      throw new Error("call failed");
    });
    vi.spyOn(client.userAgent, "getUA").mockReturnValue({
      call,
    } as unknown as UA);

    client.call("sip:200@example.test");

    expect(cleanup).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledWith("created");
    expect(view.sessionModule.setPendingMedia).toBeDefined();
  });

  it("sends MESSAGE and OPTIONS with safe failure handling", () => {
    const client = new SipClient();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sendMessage = vi.fn();
    const sendOptions = vi.fn();
    const getUA = vi
      .spyOn(client.userAgent, "getUA")
      .mockReturnValue({ sendMessage, sendOptions } as unknown as UA);

    expect(client.sendMessage("sip:200@example.test", "hello")).toBe(true);
    expect(client.sendOptions("sip:200@example.test", "body")).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(
      "sip:200@example.test",
      "hello",
      undefined
    );
    expect(sendOptions).toHaveBeenCalledWith(
      "sip:200@example.test",
      "body",
      undefined
    );

    getUA.mockReturnValue(null);
    expect(client.sendMessage("target", "body")).toBe(false);
    expect(client.sendOptions("target")).toBe(false);

    getUA.mockReturnValue({ sendMessage: vi.fn() } as unknown as UA);
    expect(client.sendOptions("target")).toBe(false);
    getUA.mockReturnValue({
      sendMessage: vi.fn(() => {
        throw new Error("MESSAGE failed");
      }),
      sendOptions: vi.fn(() => {
        throw new Error("OPTIONS failed");
      }),
    } as unknown as UA);
    expect(client.sendMessage("target", "body")).toBe(false);
    expect(client.sendOptions("target")).toBe(false);
  });

  it("reconnects after an unexpected transport disconnect", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, prepareStart, startPrepared } = createConnectedHarness();
    const cleanup = vi.spyOn(
      internals(client).sessionModule,
      "cleanupAllSessions"
    );
    client.connect("sip:100@example.test", "secret", {
      ...baseConfig(),
      reconnect: { enabled: true, maxAttempts: 2, delayMs: 100 },
    });

    internals(client)._onUADisconnected();
    expect(client.state.sipStatus).toBe(SipStatus.Reconnecting);
    expect(cleanup).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(100);
    expect(prepareStart).toHaveBeenCalledTimes(2);
    expect(startPrepared).toHaveBeenCalledTimes(2);
    expect(client.state.sipStatus).toBe(SipStatus.Connecting);

    internals(client)._onUAConnected();
    await vi.runAllTimersAsync();
    expect(prepareStart).toHaveBeenCalledTimes(2);
  });

  it("marks an unexpected disconnect without reconnect configuration", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = createConnectedHarness();
    client.connect("sip:100@example.test", "secret", baseConfig());

    internals(client)._onUADisconnected();

    expect(client.state.sipStatus).toBe(SipStatus.Disconnected);
  });

  it("persists runtime debug and updates every debug boundary", () => {
    const client = new SipClient({ debug: false });
    const view = internals(client);
    const persist = vi.spyOn(view.debugRuntime, "persistDebugOverride");
    const sync = vi.spyOn(view.debugRuntime, "syncInspector");
    const setUaDebug = vi
      .spyOn(client.userAgent, "setDebug")
      .mockImplementation(() => {});
    const setSessionDebug = vi.spyOn(view.sessionModule, "setDebugEnabled");

    client.setDebug("JsSIP:Transport");

    expect(persist).toHaveBeenCalledWith("JsSIP:Transport");
    expect(setUaDebug).toHaveBeenCalledWith("JsSIP:Transport");
    expect(setSessionDebug).toHaveBeenCalledWith(true);
    expect(sync).toHaveBeenCalledWith("JsSIP:Transport");
  });

  it("delegates public session commands", () => {
    const client = new SipClient();
    const module = internals(client).sessionModule;
    const session = {} as RTCSession;
    const stream = {} as MediaStream;
    vi.spyOn(module, "answerSession").mockReturnValue(true);
    vi.spyOn(module, "hangupSession").mockReturnValue(true);
    vi.spyOn(module, "toggleMuteSession").mockReturnValue(true);
    vi.spyOn(module, "toggleHoldSession").mockReturnValue(true);
    vi.spyOn(module, "sendDTMFSession").mockReturnValue(true);
    vi.spyOn(module, "transferSession").mockReturnValue(true);
    vi.spyOn(module, "attendedTransferSession").mockReturnValue(true);
    vi.spyOn(module, "sendInfoSession").mockReturnValue(true);
    vi.spyOn(module, "updateSession").mockReturnValue(true);
    vi.spyOn(module, "getSession").mockReturnValue(session);
    vi.spyOn(module, "getSessionIds").mockReturnValue(["session-1"]);
    vi.spyOn(module, "getSessions").mockReturnValue([
      { id: "session-1", session },
    ]);
    const setMedia = vi.spyOn(module, "setSessionMedia");

    expect(client.answerSession("session-1")).toBe(true);
    expect(client.hangupSession("session-1")).toBe(true);
    expect(client.toggleMuteSession("session-1")).toBe(true);
    expect(client.toggleHoldSession("session-1")).toBe(true);
    expect(client.sendDTMFSession("session-1", "1")).toBe(true);
    expect(client.transferSession("session-1", "target")).toBe(true);
    expect(client.attendedTransferSession("session-1", "session-2")).toBe(true);
    expect(client.sendInfoSession("session-1", "application/test")).toBe(true);
    expect(client.updateSession("session-1")).toBe(true);
    expect(client.reinviteSession("session-1")).toBe(true);
    client.setSessionMedia("session-1", stream);
    expect(client.getSession("session-1")).toBe(session);
    expect(client.getSessionIds()).toEqual(["session-1"]);
    expect(client.getSessions()).toEqual([{ id: "session-1", session }]);
    expect(setMedia).toHaveBeenCalledWith("session-1", stream);
  });
});
