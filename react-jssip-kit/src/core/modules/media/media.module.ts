import type { SipEventManager } from "../../sip/types";
import type { SipClient } from "../../client";
import type { MediaModule } from "./types";

type CreateMediaModuleDeps = {
  client: SipClient;
  eventManager: SipEventManager;
};

export function createMediaModule(deps: CreateMediaModuleDeps): MediaModule {
  const { client, eventManager } = deps;

  return {
    getSession(sessionId: string) {
      return client.getSession(sessionId);
    },

    observePeerConnection(sessionId, onPeerConnection) {
      const session = client.getSession(sessionId);

      const initialPc =
        (session as { connection?: RTCPeerConnection } | null)?.connection ??
        null;
      onPeerConnection(initialPc);

      const offPeerConnection = eventManager.onSession(
        sessionId,
        "peerconnection",
        (payload) => {
          const pc =
            (payload as { peerconnection?: RTCPeerConnection })
              ?.peerconnection ?? null;
          onPeerConnection(pc);
        }
      );
      const offNewSession = eventManager.onUA("newRTCSession", (payload) => {
        const nextSession = (
          payload as
            | { session?: { id?: string; connection?: RTCPeerConnection } }
            | undefined
        )?.session;
        if (String(nextSession?.id ?? "") !== sessionId) return;
        onPeerConnection(nextSession?.connection ?? null);
      });

      return () => {
        offNewSession();
        offPeerConnection();
      };
    },

    buildRemoteStream(peerConnection: RTCPeerConnection | null) {
      if (
        !peerConnection ||
        typeof peerConnection.getReceivers !== "function"
      ) {
        return null;
      }

      const tracks = peerConnection
        .getReceivers()
        .map((receiver) => receiver.track)
        .filter((track): track is MediaStreamTrack => Boolean(track));

      if (tracks.length === 0) return null;
      return new MediaStream(tracks);
    },
  };
}
