import { useEffect, useRef } from "react";
import { useSessionMedia } from "../hooks/useSessionMedia";
import { createPlaybackController } from "./call-player.playback";

export type CallPlayerProps = {
  sessionId?: string;
  onPlaybackBlocked?: (error: unknown) => void;
};

export function CallPlayer({ sessionId, onPlaybackBlocked }: CallPlayerProps) {
  const { peerConnection, remoteStream } = useSessionMedia(sessionId);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onPlaybackBlockedRef = useRef(onPlaybackBlocked);

  useEffect(() => {
    onPlaybackBlockedRef.current = onPlaybackBlocked;
  }, [onPlaybackBlocked]);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return;
    const playback = createPlaybackController(audioEl, (error) =>
      onPlaybackBlockedRef.current?.(error)
    );
    const play = playback.requestPlay;

    audioEl.srcObject = remoteStream;
    play();
    const tracks = remoteStream?.getAudioTracks() ?? [];
    tracks.forEach((track) => track.addEventListener("unmute", play));
    const retryEvents = ["canplay", "pause", "stalled"] as const;
    retryEvents.forEach((event) => audioEl.addEventListener(event, play));
    const onConnectionStateChange = () => {
      if (peerConnection?.connectionState === "connected") play();
    };
    peerConnection?.addEventListener(
      "connectionstatechange",
      onConnectionStateChange
    );
    return () => {
      playback.dispose();
      tracks.forEach((track) => track.removeEventListener("unmute", play));
      retryEvents.forEach((event) => audioEl.removeEventListener(event, play));
      peerConnection?.removeEventListener(
        "connectionstatechange",
        onConnectionStateChange
      );
      if (audioEl.srcObject === remoteStream) audioEl.srcObject = null;
    };
  }, [peerConnection, remoteStream]);

  return <audio ref={audioRef} autoPlay playsInline />;
}
