# Recipes

These examples focus on common softphone behavior. They assume your app is
already wrapped with `SipProvider`.

## Incoming Call Dialog

```tsx
import { useSipActions, useSipSelector } from "react-jssip-kit";

export function IncomingCallDialog() {
  const ringing = useSipSelector((state) =>
    state.sessions.find((session) => session.status === "ringing")
  );
  const { answer, hangup } = useSipActions();

  if (!ringing) return null;

  return (
    <dialog open>
      <p>Incoming call from {ringing.from}</p>
      <button onClick={() => answer(ringing.id)}>Answer</button>
      <button onClick={() => hangup(ringing.id)}>Reject</button>
    </dialog>
  );
}
```

## Remote Audio

Use `CallPlayer` for a simple audio element.

```tsx
import { CallPlayer, useActiveSipSession } from "react-jssip-kit";

export function RemoteAudio() {
  const session = useActiveSipSession();
  return <CallPlayer sessionId={session?.id} />;
}
```

Use `useSessionMedia` when you need direct access to the stream or peer
connection.

```tsx
const { remoteStream, peerConnection, audioTracks } =
  useSessionMedia(sessionId);
```

## SIP MESSAGE

```tsx
import { useSipActions, useSipMessages } from "react-jssip-kit";

export function MessagePanel() {
  const messages = useSipMessages();
  const { sendMessage } = useSipActions();

  return (
    <div>
      {messages.map((message) => (
        <p key={message.id}>{message.body}</p>
      ))}
      <button onClick={() => sendMessage("sip:1002@example.com", "Hello")}>
        Send
      </button>
    </div>
  );
}
```

## Call Timer

```tsx
import { useActiveSipSession, useCallTimer } from "react-jssip-kit";

export function ActiveCallTimer() {
  const session = useActiveSipSession();
  const seconds = useCallTimer(session?.id);

  return <span>{seconds}s</span>;
}
```

## Call Quality

```tsx
import { useActiveSipSession, useCallQuality } from "react-jssip-kit";

export function QualityBadge() {
  const session = useActiveSipSession();
  const quality = useCallQuality(session?.id);

  return <span>{quality.level}</span>;
}
```

`useCallQuality` polls WebRTC stats and reports RTT, packet loss, jitter, and a
derived quality level.

## ICE Restart

```tsx
import { useSessionIceFailed, useSipActions } from "react-jssip-kit";

export function IceRestart() {
  const { reinvite } = useSipActions();

  useSessionIceFailed(({ sessionId }) => {
    reinvite(sessionId, {
      rtcOfferConstraints: {
        iceRestart: true,
      },
    });
  });

  return null;
}
```

## Microphone Drop Recovery

`react-jssip-kit` can notify you when the sender or audio track fails. When the
track is still live, the internal media module can self-heal. When the track is
dead, request a fresh stream in your app and attach it to the session.

```tsx
import { useMicDrop, useSipActions } from "react-jssip-kit";

export function MicRecovery() {
  const { reinvite, setSessionMedia } = useSipActions();

  useMicDrop(async ({ sessionId, trackLive }) => {
    if (trackLive) return;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    setSessionMedia(sessionId, stream);
    reinvite(sessionId);
  });

  return null;
}
```

Enable mic recovery in the connect config when you want this behavior:

```ts
connect(uri, password, {
  sockets,
  enableMicRecovery: true,
});
```

## Debug Helpers

Enable debug from React code:

```tsx
const { setDebug } = useSipActions();

setDebug(true);
```

Enable debug from the browser console:

```ts
window.sipSupport.enableDebug();
```

Then refresh the page. The helper persists the debug flag in `sessionStorage`,
enables the default JsSIP debug pattern, and asks the runtime bridge to sync the
active client when it is available.

Useful console helpers:

```ts
window.sipSupport.disableDebug();
window.sipSupport.toggleDebug();
window.sipSupport.debugState();
window.sipSupport.sipState();
window.sipSupport.sipSessions();
```

When debug is enabled, the runtime exposes current SIP state and sessions for
inspection and logs SIP state transitions.
