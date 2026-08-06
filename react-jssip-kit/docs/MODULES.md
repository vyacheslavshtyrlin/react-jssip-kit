# react-jssip-kit: Modules and Lifecycle

This document describes the current architecture of `react-jssip-kit`. It is
intended for maintainers and integrators who need to understand module
ownership, runtime flow, and the public/internal boundary.

## 1) Public API Boundary

Stable entrypoint: `src/index.ts`.

Public runtime exports:

1. `SipProvider`
2. hooks: `useSipKernel`, `useSipState`, `useSipSelector`, `useSipActions`,
   `useSipEvent`, `useSipSessionEvent`, `useSipSessions`, `useSipSession`,
   `useActiveSipSession`, `useSessionMedia`, `useMicDrop`,
   `useSessionIceFailed`, `useCallTimer`, `useCallQuality`, `useSipMessages`
3. component: `CallPlayer`
4. factories: `createSipKernel`, `createSipClientInstance`,
   `createSipEventManager`
5. enums/constants: `SipStatus`, `CallStatus`, `CallDirection`
6. JsSIP helper: `WebSocketInterface`

Public type exports are aggregated through `src/core/public-types.ts` and the
package root. They include state/session types, JsSIP event names and payloads,
command option types, `SipConfiguration`, `SipKernel`, `CallQuality`, and
`SipMessage`.

Important boundary rules:

1. `SipState` is public and consumer-facing: `sipStatus`, `error`, `sessions`.
2. `sessionsById` and `sessionIds` are internal `InternalSipState` fields.
3. Consumers should import only from `react-jssip-kit`, not from `src/*`,
   `dist/*`, or internal module paths.

## 2) Layer Map

Top-level layers:

1. `src/core`: SIP domain/application runtime.
2. `src/hooks`: React bindings for state, commands, events, messages, media, and
   call diagnostics.
3. `src/provider`: React DI for a ready `SipKernel`.
4. `src/context`: React context contract.
5. `src/components`: optional UI helpers, currently `CallPlayer`.

Barrel files:

1. `src/index.ts`: package root and public API boundary.
2. `src/core/index.ts`, `src/core/client/index.ts`, `src/core/kernel/index.ts`:
   internal export barrels.

## 3) Core Modules

### 3.1 `core/client`

Files:

1. `src/core/client/sip.client.ts`
2. `src/core/client/index.ts`

Role:

1. main runtime facade over SIP operations,
2. orchestrates UA, session, media recovery, debug, browser unload, and
   reconnect runtime,
3. exposes methods consumed by kernel commands.

Responsibilities:

1. connect/register/disconnect control,
2. call/session operations: `call`, `answerSession`, `hangupSession`,
   `hangupAll`, `toggleMuteSession`, `toggleHoldSession`, `sendDTMFSession`,
   `transferSession`, `attendedTransferSession`, `sendInfoSession`,
   `updateSession`, `reinviteSession`, `setSessionMedia`,
3. UA-level operations: `sendMessage`, `sendOptions`,
4. public state bridge through `SipStateStore`,
5. wrapper reconnect through `ReconnectManager`,
6. debug setting resolution from runtime override, persisted session setting,
   connect config, or constructor default.

### 3.2 `core/kernel`

Files:

1. `src/core/kernel/createSipKernel.ts`
2. `src/core/kernel/types.ts`
3. `src/core/kernel/index.ts`

Role:

1. composition root for applications,
2. creates `SipClient`, event manager, and media module facade,
3. exposes the unified `SipKernel` contract used by `SipProvider` and hooks.

Kernel surface:

1. `client`: underlying `SipClient`,
2. `store`: `getState`, `subscribe`,
3. `commands`: call/UA/session/message/media/debug commands,
4. `events`: UA/session subscriptions plus `onMicDrop` and
   `onSessionIceFailed`,
5. `eventManager`: low-level event adapter,
6. `media`: peer-connection/session media observation API.

### 3.3 `core/contracts`

Files:

1. `src/core/contracts/state.ts`
2. `src/core/contracts/gateways.ts`
3. `src/core/contracts/events.ts`

Role:

1. shared domain contracts and state enums,
2. public vs internal state typing,
3. gateway/event interfaces used across core modules.

Current state shape:

1. public `SipState`: `sipStatus`, `error`, `sessions`,
2. internal `InternalSipState`: public state plus `sessionsById` and
   `sessionIds`.

### 3.4 `core/sip`

Files:

1. `src/core/sip/types.ts`
2. `src/core/sip/user-agent.ts`

Role:

1. JsSIP type boundary and public aliases,
2. `SipConfiguration` definition: JsSIP `UAConfiguration` without
   `uri/password`, plus wrapper-only config,
3. thin `SipUserAgent` wrapper for `start`, `stop`, `register`, UA creation,
   validation, and JsSIP debug enable/disable.

Design note: this layer isolates direct JsSIP setup and SDK-specific types from
higher-level orchestration modules.

### 3.5 `core/modules/session`

Files:

1. `session.module.ts`
2. `session.manager.ts`
3. `session.lifecycle.ts`
4. `session.handlers.ts`
5. `session.state.projector.ts`
6. `audio-bind.retry.ts`

Role:

1. call session behavior and lifecycle transitions,
2. mapping JsSIP session events into public state and app events,
3. RTC session controller ownership and cleanup.

Key responsibilities:

1. manage raw JsSIP sessions and `WebRTCSessionController` instances,
2. store pending media before synchronous JsSIP `newRTCSession` events,
3. enforce `maxSessionCount` for remote incoming sessions,
4. auto-hold other active sessions on `newRTCSession`, `accepted`, and
   `unhold`,
5. attach/detach per-session handlers,
6. project session state through `upsertSessionState` and `removeSessionState`,
7. expose command-level session actions with boolean success semantics,
8. handle local/remote audio bind retry and diagnostic logging.

### 3.6 `core/modules/ua`

Files:

1. `ua.module.ts`
2. `ua.handlers.ts`

Role:

1. UA registration/transport lifecycle,
2. attach/detach JsSIP UA handlers,
3. map UA events into the core emitter and public state.

Handled UA events:

1. `connecting`: emits event and sets `sipStatus` to `connecting`,
2. `connected`: emits event, sets `connected`, cancels active wrapper reconnect,
3. `disconnected`: emits event and delegates reconnect/reset behavior to
   `SipClient`,
4. `registered`: emits event, sets `registered`, clears `error`, cancels active
   wrapper reconnect,
5. `unregistered`: emits event and sets `unregistered`,
6. `registrationFailed`: emits event, sets `registrationFailed`, writes
   `error`,
7. `newRTCSession`: delegates to `SessionModule`,
8. `newMessage`, `sipEvent`, `newOptions`: emitted outward.

### 3.7 `core/modules/media`

Files:

1. `media.module.ts`
2. `mic-recovery.manager.ts`
3. `webrtc-session.controller.ts`
4. `types.ts`

Role:

1. media observation and session-bound media utilities,
2. optional microphone recovery strategy,
3. track/peer connection handling for `useSessionMedia`, `CallPlayer`, and
   call diagnostics.

Important behavior:

1. `MediaModule.observePeerConnection` subscribes by session id and reports the
   current `RTCPeerConnection`,
2. `MediaModule.buildRemoteStream` rebuilds a remote stream from peer connection
   receivers,
3. `MicRecoveryManager` monitors sender/track health and may self-heal when the
   sender track remains live,
4. mic recovery does not request user media internally; dead tracks require the
   application to call `getUserMedia`, `setSessionMedia`, and renegotiate.

### 3.8 `core/modules/state`

Files:

1. `sip.state.ts`
2. `sip.state.store.ts`
3. `sip.selectors.ts`
4. `state.store.ts`

Role:

1. state initialization and in-memory storage,
2. public/internal state projection,
3. subscriptions and batched updates,
4. selector helpers for hooks.

Current shape:

1. internal: normalized maps (`sessionsById`, `sessionIds`) plus public list
   (`sessions`),
2. public: `sipStatus`, `error`, `sessions`.

### 3.9 `core/modules/event`

Files:

1. `event-target.emitter.ts`
2. `sip-event-manager.adapter.ts`

Role:

1. internal event transport,
2. consumer-facing event subscription bridge.

Important behavior:

1. `onUA` subscribes directly to the `SipClient` emitter,
2. `onSession` is race-safe: it subscribes to `newRTCSession`, attaches to an
   existing session immediately when present, reattaches when the matching raw
   session appears, detaches on `disconnected`, and detaches on unsubscribe.

### 3.10 `core/modules/debug`

Files:

1. `sip-debug.runtime.ts`
2. `sip-debug.logger.ts`
3. `sip-debug.storage.ts`
4. `sip-debugger.ts`

Role:

1. runtime debug bridge and logging tools,
2. persisted debug setting parsing/serialization,
3. browser helper API for support/debug workflows,
4. optional SIP state and call stats logging.

Current behavior:

1. package root imports `./core/modules/debug/sip-debugger` as a side effect,
2. in the browser, `sip-debugger.ts` attaches `window.sipSupport` with `enableDebug`, `disableDebug`, `toggleDebug`, `debugState`, `sipState`, and `sipSessions`, and initializes JsSIP debug from `sessionStorage`,
3. `SipDebugRuntime` attaches `window.sipDebugBridge`, persists runtime debug
   overrides, exposes `window.sipState` and `window.sipSessions` when debug is
   enabled, and logs state transitions,
4. `sip-debug.logger.ts` is used by session/media modules for audio, ICE, and
   call stats diagnostics.

### 3.11 `core/modules/runtime`

Files:

1. `browser-unload.runtime.ts`
2. `reconnect.manager.ts`

Role:

1. browser lifecycle cleanup via `beforeunload`,
2. wrapper-level reconnect scheduling with max attempts, delay, and backoff.

## 4) React Bindings

### 4.1 Context and Provider

1. `src/context/index.tsx`: `SipContext`.
2. `src/provider/index.tsx`: injects a ready `SipKernel` into React.

### 4.2 Hooks

1. `useSip`: direct kernel access (`useSipKernel`).
2. `useSipState`: public state subscription via `useSyncExternalStore`.
3. `useSipSelector`: selector-based public state subscriptions.
4. `useSipInternalSelector`: internal selector helper used by session hooks.
5. `useSipActions`: memoized command facade.
6. `useSipEvent` and `useSipSessionEvent`: UA/session event subscriptions.
7. `useSipSessions`, `useSipSession`, `useActiveSipSession`: session selectors.
8. `useSessionMedia`: resolved session media, remote stream, audio tracks, and
   peer connection.
9. `useMicDrop`: mic recovery/drop event hook.
10. `useSessionIceFailed`: ICE failure event hook.
11. `useCallTimer`: elapsed seconds from `acceptedAt`.
12. `useCallQuality`: WebRTC stats polling for RTT, packet loss, jitter, and
    derived quality level.
13. `useSipMessages`: in-memory SIP MESSAGE history with optional `from` filter.

### 4.3 Component

1. `CallPlayer`: binds `remoteStream` from `useSessionMedia` into an auto-playing
   audio element.

## 5) Runtime Lifecycle

### 5.1 Bootstrap Lifecycle

1. App calls `createSipKernel()`.
2. Kernel creates `SipClient`, `SipEventManager`, and media facade.
3. `SipProvider` injects the kernel into the React tree.
4. Hooks consume the kernel through `useSipKernel()` or derived hooks.

### 5.2 UA Connect Lifecycle

1. `commands.connect(uri, password, config)` is called.
2. `SipClient.connect()` marks the next disconnect as non-intentional, cancels
   active wrapper reconnect, stops any existing UA/session runtime via
   `_stopUA()`, and sets `sipStatus` to `connecting`.
3. Wrapper-only config is consumed by `SipClient`; the remaining config is passed
   to `SipUserAgent.start(uri, password, uaCfg, debug)`.
4. `SipUserAgent` validates `uri`, `password`, and `sockets`, builds the final
   JsSIP UA config, applies debug, creates `new JsSIP.UA(...)`, and starts it.
5. UA handlers update public status as JsSIP emits transport/registration events.
6. Browser unload cleanup and debug inspector helpers are attached.

### 5.3 Outgoing Call Lifecycle

1. `commands.call(target, options)` delegates to `SipClient.call(...)`.
2. If `options.mediaStream` exists, it is stored as pending media before
   `ua.call(...)` because JsSIP may emit `newRTCSession` synchronously.
3. JsSIP emits `newRTCSession` with local originator.
4. `SessionLifecycle.handleNewRTCSession` creates/links the RTC controller,
   stores the raw session, attaches handlers, starts call stats logging hooks,
   attempts local outgoing audio binding when needed, auto-holds other active
   sessions, projects initial state as `dialing`, and emits `newRTCSession`.
5. If `ua.call(...)` throws after a synchronous `newRTCSession`, dialing phantom
   sessions are cleaned up.

### 5.4 Incoming Call Lifecycle

1. JsSIP emits `newRTCSession` with remote originator.
2. If `maxSessionCount` is reached, the incoming session is terminated with SIP
   `486 Busy Here` and no state is projected.
3. Otherwise the lifecycle creates/links the RTC controller, stores the raw
   session, attaches handlers, starts call stats logging hooks, starts incoming
   audio diagnostics, auto-holds other active sessions, projects state as
   `ringing`, stores initial INVITE headers, and emits `newRTCSession`.
4. Consumer may call `answer`, `hangup`, `toggleMute`, `toggleHold`, `sendDTMF`,
   `transfer`, `sendInfo`, `update`, or `reinvite` when the command is valid for
   the current session state.

### 5.5 Session Event Lifecycle

1. `progress`: emitted; outgoing remote 1xx with SDP body sets `earlyMedia`.
2. `accepted`: emitted; other active sessions are held, current session becomes
   `active`, and `acceptedAt` is set once.
3. `confirmed`: emitted; microphone recovery starts when enabled.
4. `hold` / `unhold`: emitted; `hold` sets status `hold`, `unhold` auto-holds
   other active sessions and sets current status `active`.
5. `muted` / `unmuted`: emitted; updates public `muted` state.
6. `peerconnection`: emitted; ICE failure listener is attached and emits
   `sessionIceFailed` once per session lifetime.
7. `icecandidate`: emitted; optional `iceCandidateReadyDelayMs` controls when
   JsSIP `ready()` is called.
8. `replaces`: emitted and auto-accepted; subsequent state changes flow through
   `ended` and `newRTCSession`.
9. `ended`, `failed`, `getusermediafailed`, and selected peerconnection failure
   events clean the session, detach handlers, remove listeners, clean RTC/media
   resources, and remove session state.
10. `peerconnection:setremotedescriptionfailed` emits and writes public `error`;
    it does not immediately remove the session.

### 5.6 Max Session and Auto-Hold Behavior

1. `maxSessionCount` applies to remote incoming sessions only.
2. When the remote limit is reached, the new incoming session is terminated with
   `486 Busy Here`; existing sessions are not touched.
3. Auto-hold is applied on `newRTCSession`, `accepted`, and `unhold` by asking
   other sessions with public status `active` to hold.
4. The public state follows JsSIP hold/unhold events; if JsSIP cannot renegotiate
   hold, the other session may remain active until a hold event is received.

### 5.7 Media Lifecycle

1. `useSessionMedia(sessionId?)` resolves the explicit session id, then the first
   active session, then the first known session.
2. `media.observePeerConnection(...)` subscribes to peer connection changes.
3. Hook rebuilds remote stream from receivers when tracks or final connection
   states change.
4. `CallPlayer` assigns `remoteStream` to an `<audio>` element and calls
   `play()` best-effort.

### 5.8 Mic Recovery Lifecycle

1. Enabled by `connect` config: `enableMicRecovery` and optional timing fields.
2. Recovery starts after session `confirmed`.
3. Manager monitors sender/track health and emits `micDrop` on failure.
4. When sender track is still live, manager can rebuild session media from the
   sender track.
5. When the track is dead, the app must request a new stream and call
   `setSessionMedia` plus `reinvite` or `update`.

### 5.9 Reconnect Lifecycle

1. `disconnect()` is intentional: it cancels reconnect, stops UA/session runtime,
   and resets state.
2. Unexpected UA `disconnected` cleans sessions.
3. If wrapper `reconnect.enabled` is true, state becomes `reconnecting` and
   `ReconnectManager` schedules attempts using `delayMs`, `backoffMultiplier`,
   and `maxAttempts`.
4. Each attempt restarts the UA with the last `connect` arguments.
5. `connected` or `registered` cancels active wrapper reconnect.
6. Exhausting attempts resets public state.

### 5.10 Event Subscription Lifecycle

1. `events.onUA(...)` subscribes directly to the client emitter.
2. `events.onSession(sessionId, event, handler)` subscribes to `newRTCSession`,
   attaches to an existing matching raw session immediately, reattaches when the
   matching raw session appears, detaches on UA `disconnected`, and detaches on
   unsubscribe.

### 5.11 Disconnect/Cleanup Lifecycle

1. `commands.disconnect()` marks shutdown intentional.
2. Reconnect manager is canceled.
3. Browser unload runtime is detached.
4. UA unregisters when registered and then stops.
5. Session handlers, call stats listeners, mic recovery, RTC controllers, raw
   sessions, and public session state are cleaned.
6. Debug runtime state logging is stopped.
7. Public state is reset.

## 6) State Model and Projection

Internal projection path:

1. UA handlers and session handlers update state synchronously through
   `setState`, `upsertSessionState`, `removeSessionState`, or
   `clearSessionsState`.
2. Projector updates normalized maps and public list incrementally.
3. Store exposes internal state to core modules and public state to consumers.

Public state contract:

1. `sipStatus`
2. `error`
3. `sessions`

Consumer guidance:

1. use public hooks/selectors,
2. do not depend on `sessionsById` or `sessionIds`,
3. use event hooks for JsSIP event payloads instead of attaching directly to raw
   sessions unless you intentionally opt into low-level JsSIP behavior.

## 7) Maintainer Change Checklist

When changing behavior:

1. update core logic in the relevant `core/modules/*` or `core/client` file,
2. verify `kernel/types.ts`, `createSipKernel.ts`, and `useSipActions` stay in
   sync for public commands,
3. verify `core/public-types.ts` and `src/index.ts` export new public types or
   runtime APIs,
4. update `README.md`, `docs/API.md`, `docs/JSSIP_INTEROP.md`, and this file for
   public API or lifecycle changes,
5. update `CHANGELOG.md` for public behavior changes,
6. run package build and targeted formatting checks before publishing.
