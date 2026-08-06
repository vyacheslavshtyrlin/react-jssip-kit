import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSipKernel } from "./useSip";
import { useSipSelector } from "./useSipSelector";
import type { SessionMediaState } from "../core/modules/media/types";
import { CallStatus } from "../core/contracts/state";

export function useSessionMedia(sessionId?: string): SessionMediaState {
  const { media } = useSipKernel();
  const sessions = useSipSelector((state) => state.sessions);
  const [peerConnection, setPeerConnection] =
    useState<RTCPeerConnection | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const trackIdsRef = useRef<string>("");

  const resolvedSessionId = useMemo(() => {
    if (sessionId) return sessionId;
    const active = sessions.find((s) => s.status === CallStatus.Active);
    return active?.id ?? sessions[0]?.id;
  }, [sessionId, sessions]);

  const session = resolvedSessionId
    ? media.getSession(resolvedSessionId)
    : null;
  const sessionState = useMemo(() => {
    if (!resolvedSessionId) return null;
    return sessions.find((s) => s.id === resolvedSessionId) ?? null;
  }, [sessions, resolvedSessionId]);

  const updateRemoteStream = useCallback(
    (pc: RTCPeerConnection | null) => {
      if (!pc) {
        trackIdsRef.current = "";
        setRemoteStream(null);
        return;
      }
      const receivers = pc.getReceivers?.() ?? [];
      const nextIds = receivers
        .map((r) => r.track?.id ?? "")
        .filter(Boolean)
        .sort()
        .join(",");
      if (nextIds === trackIdsRef.current) return;
      trackIdsRef.current = nextIds;
      setRemoteStream(media.buildRemoteStream(pc));
    },
    [media]
  );

  useEffect(() => {
    if (!resolvedSessionId) {
      setPeerConnection(null);
      trackIdsRef.current = "";
      setRemoteStream(null);
      return;
    }

    const off = media.observePeerConnection(resolvedSessionId, (pc) => {
      trackIdsRef.current = "";
      setPeerConnection(pc);
      updateRemoteStream(pc);
    });
    return off;
  }, [media, resolvedSessionId, updateRemoteStream]);

  useEffect(() => {
    if (!peerConnection) {
      trackIdsRef.current = "";
      setRemoteStream(null);
      return;
    }

    const update = () => updateRemoteStream(peerConnection);

    const onConnectionStateChange = () => {
      const state = peerConnection.connectionState;
      if (state === "connected" || state === "failed" || state === "closed") {
        update();
      }
    };

    const onIceStateChange = () => {
      const state = peerConnection.iceConnectionState;
      if (
        state === "connected" ||
        state === "completed" ||
        state === "failed"
      ) {
        update();
      }
    };

    peerConnection.addEventListener("track", update);
    peerConnection.addEventListener(
      "connectionstatechange",
      onConnectionStateChange
    );
    peerConnection.addEventListener(
      "iceconnectionstatechange",
      onIceStateChange
    );
    update();

    return () => {
      peerConnection.removeEventListener("track", update);
      peerConnection.removeEventListener(
        "connectionstatechange",
        onConnectionStateChange
      );
      peerConnection.removeEventListener(
        "iceconnectionstatechange",
        onIceStateChange
      );
    };
  }, [peerConnection, updateRemoteStream]);

  const tracks = remoteStream?.getTracks() ?? [];
  const audioTracks = tracks.filter((track) => track.kind === "audio");

  if (!sessionState) {
    return {
      sessionId: resolvedSessionId ?? "",
      session,
      peerConnection,
      remoteStream,
      audioTracks,
    };
  }

  return {
    sessionId: sessionState.id,
    session,
    peerConnection,
    remoteStream,
    audioTracks,
  };
}
