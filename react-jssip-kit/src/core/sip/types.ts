import type {
  UAEventMap,
  UAConfiguration,
  RTCSessionEvent,
  CallOptions,
} from "jssip/lib/UA";
import type {
  RTCSessionEventMap,
  RTCSession,
  AnswerOptions,
  DTMFOptions,
  EndEvent,
  ExtraHeaders,
  ReferOptions,
  RenegotiateOptions,
  TerminateOptions,
} from "jssip/lib/RTCSession";
import type { MessageEventMap, SendMessageOptions } from "jssip/lib/Message";

// ─── Event names ──────────────────────────────────────────────────────────────
// keyof EventMap gives string literal union; "& string" drops symbol/number.
export type UAEventName = keyof UAEventMap & string;
export type SessionEventName = keyof RTCSessionEventMap & string;
export type JsSIPEventName = UAEventName | SessionEventName;

// ─── Payload extraction ───────────────────────────────────────────────────────
// _ListenerPayload<L> is distributive over bare L, so union listeners like
// newRTCSession: IncomingListener | OutgoingListener yield a union payload.
type _ListenerPayload<L> = L extends (event: infer P) => unknown ? P : never;

export type UAEventPayload<K extends UAEventName> = _ListenerPayload<
  UAEventMap[K]
>;
export type SessionEventPayload<K extends SessionEventName> = _ListenerPayload<
  RTCSessionEventMap[K]
>;

/** The global `failed` event is always associated with this session id. */
export type SessionFailedPayload = SessionEventPayload<"failed"> & {
  sessionId: string;
};

export type JsSIPEventPayload<K extends JsSIPEventName> = K extends UAEventName
  ? UAEventPayload<K>
  : K extends "failed"
    ? SessionFailedPayload
    : K extends SessionEventName
      ? SessionEventPayload<K>
      : never;

export type JsSIPEventHandler<K extends JsSIPEventName> = (
  payload?: JsSIPEventPayload<K>
) => void;

export type SipEventHandlers = {
  [K in JsSIPEventName]?: JsSIPEventHandler<K>;
};

export interface SipEventManager {
  onUA: <K extends UAEventName>(
    event: K,
    handler: (payload?: UAEventPayload<K>) => void
  ) => () => void;
  onSession: <K extends SessionEventName>(
    sessionId: string,
    event: K,
    handler: (payload?: SessionEventPayload<K>) => void
  ) => () => void;
}

export type MicDropPayload = {
  sessionId: string;
  trackLive: boolean;
  senderLive: boolean;
};

export type SessionIceFailedPayload = {
  sessionId: string;
};

export type SessionIceRecoveryExhaustedPayload = {
  sessionId: string;
  attempts: number;
  maxAttempts: number;
  source: "failed" | "disconnected";
};

export type SessionIceRecoveryStartedPayload = {
  sessionId: string;
  source: "failed" | "disconnected";
  attempt: number;
};

export type SessionIceRecoverySucceededPayload = {
  sessionId: string;
  attempt: number;
};

export type AudioPlaybackBlockedPayload = {
  sessionId: string;
  error: unknown;
};

export type JsSIPEventMap = {
  [K in JsSIPEventName]: JsSIPEventPayload<K>;
} & {
  micDrop: MicDropPayload;
  sessionIceFailed: SessionIceFailedPayload;
  sessionIceRecoveryExhausted: SessionIceRecoveryExhaustedPayload;
  sessionIceRecoveryStarted: SessionIceRecoveryStartedPayload;
  sessionIceRecoverySucceeded: SessionIceRecoverySucceededPayload;
  audioPlaybackBlocked: AudioPlaybackBlockedPayload;
};

export type SipCallOptions = CallOptions;
export type SipSendMessageOptions = SendMessageOptions;
export type SipSendOptionsOptions = ExtraHeaders & {
  contentType?: string;
  eventHandlers?: Partial<MessageEventMap>;
};

export type AutoIceRestartConfig = {
  maxAttempts?: number;
  disconnectedDelayMs?: number;
  retryDelayMs?: number;
};

export type SipConfiguration = Omit<UAConfiguration, "password" | "uri"> & {
  debug?: boolean | string;
  enableMicRecovery?: boolean;
  micRecoveryIntervalMs?: number;
  micRecoveryMaxRetries?: number;
  maxSessionCount?: number;
  iceCandidateReadyDelayMs?: number;
  /** `true` uses defaults; object form customizes ICE recovery. */
  autoIceRestart?: boolean | AutoIceRestartConfig;
  reconnect?: {
    enabled: boolean;
    maxAttempts?: number;
    delayMs?: number;
    backoffMultiplier?: number;
  };
};
export type {
  RTCSession,
  RTCSessionEventMap,
  AnswerOptions,
  DTMFOptions,
  ExtraHeaders,
  ReferOptions,
  RenegotiateOptions,
  MessageEventMap,
  SendMessageOptions,
  UAConfiguration,
  UAEventMap,
  TerminateOptions,
  EndEvent,
  CallOptions,
  RTCSessionEvent,
};
