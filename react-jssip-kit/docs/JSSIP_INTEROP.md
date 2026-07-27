# JsSIP Interop

`react-jssip-kit` is intentionally thin around JsSIP. It owns React state,
provider wiring, lifecycle cleanup, media helpers, and a few opinionated call
behaviors, while most SIP/WebRTC configuration objects are passed through to
JsSIP with the same shape and TypeScript types.

## Official JsSIP Docs

Use these official references when you need provider-specific or SIP-level
details:

| Topic                                           | Link                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| JsSIP API index                                 | https://jssip.net/documentation/3.10.x/api/                      |
| `JsSIP.UA` methods and events                   | https://jssip.net/documentation/3.10.x/api/ua/                   |
| UA configuration parameters                     | https://jssip.net/documentation/api/ua_configuration_parameters/ |
| `JsSIP.RTCSession` methods, options, and events | https://jssip.net/documentation/3.10.x/api/session/              |
| JsSIP GitHub                                    | https://github.com/versatica/JsSIP                               |

This package currently depends on `jssip` through the package peer dependency
and reuses the installed JsSIP declaration types for events and options.

## Type Mapping

| react-jssip-kit type | Source                                                           | Notes                                       |
| -------------------- | ---------------------------------------------------------------- | ------------------------------------------- |
| `SipConfiguration`   | `UAConfiguration` without `uri` and `password`, plus kit options | Passed to `connect(uri, password, config)`. |
| `CallOptions`        | `jssip/lib/UA` `CallOptions`                                     | Used by `call(target, options)`.            |
| `AnswerOptions`      | `jssip/lib/RTCSession` `AnswerOptions`                           | Used by `answer(sessionId, options)`.       |
| `TerminateOptions`   | `jssip/lib/RTCSession` `TerminateOptions`                        | Used by `hangup` and `hangupAll`.           |
| `DTMFOptions`        | `jssip/lib/RTCSession` `DTMFOptions`                             | Used by `sendDTMF`.                         |
| `ReferOptions`       | `jssip/lib/RTCSession` `ReferOptions`                            | Used by `transfer`.                         |
| `RenegotiateOptions` | `jssip/lib/RTCSession` `RenegotiateOptions`                      | Used by `update` and `reinvite`.            |
| `SendMessageOptions` | `jssip/lib/Message` `SendMessageOptions`                         | Used by `sendMessage`.                      |
| `RTCSessionEventMap` | `jssip/lib/RTCSession`                                           | Used by `useSipSessionEvent`.               |
| `UAEventMap`         | `jssip/lib/UA`                                                   | Used by `useSipEvent`.                      |

## Connection Config

`connect` separates credentials from the rest of the JsSIP UA config:

```tsx
connect("sip:alice@example.com", "password", {
  sockets: [new WebSocketInterface("wss://sip.example.com/ws")],
  display_name: "Alice",
  register: true,
  register_expires: 300,
});
```

Do not put `uri` or `password` inside the third argument. The library builds the
final JsSIP UA configuration internally as `{ ...config, uri, password }`.

### JsSIP UA Fields

These fields are passed through to `new JsSIP.UA(...)`:

| Field                              | Description                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `sockets`                          | Required WebSocket transport, usually `new WebSocketInterface("wss://...")` or an array. |
| `authorization_jwt`                | Bearer token credential for outgoing SIP requests.                                       |
| `authorization_user`               | Authentication username override.                                                        |
| `connection_recovery_max_interval` | Native JsSIP WebSocket recovery max interval in seconds.                                 |
| `connection_recovery_min_interval` | Native JsSIP WebSocket recovery min interval in seconds.                                 |
| `contact_uri`                      | Contact header URI override.                                                             |
| `display_name`                     | Display name for calls and messages.                                                     |
| `extra_headers`                    | Headers added to every request/response.                                                 |
| `instance_id`                      | UA instance id for GRUU.                                                                 |
| `no_answer_timeout`                | Incoming unanswered call timeout in seconds.                                             |
| `session_timers`                   | Enables SIP Session Timers.                                                              |
| `session_timers_refresh_method`    | `UPDATE` or `INVITE`.                                                                    |
| `session_timers_force_refresher`   | Forces outgoing calls to be session timer refresher.                                     |
| `realm` / `ha1`                    | Digest auth fields when not using plain password.                                        |
| `register`                         | Whether UA registers automatically after start.                                          |
| `register_expires`                 | Registration expiry in seconds.                                                          |
| `register_from_tag_trail`          | Static or generated trail for REGISTER From tag.                                         |
| `registrar_server`                 | Registrar SIP URI override.                                                              |
| `use_preloaded_route`              | Adds WebSocket-server Route header for outbound proxy setups.                            |
| `user_agent`                       | SIP User-Agent header value.                                                             |

See the official UA configuration page for provider-specific semantics.

### react-jssip-kit Fields

These fields are consumed by the wrapper and are not passed to `new JsSIP.UA`:

| Field                         | Default                   | Behavior                                                                       |
| ----------------------------- | ------------------------- | ------------------------------------------------------------------------------ |
| `debug`                       | inherited runtime setting | Enables JsSIP debug output. A string is passed as the debug namespace pattern. |
| `enableMicRecovery`           | `false`                   | Enables microphone sender/track monitoring after `confirmed`.                  |
| `micRecoveryIntervalMs`       | manager default           | Poll interval for mic recovery checks.                                         |
| `micRecoveryMaxRetries`       | manager default           | Maximum mic recovery attempts.                                                 |
| `maxSessionCount`             | `Infinity`                | Rejects new remote sessions with `486 Busy Here` when the limit is reached.    |
| `iceCandidateReadyDelayMs`    | unset                     | Controls delayed `icecandidate.ready()` handling for ICE candidate gathering.  |
| `reconnect.enabled`           | `false`                   | Enables wrapper-level reconnect after unexpected UA disconnect.                |
| `reconnect.maxAttempts`       | manager default           | Maximum wrapper reconnect attempts.                                            |
| `reconnect.delayMs`           | manager default           | Initial reconnect delay in milliseconds.                                       |
| `reconnect.backoffMultiplier` | manager default           | Multiplier applied between reconnect attempts.                                 |

## Call Options

`call(target, options)` forwards `options` to `ua.call(target, options)`.
Common fields from JsSIP are:

| Field                  | Description                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `mediaConstraints`     | Audio/video capture constraints. For audio-only softphones use `{ audio: true, video: false }`.                            |
| `mediaStream`          | Existing local stream to send. The library stores it before `ua.call()` because JsSIP emits `newRTCSession` synchronously. |
| `pcConfig`             | `RTCPeerConnection` configuration, including STUN/TURN servers.                                                            |
| `rtcConstraints`       | Legacy peer connection constraints.                                                                                        |
| `rtcOfferConstraints`  | Constraints for `createOffer()`.                                                                                           |
| `rtcAnswerConstraints` | Constraints for future answers.                                                                                            |
| `sessionTimersExpires` | Session Timers interval in seconds.                                                                                        |
| `extraHeaders`         | Extra SIP headers for INVITE.                                                                                              |
| `eventHandlers`        | Per-session JsSIP event handlers. Prefer `useSipSessionEvent` for React code.                                              |
| `anonymous`            | Anonymous call flag.                                                                                                       |
| `fromUserName`         | Overrides From username.                                                                                                   |
| `fromDisplayName`      | Overrides From display name.                                                                                               |

Example:

```tsx
call("sip:bob@example.com", {
  mediaConstraints: { audio: true, video: false },
  pcConfig: {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  },
  extraHeaders: ["X-Trace-Id: call-123"],
});
```

## Answer, Hangup, DTMF, Transfer, and Renegotiation Options

| Command                                           | Options type         | Important fields                                                                                                                      |
| ------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `answer(sessionId, options)`                      | `AnswerOptions`      | `mediaConstraints`, `mediaStream`, `pcConfig`, `rtcAnswerConstraints`, `rtcOfferConstraints`, `sessionTimersExpires`, `extraHeaders`. |
| `hangup(sessionId, options)`                      | `TerminateOptions`   | `status_code`, `reason_phrase`, `body`, `cause`, `extraHeaders`.                                                                      |
| `sendDTMF(sessionId, tones, options)`             | `DTMFOptions`        | `duration`, `interToneGap`, `transportType`, `extraHeaders`.                                                                          |
| `transfer(sessionId, target, options)`            | `ReferOptions`       | `extraHeaders`, `eventHandlers`, `replaces`.                                                                                          |
| `attendedTransfer(sessionId, replaceSessionId)`   | internal wrapper     | Calls REFER with the raw JsSIP session from `replaceSessionId` as `replaces`.                                                         |
| `sendInfo(sessionId, contentType, body, options)` | `ExtraHeaders`       | `extraHeaders`.                                                                                                                       |
| `update(sessionId, options)`                      | `RenegotiateOptions` | `useUpdate`, `extraHeaders`, `rtcOfferConstraints`.                                                                                   |
| `reinvite(sessionId, options)`                    | `RenegotiateOptions` | Same runtime path as `update`; useful for ICE restart.                                                                                |

## MESSAGE and OPTIONS

| Command                              | JsSIP mapping                      | Options                                                                            |
| ------------------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------- |
| `sendMessage(target, body, options)` | `ua.sendMessage(...)`              | `contentType`, `eventHandlers`, `extraHeaders`, `fromUserName`, `fromDisplayName`. |
| `sendOptions(target, body, options)` | `ua.sendOptions(...)` when present | `contentType`, `eventHandlers`, `extraHeaders`.                                    |

## UA Events

Use `useSipEvent(event, handler)` for UA-level events. Payload types come from
JsSIP `UAEventMap`.

| Event                  | When it fires                                     | Wrapper behavior                                                                                             |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `connecting`           | Transport connection attempt.                     | Emitted to subscribers.                                                                                      |
| `connected`            | Transport connected.                              | State becomes `connected`; active wrapper reconnect is canceled.                                             |
| `disconnected`         | Transport disconnected or connection failed.      | Sessions are cleaned. If wrapper reconnect is enabled, state becomes `reconnecting`; otherwise state resets. |
| `registered`           | SIP registration succeeded.                       | State becomes `registered`.                                                                                  |
| `unregistered`         | SIP registration ended.                           | State becomes `unregistered`.                                                                                |
| `registrationFailed`   | SIP registration failed.                          | State becomes `registrationFailed` and `error` is set.                                                       |
| `registrationExpiring` | Registration is about to expire.                  | Emitted to subscribers; if you handle it directly, follow JsSIP rules for re-registering.                    |
| `newRTCSession`        | Incoming or outgoing INVITE session.              | Session is projected into public state and session handlers are attached.                                    |
| `newMessage`           | Incoming or outgoing SIP MESSAGE.                 | Emitted; `useSipMessages` also stores message history.                                                       |
| `newOptions`           | Incoming or outgoing SIP OPTIONS.                 | Emitted if supported by the installed JsSIP version.                                                         |
| `sipEvent`             | Out-of-dialog NOTIFY.                             | Emitted to subscribers.                                                                                      |
| `newSubscribe`         | Incoming/outgoing SUBSCRIBE in installed typings. | Emitted if supported by the installed JsSIP version.                                                         |

## Session Events

Use `useSipSessionEvent(sessionId, event, handler)` for `RTCSession` events.
Payload types come from JsSIP `RTCSessionEventMap`.

| Event                                       | Wrapper state/effect                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `peerconnection`                            | Emits event and starts ICE-failed monitoring for this peer connection.                                          |
| `connecting`                                | Emitted only.                                                                                                   |
| `sending`                                   | Emitted only.                                                                                                   |
| `progress`                                  | Emitted. For outgoing calls, a remote 1xx response with SDP body sets status to `earlyMedia`.                   |
| `accepted`                                  | Emits, auto-holds other active sessions, sets status `active`, and sets `acceptedAt` once.                      |
| `confirmed`                                 | Emits and enables microphone recovery when configured.                                                          |
| `ended`                                     | Emits, detaches handlers, cleans RTC/media resources, removes session state.                                    |
| `failed`                                    | Same cleanup path as `ended`.                                                                                   |
| `newDTMF`                                   | Emits incoming/outgoing DTMF payload.                                                                           |
| `newInfo`                                   | Emits incoming/outgoing SIP INFO payload.                                                                       |
| `hold`                                      | Emits and sets status `hold`.                                                                                   |
| `unhold`                                    | Emits, auto-holds other active sessions, then sets this session `active`.                                       |
| `muted`                                     | Emits and sets `muted: true`.                                                                                   |
| `unmuted`                                   | Emits and sets `muted: false`.                                                                                  |
| `reinvite`                                  | Emits only.                                                                                                     |
| `update`                                    | Emits only.                                                                                                     |
| `refer`                                     | Emits only; your app decides whether to accept or reject.                                                       |
| `replaces`                                  | Emits and auto-accepts the replacement event. Follow-up state changes flow through `ended` and `newRTCSession`. |
| `sdp`                                       | Emits only.                                                                                                     |
| `icecandidate`                              | Emits. If `iceCandidateReadyDelayMs` is set, the wrapper controls when `ready()` is called.                     |
| `getusermediafailed`                        | Emits and cleans the session.                                                                                   |
| `peerconnection:createofferfailed`          | Emits and cleans the session.                                                                                   |
| `peerconnection:createanswerfailed`         | Emits and cleans the session.                                                                                   |
| `peerconnection:setlocaldescriptionfailed`  | Emits and cleans the session.                                                                                   |
| `peerconnection:setremotedescriptionfailed` | Emits and writes a public `error`; the session is not immediately removed.                                      |

## Debug Helpers

The package root imports the browser debug helper as a side effect. In a browser
session you can enable JsSIP/runtime debugging from DevTools:

```ts
window.sipSupport.enableDebug();
```

Refresh after enabling. The helper stores the debug setting in `sessionStorage`,
enables the default JsSIP debug namespace pattern (`JsSIP:*`), and calls the
runtime bridge when a client is mounted.

Available browser helper methods:

| Method                             | Behavior                                                              |
| ---------------------------------- | --------------------------------------------------------------------- |
| `window.sipSupport.enableDebug()`  | Enables persisted JsSIP debug and runtime debug bridge.               |
| `window.sipSupport.disableDebug()` | Disables persisted debug.                                             |
| `window.sipSupport.toggleDebug()`  | Toggles persisted debug.                                              |
| `window.sipSupport.debugState()`   | Returns whether the browser helper currently considers debug enabled. |
| `window.sipSupport.sipState()`     | Reads `window.sipState()` when runtime debug is active.               |
| `window.sipSupport.sipSessions()`  | Reads `window.sipSessions()` when runtime debug is active.            |

From React code, use `setDebug(true)` from `useSipActions()` for the same active
runtime path.

## Opinionated Runtime Behavior

### Auto-hold

The library maintains a practical softphone invariant: only one session should be
`active` at a time.

Auto-hold happens in three places:

1. On every `newRTCSession`, existing sessions with status `active` are asked to
   hold before the new session is projected.
2. On `accepted`, other active sessions are held before the accepted session is
   marked `active`.
3. On `unhold`, other active sessions are held before the unheld session is
   marked `active`.

This means answering a second call, starting a new outgoing call, or unholding a
held call will automatically move the previous active call to hold when JsSIP can
renegotiate hold successfully.

### Max Session Guard

`maxSessionCount` only rejects new remote sessions. When the current session
count is already at the limit, an incoming call is terminated with SIP `486 Busy
Here`. Existing sessions are not affected.

### Early Media

For outgoing calls, `progress` with a remote response body is treated as early
media and sets the session status to `earlyMedia`.

### Media Stream Timing

JsSIP can emit `newRTCSession` synchronously during `ua.call()`. If you pass
`mediaStream` to `call`, the library stores it before calling JsSIP so the
session controller can consume it during `newRTCSession` handling.

For incoming calls, `answer(sessionId, { mediaStream })` stores the stream before
calling `session.answer(options)`.

### Reconnect

Wrapper reconnect is separate from JsSIP's native connection recovery fields.
When `reconnect.enabled` is set, an unexpected UA disconnect clears sessions,
sets `sipStatus` to `reconnecting`, and retries `connect` with the last known
arguments. Calling `disconnect()` marks the shutdown intentional and cancels the
reconnect manager.

### Cleanup

`disconnect()` stops the UA, detaches browser unload handling, removes session
handlers, cleans media/recovery resources, cleans debug helpers, and resets
public state.
