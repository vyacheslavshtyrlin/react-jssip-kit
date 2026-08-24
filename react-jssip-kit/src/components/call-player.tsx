import { useEffect, useRef } from "react";
import { useSessionMedia } from "../hooks/useSessionMedia";

export type CallPlayerProps = {
  sessionId?: string;
  onPlaybackBlocked?: (error: unknown) => void;
};

export function CallPlayer({ sessionId, onPlaybackBlocked }: CallPlayerProps) {
  const { peerConnection, remoteStream } = useSessionMedia(sessionId);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playInFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return;

    const play = () => {
      if (playInFlightRef.current) return;
      const result = audioEl.play?.();
      if (!result) return;
      playInFlightRef.current = result
        .catch(onPlaybackBlocked)
        .finally(() => {
          playInFlightRef.current = null;
        });
    };

    audioEl.srcObject = remoteStream;
    play();
    const tracks = remoteStream?.getAudioTracks() ?? [];
    tracks.forEach((track) => track.addEventListener("unmute", play));
    const onConnectionStateChange = () => {
      if (peerConnection?.connectionState === "connected") play();
    };
    peerConnection?.addEventListener(
      "connectionstatechange",
      onConnectionStateChange
    );
    return () => {
      tracks.forEach((track) => track.removeEventListener("unmute", play));
      peerConnection?.removeEventListener(
        "connectionstatechange",
        onConnectionStateChange
      );
      audioEl.srcObject = null;
    };
  }, [onPlaybackBlocked, peerConnection, remoteStream]);

  return <audio ref={audioRef} autoPlay playsInline />;
}
