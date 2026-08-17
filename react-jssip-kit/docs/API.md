# API Reference

The only supported import path is the package root:

```ts
import { SipProvider, useSipActions } from "react-jssip-kit";
```

Internal files and `dist/*` paths are not public API.

## JsSIP References

Most configuration and option objects are native JsSIP objects. Use the official
JsSIP docs together with [JsSIP Interop](./JSSIP_INTEROP.md):

| Topic                                 | Link                                                             |
| ------------------------------------- | ---------------------------------------------------------------- |
| JsSIP API index                       | https://jssip.net/documentation/3.10.x/api/                      |
| `JsSIP.UA` methods and events         | https://jssip.net/documentation/3.10.x/api/ua/                   |
| UA configuration parameters           | https://jssip.net/documentation/api/ua_configuration_parameters/ |
| `JsSIP.RTCSession` options and events | https://jssip.net/documentation/3.10.x/api/session/              |

`connect(uri, password, config)` intentionally keeps `uri` and `password` as the
first two arguments. The third argument is `SipConfiguration`, which is JsSIP
`UAConfiguration` without `uri`/`password`, plus wrapper fields such as
`reconnect`, `maxSessionCount`, `enableMicRecovery`, and
`iceCandidateReadyDelayMs`.

## Provider

### `SipProvider`

Injects a ready `SipKernel` into the React tree.

```tsx
<SipProvider kernel={kernel}>{children}</SipProvider>
```

Props:

| Prop       | Type              | Description                             |
| ---------- | ----------------- | --------------------------------------- |
| `kernel`   | `SipKernel`       | Runtime created by `createSipKernel()`. |
| `children` | `React.ReactNode` | Components that consume SIP hooks.      |

## Factories

| Export                      | Description                                               |
| --------------------------- | --------------------------------------------------------- |
| `createSipKernel()`         | Creates the recommended app-level SIP runtime.            |
| `createSipClientInstance()` | Creates the lower-level client facade used by the kernel. |
| `createSipEventManager()`   | Creates the event manager adapter.                        |

## Hooks

| Hook                                            | Returns                      | Use for                                               |
| ----------------------------------------------- | ---------------------------- | ----------------------------------------------------- |
| `useSipKernel()`                                | `SipKernel`                  | Direct access to commands, store, events, and media.  |
| `useSipState()`                                 | `SipState`                   | Full public SIP state.                                |
| `useSipSelector(selector)`                      | selected value               | Minimal state subscriptions.                          |
| `useSipActions()`                               | command facade               | Calls, registration, messages, media mutation, debug. |
| `useSipSessions()`                              | `{ sessions }`               | Rendering all public sessions.                        |
| `useSipSession(sessionId)`                      | `SipSessionState \| null`    | Reading one session by id.                            |
| `useActiveSipSession()`                         | `SipSessionState \| null`    | Reading the first active call.                        |
| `useSessionMedia(sessionId?)`                   | `SessionMediaState`          | Remote stream, audio tracks, peer connection.         |
| `useSipEvent(event, handler)`                   | `void`                       | UA-level event subscriptions.                         |
| `useSipSessionEvent(sessionId, event, handler)` | `void`                       | Session-level event subscriptions.                    |
| `useMicDrop(handler)`                           | `void`                       | Microphone sender/track failure notifications.        |
| `useSessionIceFailed(handler)`                  | `void`                       | ICE failure notification per session.                 |
| `useSessionIceRecoveryExhausted(handler)`       | `void`                       | ICE recovery attempts are exhausted.                  |
| `useCallTimer(sessionId?)`                      |
| umber`                                          | Elapsed active-call seconds. |
| `useCallQuality(sessionId?)`                    | `CallQuality \| null`        | WebRTC stats-derived quality snapshot.                |
| `useSipMessages(filter?)`                       | `SipMessage[]`               | Inbound and outbound SIP MESSAGE history.             |

## Actions

`useSipActions()` returns these commands:

| Command            | Signature                                              | Description                                      |
| ------------------ | ------------------------------------------------------ | ------------------------------------------------ |
| `connect`          | `(uri, password, config) => void`                      | Creates and starts the JsSIP UA.                 |
| `disconnect`       | `() => void`                                           | Stops UA, cleans sessions, resets state.         |
| `register`         | `() => void`                                           | Registers the current UA.                        |
| `setDebug`         | `(debug?) => void`                                     | Enables or disables runtime debug helpers.       |
| `call`             | `(target, options?) => void`                           | Starts an outgoing call.                         |
| `answer`           | `(sessionId, options?) => boolean`                     | Answers an incoming session.                     |
| `hangup`           | `(sessionId, options?) => boolean`                     | Terminates one session.                          |
| `hangupAll`        | `(options?) => boolean`                                | Terminates all sessions.                         |
| `toggleMute`       | `(sessionId?) => boolean`                              | Toggles audio mute on a session.                 |
| `toggleHold`       | `(sessionId?) => boolean`                              | Toggles hold on a session.                       |
| `sendDTMF`         | `(sessionId, tones, options?) => boolean`              | Sends DTMF tones.                                |
| `transfer`         | `(sessionId, target, options?) => boolean`             | Performs blind transfer.                         |
| `attendedTransfer` | `(sessionId, replaceSessionId) => boolean`             | Performs attended transfer with Replaces.        |
| `sendInfo`         | `(sessionId, contentType, body?, options?) => boolean` | Sends SIP INFO.                                  |
| `update`           | `(sessionId, options?) => boolean`                     | Sends session update.                            |
| `reinvite`         | `(sessionId, options?) => boolean`                     | Sends re-INVITE.                                 |
| `sendMessage`      | `(target, body, options?) => boolean`                  | Sends SIP MESSAGE.                               |
| `sendOptions`      | `(target, body?, options?) => boolean`                 | Sends SIP OPTIONS.                               |
| `getSession`       | `(sessionId) => RTCSession \| null`                    | Reads the raw JsSIP session.                     |
| `getSessionIds`    | `() => string[]`                                       | Reads current session ids.                       |
| `getSessions`      | `() => RTCSession[]`                                   | Reads raw JsSIP sessions.                        |
| `setSessionMedia`  | `(sessionId, stream) => void`                          | Assigns media to an existing or pending session. |

## State

```ts
type SipState = {
  sipStatus: SipStatus;
  error: string | null;
  sessions: SipSessionState[];
};

type SipSessionState = {
  id: string;
  status: CallStatus;
  direction: "local" | "remote" | null;
  from: string | null;
  to: string | null;
  muted: boolean;
  acceptedAt: number | null;
  headers: Record<string, string>;
};
```

### `SipStatus`

| Value                | Meaning                             |
| -------------------- | ----------------------------------- |
| `disconnected`       | No active UA connection.            |
| `connecting`         | UA connection is starting.          |
| `reconnecting`       | Automatic reconnect is in progress. |
| `connected`          | Transport is connected.             |
| `registered`         | SIP registration succeeded.         |
| `unregistered`       | UA is connected but not registered. |
| `registrationFailed` | SIP registration failed.            |

### `CallStatus`

| Value        | Meaning                                         |
| ------------ | ----------------------------------------------- |
| `idle`       | Session is initialized but not active.          |
| `dialing`    | Outgoing call is being placed.                  |
| `ringing`    | Incoming call is ringing.                       |
| `earlyMedia` | Remote 183 Session Progress with SDP is active. |
| `active`     | Call is confirmed and active.                   |
| `hold`       | Call is held.                                   |

## Events

Use `useSipEvent` for UA events and `useSipSessionEvent` for session events.
The event names and payloads are typed from the exported event maps.

```tsx
useSipEvent("registered", handleRegistered);
useSipSessionEvent(sessionId, "confirmed", handleConfirmed);
```

For lower-level integrations, the kernel also exposes:

```ts
kernel.events.onUA(event, handler);
kernel.events.onSession(sessionId, event, handler);
kernel.events.onMicDrop(handler);
kernel.events.onSessionIceFailed(handler);
kernel.events.onSessionIceRecoveryExhausted(handler);
```

Each event subscription returns an unsubscribe function.

### Browser Debug Helper

In browser builds, the package exposes a support helper on `window`:

```ts
window.sipSupport.enableDebug();
```

Call it from DevTools and refresh the page. It persists the JsSIP debug setting
in `sessionStorage`. Related helpers: `disableDebug()`, `toggleDebug()`,
`debugState()`, `sipState()`, and `sipSessions()`.

## Components

### `CallPlayer`

Small remote audio helper backed by `useSessionMedia()`.

```tsx
<CallPlayer sessionId={sessionId} />
```

If `sessionId` is omitted, `useSessionMedia` resolves the active session first,
then falls back to the first known session.

## Configuration

### `SipConfiguration`

```ts
type SipConfiguration = Omit<UAConfiguration, "password" | "uri"> & {
  debug?: boolean | string;
  enableMicRecovery?: boolean;
  micRecoveryIntervalMs?: number;
  micRecoveryMaxRetries?: number;
  maxSessionCount?: number;
  iceCandidateReadyDelayMs?: number;
  autoIceRestart?:
    | boolean
    | {
        maxAttempts?: number;
        disconnectedDelayMs?: number;
        retryDelayMs?: number;
      };
  reconnect?: {
    enabled: boolean;
    maxAttempts?: number;
    delayMs?: number;
    backoffMultiplier?: number;
  };
};
```

Common JsSIP fields passed through in `SipConfiguration` include `sockets`,
`display_name`, `authorization_user`, `authorization_jwt`, `extra_headers`,
`register`, `register_expires`, `registrar_server`, `session_timers`,
`session_timers_refresh_method`,
o_answer_timeout`, `contact_uri`,
`use_preloaded_route`, and `user_agent`.

Wrapper-only fields:

| Field                      | Behavior                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `debug`                    | Enables JsSIP debug output; string values are used as debug namespace patterns.                                                 |
| `enableMicRecovery`        | Starts mic sender/track monitoring after a session is confirmed.                                                                |
| `micRecoveryIntervalMs`    | Overrides the polling interval; must be a finite positive number.                                                               |
| `micRecoveryMaxRetries`    | Overrides max recovery attempts; accepts a non-negative integer or `Infinity`.                                                  |
| `maxSessionCount`          | Limits simultaneous remote sessions; rejects excess ones with `486 Busy Here`. Accepts a non-negative integer or `Infinity`.    |
| `iceCandidateReadyDelayMs` | Delays JsSIP `icecandidate.ready()`; must be a finite non-negative number.                                                      |
| `autoIceRestart`           | `true` uses defaults; object form configures `maxAttempts` (default 1), `disconnectedDelayMs` (7000), and `retryDelayMs` (250). |
| `reconnect`                | Enables wrapper-level reconnect after unexpected UA disconnect.                                                                 |

## Call and Session Options

`CallOptions`, `AnswerOptions`, `TerminateOptions`, `DTMFOptions`,
`ReferOptions`, `RenegotiateOptions`, and `SendMessageOptions` are exported from
JsSIP types and accepted directly by the matching commands.

| Command                                                       | Options              | Key fields                                                                                                                                             |
| ------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `call(target, options)`                                       | `CallOptions`        | `mediaConstraints`, `mediaStream`, `pcConfig`, `rtcOfferConstraints`, `extraHeaders`, `eventHandlers`, `anonymous`, `fromUserName`, `fromDisplayName`. |
| `answer(sessionId, options)`                                  | `AnswerOptions`      | `mediaConstraints`, `mediaStream`, `pcConfig`, `rtcAnswerConstraints`, `rtcOfferConstraints`, `sessionTimersExpires`, `extraHeaders`.                  |
| `hangup(sessionId, options)`                                  | `TerminateOptions`   | `status_code`, `reason_phrase`, `body`, `cause`, `extraHeaders`.                                                                                       |
| `sendDTMF(sessionId, tones, options)`                         | `DTMFOptions`        | `duration`, `interToneGap`, `transportType`, `extraHeaders`.                                                                                           |
| `transfer(sessionId, target, options)`                        | `ReferOptions`       | `extraHeaders`, `eventHandlers`, `replaces`.                                                                                                           |
| `update(sessionId, options)` / `reinvite(sessionId, options)` | `RenegotiateOptions` | `useUpdate`, `extraHeaders`, `rtcOfferConstraints`.                                                                                                    |
| `sendMessage(target, body, options)`                          | `SendMessageOptions` | `contentType`, `eventHandlers`, `extraHeaders`, `fromUserName`, `fromDisplayName`.                                                                     |

For detailed behavior and examples, see [JsSIP Interop](./JSSIP_INTEROP.md).

## Runtime Behavior

Important behavior implemented by `react-jssip-kit` on top of JsSIP:

| Behavior                                                                                                                      | Details                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Auto-hold                                                                                                                     | On                                                                                                                                              |
| ewRTCSession`, `accepted`, and `unhold`, other `active` sessions are asked to hold before the current session becomes active. |
| Max sessions                                                                                                                  | `maxSessionCount` limits only remote sessions and rejects excess new ones with SIP `486 Busy Here`; outgoing sessions do not consume the limit. |
| Early media                                                                                                                   | Outgoing `progress` with a remote SDP body sets status `earlyMedia`.                                                                            |
| Media stream timing                                                                                                           | `call(..., { mediaStream })` stores stream before `ua.call()` because JsSIP can emit                                                            |
| ewRTCSession` synchronously.                                                                                                  |
| Reconnect                                                                                                                     | Unexpected UA disconnect cleans sessions and enters `reconnecting` when wrapper reconnect is enabled.                                           |
| Cleanup                                                                                                                       | `disconnect()` stops UA, detaches runtime listeners, removes session handlers, clears media recovery, and resets public state.                  |
