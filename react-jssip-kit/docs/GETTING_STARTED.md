# Getting Started

This guide shows the minimal setup for a React softphone using
`react-jssip-kit`.

## 1. Install

```bash
npm install react-jssip-kit jssip
```

`react` and `react-dom` are peer dependencies and must already be installed in
your application.

## 2. Create the Kernel

The kernel owns the SIP runtime, state store, event manager, and media module.
Create it outside React render so it stays stable.

```tsx
import { SipProvider, createSipKernel } from "react-jssip-kit";

const sipKernel = createSipKernel();

export function App() {
  return (
    <SipProvider kernel={sipKernel}>
      <Softphone />
    </SipProvider>
  );
}
```

## 3. Connect to SIP

Call `connect(uri, password, config)` from inside `SipProvider`.

```tsx
import { useEffect } from "react";
import { WebSocketInterface, useSipActions } from "react-jssip-kit";

export function SipConnection() {
  const { connect, disconnect } = useSipActions();

  useEffect(() => {
    connect("sip:1001@example.com", "password", {
      sockets: [new WebSocketInterface("wss://sip.example.com/ws")],
      display_name: "Agent 1001",
      register: true,
    });

    return () => disconnect();
  }, [connect, disconnect]);

  return null;
}
```

## 4. Render Call Controls

```tsx
import {
  CallPlayer,
  useActiveSipSession,
  useSipActions,
  useSipState,
} from "react-jssip-kit";

export function CallControls() {
  const { sipStatus, error } = useSipState();
  const activeSession = useActiveSipSession();
  const { call, answer, hangup, toggleMute, toggleHold, sendDTMF } =
    useSipActions();

  return (
    <div>
      <div>Status: {sipStatus}</div>
      {error && <div role="alert">{error}</div>}

      <button onClick={() => call("sip:1002@example.com")}>Call</button>
      <button
        disabled={!activeSession}
        onClick={() => activeSession && answer(activeSession.id)}
      >
        Answer
      </button>
      <button
        disabled={!activeSession}
        onClick={() => activeSession && hangup(activeSession.id)}
      >
        Hang up
      </button>
      <button onClick={() => toggleMute(activeSession?.id)}>Mute</button>
      <button onClick={() => toggleHold(activeSession?.id)}>Hold</button>
      <button
        disabled={!activeSession}
        onClick={() => activeSession && sendDTMF(activeSession.id, "1")}
      >
        DTMF 1
      </button>

      <CallPlayer sessionId={activeSession?.id} />
    </div>
  );
}
```

## 5. Work with Sessions

For a full list:

```tsx
const { sessions } = useSipSessions();
```

For one known session:

```tsx
const session = useSipSession(sessionId);
```

For lean subscriptions:

```tsx
const ringingSession = useSipSelector((state) =>
  state.sessions.find((session) => session.status === "ringing")
);
```

## 6. Disconnect Cleanly

Always call `disconnect()` when an account logs out, a SIP identity changes, or
the provider is about to be removed.

```tsx
const { disconnect } = useSipActions();

disconnect();
```

Disconnect stops the UA, clears sessions, detaches runtime listeners, and resets
public state.
