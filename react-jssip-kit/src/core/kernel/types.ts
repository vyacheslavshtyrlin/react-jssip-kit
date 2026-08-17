import type { InternalSipState } from "../contracts/state";
import type { SipClient } from "../client";
import type {
  AnswerOptions,
  CallOptions,
  DTMFOptions,
  ExtraHeaders,
  MicDropPayload,
  SessionIceFailedPayload,
  SessionIceRecoveryExhaustedPayload,
  RenegotiateOptions,
  ReferOptions,
  SendMessageOptions,
  SessionEventName,
  SessionEventPayload,
  SipConfiguration,
  SipEventManager,
  SipSendOptionsOptions,
  TerminateOptions,
  UAEventName,
  UAEventPayload,
} from "../sip/types";
import type { MediaModule } from "../modules/media/types";

export interface SipKernel {
  client: SipClient;
  store: {
    getState: () => InternalSipState;
    subscribe: (onStoreChange: () => void) => () => void;
  };
  commands: {
    connect: (uri: string, password: string, config: SipConfiguration) => void;
    disconnect: () => void;
    register: () => void;
    setDebug: (debug?: boolean | string) => void;
    call: (target: string, options?: CallOptions) => void;
    sendMessage: (
      target: string,
      body: string,
      options?: SendMessageOptions
    ) => boolean;
    sendOptions: (
      target: string,
      body?: string,
      options?: SipSendOptionsOptions
    ) => boolean;
    answer: (sessionId: string, options?: AnswerOptions) => boolean;
    hangup: (sessionId: string, options?: TerminateOptions) => boolean;
    hangupAll: (options?: TerminateOptions) => boolean;
    toggleMute: (sessionId?: string) => boolean;
    toggleHold: (sessionId?: string) => boolean;
    sendDTMF: (
      sessionId: string,
      tones: string | number,
      options?: DTMFOptions
    ) => boolean;
    transfer: (
      sessionId: string,
      target: string,
      options?: ReferOptions
    ) => boolean;
    attendedTransfer: (sessionId: string, replaceSessionId: string) => boolean;
    sendInfo: (
      sessionId: string,
      contentType: string,
      body?: string,
      options?: ExtraHeaders
    ) => boolean;
    update: (sessionId: string, options?: RenegotiateOptions) => boolean;
    reinvite: (sessionId: string, options?: RenegotiateOptions) => boolean;
    getSession: SipClient["getSession"];
    getSessionIds: SipClient["getSessionIds"];
    getSessions: SipClient["getSessions"];
    setSessionMedia: SipClient["setSessionMedia"];
  };
  events: {
    onUA: <K extends UAEventName>(
      event: K,
      handler: (payload?: UAEventPayload<K>) => void
    ) => () => void;
    onSession: <K extends SessionEventName>(
      sessionId: string,
      event: K,
      handler: (payload?: SessionEventPayload<K>) => void
    ) => () => void;
    onMicDrop: (handler: (payload: MicDropPayload) => void) => () => void;
    onSessionIceFailed: (
      handler: (payload: SessionIceFailedPayload) => void
    ) => () => void;
    onSessionIceRecoveryExhausted: (
      handler: (payload: SessionIceRecoveryExhaustedPayload) => void
    ) => () => void;
  };
  eventManager: SipEventManager;
  media: MediaModule;
}
