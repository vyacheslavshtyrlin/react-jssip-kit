export type WebRTCMissingCapability = "getUserMedia" | "RTCPeerConnection" | "WebSocket";

export type WebRTCCapabilities = {
  supported: boolean;
  missing: WebRTCMissingCapability[];
  secureContext: boolean;
};

export function getWebRTCCapabilities(): WebRTCCapabilities {
  const scope = globalThis as typeof globalThis & { navigator?: Navigator; isSecureContext?: boolean };
  const missing: WebRTCMissingCapability[] = [];
  if (!scope.navigator?.mediaDevices?.getUserMedia) missing.push("getUserMedia");
  if (typeof scope.RTCPeerConnection !== "function") missing.push("RTCPeerConnection");
  if (typeof scope.WebSocket !== "function") missing.push("WebSocket");
  return { supported: missing.length === 0 && scope.isSecureContext === true, missing, secureContext: scope.isSecureContext === true };
}
