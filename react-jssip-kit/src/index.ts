import "./core/modules/debug/sip-debugger";
import { SipStatus, CallStatus, CallDirection } from "./core/contracts/state";
import { WebSocketInterface } from "jssip";
import { createSipClientInstance, createSipEventManager } from "./core/client";
import { createSipKernel } from "./core/kernel";

export { useSipState } from "./hooks/useSipState";
export { useSipActions } from "./hooks/useSipActions";
export { useSipKernel } from "./hooks/useSip";
export { useSipSelector } from "./hooks/useSipSelector";
export { useActiveSipSession, useSipSession } from "./hooks/useSipSession";
export { useSipSessions } from "./hooks/useSipSessions";
export { useSipEvent, useSipSessionEvent } from "./hooks/useSipEvent";
export { useMicDrop } from "./hooks/useMicDrop";
export { useSessionIceFailed } from "./hooks/useSessionIceFailed";
export { useSessionIceRecoveryExhausted } from "./hooks/useSessionIceRecoveryExhausted";
export { useSessionMedia } from "./hooks/useSessionMedia";
export { useCallTimer } from "./hooks/useCallTimer";
export { useCallQuality } from "./hooks/useCallQuality";
export type { CallQuality } from "./hooks/useCallQuality";
export { useSipMessages } from "./hooks/useSipMessages";
export type { SipMessage } from "./hooks/useSipMessages";
export { CallPlayer } from "./components/call-player";

export { SipProvider } from "./provider";
export type { SipProviderProps } from "./provider";

export {
  CallStatus,
  CallDirection,
  createSipClientInstance,
  createSipKernel,
  createSipEventManager,
  WebSocketInterface,
  SipStatus,
};

import type {
  SipState,
  SipSessionState,
  SipStatus as SipStatusType,
  CallDirection as CallDirectionType,
  CallStatus as CallStatusType,
  CallOptions,
  AnswerOptions,
  DTMFOptions,
  ExtraHeaders,
  MicDropPayload,
  SessionIceFailedPayload,
  SessionIceRecoveryExhaustedPayload,
  ReferOptions,
  RenegotiateOptions,
  SendMessageOptions,
  JsSIPEventMap,
  JsSIPEventName,
  SessionEventName,
  SessionEventPayload,
  UAEventName,
  UAEventPayload,
  SipEventHandlers,
  SipEventManager,
  SipSendOptionsOptions,
  RTCSession,
  TerminateOptions,
  RTCSessionEventMap,
  SipConfiguration,
} from "./core/public-types";
import type { SipKernel } from "./core/kernel/types";

export type {
  SipState,
  SipSessionState,
  SipStatusType,
  CallDirectionType,
  CallStatusType,
  CallOptions,
  AnswerOptions,
  DTMFOptions,
  ExtraHeaders,
  MicDropPayload,
  SessionIceFailedPayload,
  SessionIceRecoveryExhaustedPayload,
  ReferOptions,
  RenegotiateOptions,
  SendMessageOptions,
  JsSIPEventMap,
  JsSIPEventName,
  SessionEventName,
  SessionEventPayload,
  UAEventName,
  UAEventPayload,
  SipEventHandlers,
  SipEventManager,
  SipSendOptionsOptions,
  RTCSession,
  TerminateOptions,
  RTCSessionEventMap,
  SipConfiguration,
  SipKernel,
};
