import { SipUserAgent } from "../sip/user-agent";
import type {
  AnswerOptions,
  CallOptions,
  DTMFOptions,
  ExtraHeaders,
  JsSIPEventMap,
  RenegotiateOptions,
  ReferOptions,
  RTCSessionEvent,
  SendMessageOptions,
  SipConfiguration,
  SipSendOptionsOptions,
  TerminateOptions,
} from "../sip/types";
import type { SipState, StateAdapter } from "../contracts/state";
import { CallStatus, SipStatus } from "../contracts/state";
import { JssipEventEmitter } from "../modules/event/event-target.emitter";
import { SipStateStore } from "../modules/state/sip.state.store";
import { SipDebugRuntime } from "../modules/debug/sip-debug.runtime";
import { createSipEventManager } from "../modules/event/sip-event-manager.adapter";
import { MicRecoveryManager } from "../modules/media/mic-recovery.manager";
import { BrowserUnloadRuntime } from "../modules/runtime/browser-unload.runtime";
import { SessionManager } from "../modules/session/session.manager";
import { SessionModule } from "../modules/session/session.module";
import { createUAHandlers } from "../modules/ua/ua.handlers";
import { UaModule } from "../modules/ua/ua.module";
import {
  ReconnectManager,
  type ReconnectConfig,
} from "../modules/runtime/reconnect.manager";

export type SipClientOptions = {
  debug?: boolean | string;
};

type UAWithSendOptions = {
  sendOptions: (
    target: string,
    body?: string,
    options?: SipSendOptionsOptions
  ) => void;
};

export class SipClient extends JssipEventEmitter<JsSIPEventMap> {
  public readonly userAgent = new SipUserAgent();
  public readonly stateStore: StateAdapter = new SipStateStore();

  private readonly uaModule: UaModule;
  private debugPattern?: boolean | string;
  private runtimeDebugOverride?: boolean | string;
  private configDebug?: boolean | string;
  private maxSessionCount = Infinity;
  private iceCandidateReadyDelayMs?: number;
  private autoIceRestart = false;
  private autoIceRestartMaxAttempts = 1;
  private autoIceRestartDisconnectedDelayMs = 7000;
  private autoIceRestartRetryDelayMs = 250;
  private sessionManager = new SessionManager();
  private sessionModule: SessionModule;
  private micRecovery: MicRecoveryManager;
  private unloadRuntime = new BrowserUnloadRuntime();
  private debugRuntime: SipDebugRuntime;
  private lastConnectParams: {
    uri: string;
    password: string;
    config: SipConfiguration;
  } | null = null;
  private intentionalDisconnect = false;
  private reconnectConfig: ReconnectConfig | null = null;
  private reconnectManager: ReconnectManager | null = null;

  public get state(): SipState {
    return this.stateStore.getPublicState();
  }

  constructor(options: SipClientOptions = {}) {
    super();
    this.debugPattern = options.debug;

    this.uaModule = new UaModule({
      userAgent: this.userAgent,
      createHandlers: () =>
        createUAHandlers({
          emitter: this,
          state: this.stateStore,
          onNewRTCSession: (e: RTCSessionEvent) => this.onNewRTCSession(e),
          onDisconnected: () => this._onUADisconnected(),
          onConnected: () => this._onUAConnected(),
        }),
    });

    this.micRecovery = new MicRecoveryManager({
      getRtc: (sessionId) => this.sessionManager.getRtc(sessionId),
      getSession: (sessionId) => this.sessionManager.getSession(sessionId),
      getSessionState: (sessionId) =>
        this.stateStore.getState().sessionsById[sessionId],
      setSessionMedia: (sessionId, stream) =>
        this.sessionManager.setSessionMedia(sessionId, stream),
      onDrop: (sessionId, trackLive, senderLive) =>
        this.emit("micDrop", { sessionId, trackLive, senderLive }),
    });

    this.sessionModule = new SessionModule({
      state: this.stateStore,
      emitter: this,
      sessionManager: this.sessionManager,
      micRecovery: this.micRecovery,
      getMaxSessionCount: () => this.maxSessionCount,
      getIceCandidateReadyDelayMs: () => this.iceCandidateReadyDelayMs,
      getAutoIceRestart: () => this.autoIceRestart,
      getAutoIceRestartMaxAttempts: () => this.autoIceRestartMaxAttempts,
      getAutoIceRestartDisconnectedDelayMs: () =>
        this.autoIceRestartDisconnectedDelayMs,
      getAutoIceRestartRetryDelayMs: () => this.autoIceRestartRetryDelayMs,
    });

    this.debugRuntime = new SipDebugRuntime({
      getState: () => this.stateStore.getPublicState(),
      onChange: (listener) => this.stateStore.onPublicChange(listener),
      getSessions: () => this.getSessions(),
      setDebugEnabled: (enabled) => this.sessionModule.setDebugEnabled(enabled),
    });

    this.debugRuntime.attachBridge((debug?: boolean | string) =>
      this.setDebug(debug)
    );
  }

  public connect(uri: string, password: string, config: SipConfiguration) {
    const {
      debug: cfgDebug,
      enableMicRecovery,
      micRecoveryIntervalMs,
      micRecoveryMaxRetries,
      maxSessionCount,
      iceCandidateReadyDelayMs,
      autoIceRestart,
      reconnect,
      ...uaCfg
    } = config;
    const resolvedMaxSessionCount =
      this.resolveMaxSessionCount(maxSessionCount);
    const resolvedReconnectConfig = this.resolveReconnectConfig(reconnect);
    const resolvedIceCandidateReadyDelayMs = this.resolveIceCandidateReadyDelay(
      iceCandidateReadyDelayMs
    );
    const resolvedAutoIceRestart = this.resolveAutoIceRestart(autoIceRestart);
    const micRecoveryConfig = {
      enabled: Boolean(enableMicRecovery),
      intervalMs: micRecoveryIntervalMs,
      maxRetries: micRecoveryMaxRetries,
    };
    this.micRecovery.validateConfig(micRecoveryConfig);
    const nextUa = this.uaModule.prepareStart(uri, password, uaCfg);

    this.intentionalDisconnect = false;
    this.reconnectManager?.cancel();
    this.reconnectManager = null;
    this._stopUA();
    this.stateStore.reset({ sipStatus: SipStatus.Connecting });
    this.lastConnectParams = {
      uri,
      password,
      config: {
        ...config,
        reconnect: reconnect ? { ...reconnect } : undefined,
      },
    };
    this.configDebug = cfgDebug;
    this.reconnectConfig = resolvedReconnectConfig;
    this.maxSessionCount = resolvedMaxSessionCount;
    this.iceCandidateReadyDelayMs = resolvedIceCandidateReadyDelayMs;
    this.autoIceRestart = resolvedAutoIceRestart.enabled;
    this.autoIceRestartMaxAttempts = resolvedAutoIceRestart.maxAttempts;
    this.autoIceRestartDisconnectedDelayMs =
      resolvedAutoIceRestart.disconnectedDelayMs;
    this.autoIceRestartRetryDelayMs = resolvedAutoIceRestart.retryDelayMs;
    this.micRecovery.configure(micRecoveryConfig);
    const debug = this.resolveDebug(cfgDebug);
    try {
      this.uaModule.startPrepared(nextUa, debug);
    } catch (error) {
      this.stateStore.reset();
      throw error;
    }
    this.sessionModule.setDebugEnabled(Boolean(debug));
    this.unloadRuntime.attach(() => {
      this.hangupAll();
      this.disconnect();
    });
    this.debugRuntime.syncInspector(debug);
  }

  public registerUA() {
    this.uaModule.register();
  }

  public disconnect() {
    this.intentionalDisconnect = true;
    this.reconnectManager?.cancel();
    this.reconnectManager = null;
    this._stopUA();
    this.stateStore.reset();
  }

  private _stopUA() {
    this.unloadRuntime.detach();
    this.uaModule.stop();
    this.cleanupAllSessions();
    this.debugRuntime.cleanup();
  }

  private _onUADisconnected() {
    this.cleanupAllSessions();

    if (this.intentionalDisconnect) return;

    if (this.reconnectConfig?.enabled) {
      this.stateStore.reset({
        sipStatus: SipStatus.Reconnecting,
      });

      if (!this.reconnectManager) {
        this.reconnectManager = new ReconnectManager(
          this.reconnectConfig,
          () => this._doReconnect(),
          () => this._onReconnectExhausted()
        );
        this.reconnectManager.start();
      } else {
        this.reconnectManager.scheduleNext();
      }
    } else {
      this.stateStore.reset();
    }
  }

  private _onUAConnected() {
    if (this.reconnectManager?.isActive()) {
      this.reconnectManager.cancel();
      this.reconnectManager = null;
    }
  }

  private _doReconnect() {
    if (!this.lastConnectParams) {
      this.stateStore.reset();
      return;
    }
    const { uri, password, config } = this.lastConnectParams;
    const cfgDebug = config.debug;
    const uaCfg = { ...config };
    delete uaCfg.debug;
    delete uaCfg.enableMicRecovery;
    delete uaCfg.micRecoveryIntervalMs;
    delete uaCfg.micRecoveryMaxRetries;
    delete uaCfg.maxSessionCount;
    delete uaCfg.iceCandidateReadyDelayMs;
    delete uaCfg.autoIceRestart;
    delete uaCfg.reconnect;
    this.configDebug = cfgDebug;
    this.stateStore.reset({ sipStatus: SipStatus.Connecting });
    const debug = this.resolveDebug(cfgDebug);
    const nextUa = this.uaModule.prepareStart(uri, password, uaCfg);
    this.uaModule.startPrepared(nextUa, debug);
    this.unloadRuntime.attach(() => {
      this.hangupAll();
      this.disconnect();
    });
  }

  private _onReconnectExhausted() {
    this.reconnectManager = null;
    this.stateStore.reset();
  }

  public call(target: string, callOptions: CallOptions = {}) {
    // pendingMedia must be set BEFORE ua.call() because JsSIP fires
    // newRTCSession synchronously inside ua.call(). By the time ua.call()
    // returns, handleNewRTCSession has already run and getOrCreateRtc has
    // already consumed pendingMedia — no post-call patching needed.
    const ua = this.userAgent.getUA();
    if (!ua) {
      this.sessionModule.setPendingMedia(null);
      return;
    }
    const existingSessionIds = new Set(this.getSessionIds());
    this.sessionModule.setPendingMedia(callOptions.mediaStream ?? null);
    try {
      ua.call(target, callOptions);
    } catch (e: unknown) {
      console.error(e);
      // ua.call() fires newRTCSession synchronously before throwing, so a
      // Dialing session may already be in state. Clean it up to avoid a hang.
      const state = this.stateStore.getState();
      state.sessionIds
        .filter(
          (id) =>
            !existingSessionIds.has(id) &&
            state.sessionsById[id]?.status === CallStatus.Dialing
        )
        .forEach((id) => this.sessionModule.cleanupSessionById(id));
    } finally {
      this.sessionModule.setPendingMedia(null);
    }
  }

  public sendMessage(
    target: string,
    body: string,
    options?: SendMessageOptions
  ) {
    try {
      const ua = this.userAgent.getUA();
      if (!ua) return false;
      ua.sendMessage(target, body, options);
      return true;
    } catch (e: unknown) {
      console.error(e);
      return false;
    }
  }

  public sendOptions(
    target: string,
    body?: string,
    options?: SipSendOptionsOptions
  ) {
    try {
      const ua = this.userAgent.getUA();
      if (!ua) return false;
      const optionsUa = ua as unknown as UAWithSendOptions;
      if (typeof optionsUa.sendOptions !== "function") return false;
      optionsUa.sendOptions(target, body, options);
      return true;
    } catch (e: unknown) {
      console.error(e);
      return false;
    }
  }

  public hangupAll(options?: TerminateOptions) {
    const ids = this.getSessionIds();
    ids.forEach((id) => this.hangupSession(id, options));
    return ids.length > 0;
  }

  public onChange(fn: (s: SipState) => void) {
    return this.stateStore.onPublicChange(fn);
  }

  public setDebug(debug?: boolean | string) {
    this.runtimeDebugOverride = debug;
    this.debugRuntime.persistDebugOverride(debug);
    const effectiveDebug = this.resolveDebug();
    this.uaModule.setDebug(effectiveDebug);
    this.sessionModule.setDebugEnabled(Boolean(effectiveDebug));
    this.debugRuntime.syncInspector(effectiveDebug);
  }

  private resolveDebug(
    configDebug: boolean | string | undefined = this.configDebug
  ): boolean | string | undefined {
    return (
      this.runtimeDebugOverride ??
      this.debugRuntime.getPersistedDebug() ??
      configDebug ??
      this.debugPattern
    );
  }

  private resolveMaxSessionCount(value?: number): number {
    if (value == null || value === Infinity) return Infinity;
    if (Number.isSafeInteger(value) && value >= 0) return value;
    throw new RangeError(
      "maxSessionCount must be a non-negative safe integer or Infinity"
    );
  }

  private resolveIceCandidateReadyDelay(value?: number): number | undefined {
    if (value == null) return undefined;
    if (Number.isFinite(value) && value >= 0) return value;
    throw new RangeError(
      "iceCandidateReadyDelayMs must be a finite non-negative number"
    );
  }

  private resolveAutoIceRestart(value?: SipConfiguration["autoIceRestart"]) {
    const config = value === true ? {} : value || {};
    const maxAttempts = config.maxAttempts ?? 1;
    const disconnectedDelayMs = config.disconnectedDelayMs ?? 7000;
    const retryDelayMs = config.retryDelayMs ?? 250;
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 0)
      throw new RangeError(
        "autoIceRestart.maxAttempts must be a non-negative integer"
      );
    if (!Number.isFinite(disconnectedDelayMs) || disconnectedDelayMs < 0)
      throw new RangeError(
        "autoIceRestart.disconnectedDelayMs must be finite and non-negative"
      );
    if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0)
      throw new RangeError(
        "autoIceRestart.retryDelayMs must be finite and non-negative"
      );
    return {
      enabled: Boolean(value),
      maxAttempts,
      disconnectedDelayMs,
      retryDelayMs,
    };
  }

  private resolveReconnectConfig(
    value?: SipConfiguration["reconnect"]
  ): ReconnectConfig | null {
    if (!value?.enabled) return null;
    if (
      value.maxAttempts != null &&
      (!Number.isSafeInteger(value.maxAttempts) || value.maxAttempts < 0)
    ) {
      throw new RangeError(
        "reconnect.maxAttempts must be a non-negative integer"
      );
    }
    if (
      value.delayMs != null &&
      (!Number.isFinite(value.delayMs) || value.delayMs < 0)
    ) {
      throw new RangeError(
        "reconnect.delayMs must be a finite non-negative number"
      );
    }
    if (
      value.backoffMultiplier != null &&
      (!Number.isFinite(value.backoffMultiplier) ||
        value.backoffMultiplier <= 0)
    ) {
      throw new RangeError(
        "reconnect.backoffMultiplier must be a finite positive number"
      );
    }
    return { ...value };
  }

  private cleanupAllSessions() {
    this.sessionModule.cleanupAllSessions();
  }

  protected onNewRTCSession(e: RTCSessionEvent) {
    this.sessionModule.handleNewRTCSession(e);
  }

  public answerSession(sessionId: string, options: AnswerOptions = {}) {
    return this.sessionModule.answerSession(sessionId, options);
  }

  public hangupSession(sessionId: string, options?: TerminateOptions) {
    return this.sessionModule.hangupSession(sessionId, options);
  }

  public toggleMuteSession(sessionId?: string) {
    return this.sessionModule.toggleMuteSession(sessionId);
  }

  public toggleHoldSession(sessionId?: string) {
    return this.sessionModule.toggleHoldSession(sessionId);
  }

  public sendDTMFSession(
    sessionId: string,
    tones: string | number,
    options?: DTMFOptions
  ) {
    return this.sessionModule.sendDTMFSession(sessionId, tones, options);
  }

  public transferSession(
    sessionId: string,
    target: string,
    options?: ReferOptions
  ) {
    return this.sessionModule.transferSession(sessionId, target, options);
  }

  public attendedTransferSession(
    sessionId: string,
    replaceSessionId: string
  ): boolean {
    return this.sessionModule.attendedTransferSession(
      sessionId,
      replaceSessionId
    );
  }

  public sendInfoSession(
    sessionId: string,
    contentType: string,
    body?: string,
    options?: ExtraHeaders
  ) {
    return this.sessionModule.sendInfoSession(
      sessionId,
      contentType,
      body,
      options
    );
  }

  public updateSession(sessionId: string, options?: RenegotiateOptions) {
    return this.sessionModule.updateSession(sessionId, options);
  }

  public reinviteSession(sessionId: string, options?: RenegotiateOptions) {
    return this.sessionModule.updateSession(sessionId, options);
  }

  public setSessionMedia(sessionId: string, stream: MediaStream) {
    this.sessionModule.setSessionMedia(sessionId, stream);
  }

  public getSession(sessionId: string) {
    return this.sessionModule.getSession(sessionId);
  }

  public getSessionIds() {
    return this.sessionModule.getSessionIds();
  }

  public getSessions() {
    return this.sessionModule.getSessions();
  }
}

export function createSipClientInstance(options?: SipClientOptions): SipClient {
  return new SipClient(options);
}

export { createSipEventManager };
