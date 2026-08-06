import type { SipClient } from "../../client";
import type {
  RTCSession,
  RTCSessionEventMap,
  SessionEventName,
  SessionEventPayload,
  SipEventManager,
} from "../../sip/types";

function getSessionFromPayload(payload: unknown): RTCSession | null {
  return (payload as { session?: RTCSession } | undefined)?.session ?? null;
}

function getSessionId(session: RTCSession): string {
  return String(session.id ?? "");
}

export function createSipEventManager(client: SipClient): SipEventManager {
  return {
    onUA(event, handler) {
      // For generic K TypeScript cannot reduce JsSIPEventMap[K] to
      // UAEventPayload<K>; the types are identical at every concrete K.
      return client.on(event, handler as never);
    },
    onSession(sessionId, event, handler) {
      type SessionListener<K extends SessionEventName> = RTCSessionEventMap[K];
      const wrapped = ((payload: SessionEventPayload<typeof event>) => {
        handler(payload);
      }) as SessionListener<typeof event>;

      let attachedSession: RTCSession | null = null;

      const detach = () => {
        const session = attachedSession;
        attachedSession = null;
        if (!session) return;
        try {
          session.off(event, wrapped);
        } catch (error) {
          console.error(
            "[react-jssip-kit] session event listener detach failed",
            error
          );
        }
      };

      const attach = (session: RTCSession | null) => {
        if (!session) return;
        const id = getSessionId(session);
        if (!id || id !== sessionId) return;
        if (attachedSession === session) return;

        detach();
        try {
          session.on(event, wrapped);
          attachedSession = session;
        } catch (error) {
          console.error(
            "[react-jssip-kit] session event listener attach failed",
            error
          );
        }
      };

      const offNewSession = client.on("newRTCSession", (payload) => {
        attach(getSessionFromPayload(payload));
      });

      attach(client.getSession(sessionId) ?? null);

      const offDisconnected = client.on("disconnected", () => {
        detach();
      });

      return () => {
        offNewSession();
        offDisconnected();
        detach();
      };
    },
  };
}
