import { createSipClientInstance } from "../client";
import type {
  AnswerOptions,
  CallOptions,
  DTMFOptions,
  ExtraHeaders,
  RenegotiateOptions,
  ReferOptions,
  SendMessageOptions,
  SipConfiguration,
  SipSendOptionsOptions,
  TerminateOptions,
} from "../sip/types";
import type { SipKernel } from "./types";
import { createMediaModule } from "../modules/media/media.module";
import { createSipEventManager } from "../modules/event/sip-event-manager.adapter";

export function createSipKernel(): SipKernel {
  const client = createSipClientInstance();
  const eventManager = createSipEventManager(client);
  const media = createMediaModule({ client, eventManager });

  return {
    client,
    store: {
      getState: () => client.stateStore.getState(),
      subscribe: (onStoreChange) =>
        client.stateStore.subscribeInternal(() => onStoreChange()),
    },
    commands: {
      connect: (uri: string, password: string, config: SipConfiguration) =>
        client.connect(uri, password, config),
      disconnect: () => client.disconnect(),
      register: () => client.registerUA(),
      setDebug: (debug?: boolean | string) => client.setDebug(debug),
      call: (target: string, options?: CallOptions) =>
        client.call(target, options),
      sendMessage: (
        target: string,
        body: string,
        options?: SendMessageOptions
      ) => client.sendMessage(target, body, options),
      sendOptions: (
        target: string,
        body?: string,
        options?: SipSendOptionsOptions
      ) => client.sendOptions(target, body, options),
      answer: (sessionId: string, options?: AnswerOptions) =>
        client.answerSession(sessionId, options),
      hangup: (sessionId: string, options?: TerminateOptions) =>
        client.hangupSession(sessionId, options),
      hangupAll: (options?: TerminateOptions) => client.hangupAll(options),
      toggleMute: (sessionId?: string) => client.toggleMuteSession(sessionId),
      toggleHold: (sessionId?: string) => client.toggleHoldSession(sessionId),
      sendDTMF: (
        sessionId: string,
        tones: string | number,
        options?: DTMFOptions
      ) => client.sendDTMFSession(sessionId, tones, options),
      transfer: (sessionId: string, target: string, options?: ReferOptions) =>
        client.transferSession(sessionId, target, options),
      attendedTransfer: (sessionId: string, replaceSessionId: string) =>
        client.attendedTransferSession(sessionId, replaceSessionId),
      sendInfo: (
        sessionId: string,
        contentType: string,
        body?: string,
        options?: ExtraHeaders
      ) => client.sendInfoSession(sessionId, contentType, body, options),
      update: (sessionId: string, options?: RenegotiateOptions) =>
        client.updateSession(sessionId, options),
      reinvite: (sessionId: string, options?: RenegotiateOptions) =>
        client.reinviteSession(sessionId, options),
      getSession: (sessionId: string) => client.getSession(sessionId),
      getSessionIds: () => client.getSessionIds(),
      getSessions: () => client.getSessions(),
      setSessionMedia: (sessionId: string, stream: MediaStream) =>
        client.setSessionMedia(sessionId, stream),
    },
    events: {
      onUA: (event, handler) => eventManager.onUA(event, handler),
      onSession: (sessionId, event, handler) =>
        eventManager.onSession(sessionId, event, handler),
      onMicDrop: (handler) => client.on("micDrop", handler),
      onSessionIceFailed: (handler) => client.on("sessionIceFailed", handler),
      onSessionIceRecoveryExhausted: (handler) =>
        client.on("sessionIceRecoveryExhausted", handler),
    },
    eventManager,
    media,
  };
}
