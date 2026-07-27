# react-jssip-kit

Typed React hooks and a provider for building SIP/WebRTC calling UI on top of
[JsSIP](https://jssip.net/).

[![npm version](https://img.shields.io/npm/v/react-jssip-kit.svg)](https://www.npmjs.com/package/react-jssip-kit)
[![npm downloads](https://img.shields.io/npm/dm/react-jssip-kit.svg)](https://www.npmjs.com/package/react-jssip-kit)
[![license](https://img.shields.io/npm/l/react-jssip-kit.svg)](./LICENSE)
[![React](https://img.shields.io/badge/react-18%20%7C%2019-149eca.svg)](https://react.dev/)

`react-jssip-kit` gives React applications a small composition layer around
JsSIP: a kernel, a provider, selector hooks, session actions, event hooks, media
helpers, and a tiny remote audio component.

## Why use it

- **React-native ergonomics**: consume SIP status, sessions, messages, and call
  media through hooks.
- **Typed public surface**: exported TypeScript types for state, events, call
  options, and kernel commands.
- **Selector-first state**: `useSipSelector` keeps call controls and badges from
  re-rendering on unrelated session changes.
- **Call lifecycle helpers**: answer, hang up, hold, mute, transfer, DTMF, INFO,
  re-INVITE, MESSAGE, and OPTIONS are available from one action hook.
- **Media and recovery utilities**: remote audio binding, call quality polling,
  ICE failure events, and optional microphone drop detection.
- **No hidden UI framework**: bring your own interface and use the hooks where
  they fit.

## Installation

```bash
npm install react-jssip-kit jssip
```

Peer dependencies:

```text
react >=18 <20
react-dom >=18 <20
```

## Quick Start

Create one kernel for your app, pass it to `SipProvider`, then connect from a
component inside the provider.

```tsx
import { useEffect } from "react";
import {
  CallPlayer,
  SipProvider,
  WebSocketInterface,
  createSipKernel,
  useActiveSipSession,
  useSipActions,
  useSipState,
} from "react-jssip-kit";

const sipKernel = createSipKernel();

function SipConnection() {
  const { connect, disconnect } = useSipActions();

  useEffect(() => {
    connect("sip:alice@example.com", "super-secret-password", {
      sockets: [new WebSocketInterface("wss://sip.example.com/ws")],
      display_name: "Alice",
      register: true,
      reconnect: {
        enabled: true,
        maxAttempts: 6,
        delayMs: 1000,
        backoffMultiplier: 1.6,
      },
    });

    return () => disconnect();
  }, [connect, disconnect]);

  return null;
}

function Softphone() {
  const { sipStatus } = useSipState();
  const activeSession = useActiveSipSession();
  const { call, hangup, toggleHold, toggleMute } = useSipActions();

  return (
    <section>
      <p>SIP status: {sipStatus}</p>

      <button onClick={() => call("sip:bob@example.com")}>Call Bob</button>
      <button
        disabled={!activeSession}
        onClick={() => activeSession && hangup(activeSession.id)}
      >
        Hang up
      </button>
      <button onClick={() => toggleMute(activeSession?.id)}>Mute</button>
      <button onClick={() => toggleHold(activeSession?.id)}>Hold</button>

      <CallPlayer sessionId={activeSession?.id} />
    </section>
  );
}

export function App() {
  return (
    <SipProvider kernel={sipKernel}>
      <SipConnection />
      <Softphone />
    </SipProvider>
  );
}
```

## Documentation

| Guide                                        | What it covers                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| [Getting Started](./docs/GETTING_STARTED.md) | Installation, provider setup, connection lifecycle, and first call controls.         |
| [API Reference](./docs/API.md)               | Public exports, hooks, kernel commands, state, events, and types.                    |
| [JsSIP Interop](./docs/JSSIP_INTEROP.md)     | Official JsSIP links, events, configs, call options, and runtime behavior.           |
| [Recipes](./docs/RECIPES.md)                 | Incoming calls, remote audio, messages, call quality, mic recovery, and ICE restart. |
| [Modules and Lifecycle](./docs/MODULES.md)   | Internal architecture for maintainers and advanced integrators.                      |
| [Changelog](./CHANGELOG.md)                  | Release notes and migration notes.                                                   |

## Core Concepts

### Kernel

`createSipKernel()` builds the runtime object used by the provider. Keep the
kernel stable for the lifetime of the app or account session.

```tsx
const kernel = createSipKernel();

<SipProvider kernel={kernel}>
  <AppRoutes />
</SipProvider>;
```

### State

`useSipState()` returns the public state:

```ts
type SipState = {
  sipStatus: SipStatus;
  error: string | null;
  sessions: SipSessionState[];
};
```

Use `useSipSelector()` when a component only needs one slice:

```tsx
const sipStatus = useSipSelector((state) => state.sipStatus);
const ringing = useSipSelector((state) =>
  state.sessions.find((session) => session.status === "ringing")
);
```

### Actions

`useSipActions()` exposes the call and UA command surface:

```tsx
const {
  connect,
  disconnect,
  call,
  answer,
  hangup,
  hangupAll,
  toggleMute,
  toggleHold,
  sendDTMF,
  transfer,
  attendedTransfer,
  sendMessage,
  sendOptions,
  reinvite,
  setSessionMedia,
} = useSipActions();
```

### Events

Use event hooks when you need to react to JsSIP events without storing your own
listener registry.

```tsx
useSipEvent("registered", () => {
  console.log("SIP account is registered");
});

useSipSessionEvent(sessionId, "ended", () => {
  console.log("Call ended");
});
```

## Public API

The supported entrypoint is the package root:

```ts
import { SipProvider, useSipActions } from "react-jssip-kit";
```

Do not import from `react-jssip-kit/dist/*` or internal source paths. The public
surface includes:

- `SipProvider`
- Hooks: `useSipKernel`, `useSipState`, `useSipSelector`, `useSipActions`,
  `useSipEvent`, `useSipSessionEvent`, `useSipSessions`, `useSipSession`,
  `useActiveSipSession`, `useSessionMedia`, `useMicDrop`,
  `useSessionIceFailed`, `useCallTimer`, `useCallQuality`, `useSipMessages`
- Component: `CallPlayer`
- Factories: `createSipKernel`, `createSipClientInstance`,
  `createSipEventManager`
- JsSIP helper: `WebSocketInterface`
- Runtime constants: `SipStatus`, `CallStatus`, `CallDirection`
- Public TypeScript types for state, sessions, events, command options, and
  `SipKernel`

## Build

```bash
npm run build
```

The package builds ESM, CommonJS, and TypeScript declarations into `dist/`.

## License

MIT
