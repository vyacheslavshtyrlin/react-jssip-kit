# Changelog

## 1.2.5

- Fixed: `CallPlayer` no longer detaches and reattaches the remote stream when the `onPlaybackBlocked` callback identity changes.
- Fixed: playback recovery requests that arrive while `audio.play()` is pending are queued instead of being lost. Rapid `unmute`, connection, `canplay`, `pause`, and `stalled` signals are coalesced and rate-limited, and pending retries are cancelled during cleanup.
- Fixed: synchronous and asynchronous `audio.play()` failures are handled without leaving an unhandled rejection, while the latest `onPlaybackBlocked` callback is notified.
- Added: regression tests for pending playback recovery, retry throttling, rejected playback, and cleanup.

## 1.2.4

- Fixed: duplicate provisional SDP answers (for example, repeated identical `183 Session Progress` responses) no longer remove an otherwise active session when JsSIP reports `setRemoteDescription` with `Called in wrong state: stable`. The diagnostic event and `sipState.error` are preserved, while other remote-description failures remain terminal.

## 1.2.3

- Fixed: documentation, changelog, and license links in the npm README now use the correct GitHub monorepo paths.

## 1.2.2

- Fixed: updated repository, issues, and homepage links after the GitHub repository was renamed to `react-jssip-kit`.

## 1.2.1

- Fixed: an incoming INVITE is rejected with `486 Busy Here` before it can put an existing live session on hold when `maxSessionCount` is reached. Only attached `RTCSession` instances count toward the limit; pending media does not. Outgoing call initiation remains consumer-controlled.
- Fixed: global `failed` payloads include a stable `sessionId`, including rejected over-limit INVITEs, while preserving the native JsSIP event object when extensible. Added the public `SessionFailedPayload` type export.
- Fixed: unexpected SIP transport disconnects clear local session state before reconnect, matching JsSIP `UA.stop()` which terminates every RTCSession and preventing stale dialogs after reconnect.
- Fixed: all terminal WebRTC/session failures now clear only their affected session; `peerconnection:setremotedescriptionfailed` retains its diagnostic message in `sipState.error`.
- Added: internal `console.error` diagnostics for SIP registration, transport/reconnect, terminal session/WebRTC, and ICE recovery failures.
- Fixed: session event listener cleanup supports both `off` and `removeListener` EventEmitter APIs.

## 1.2.0

- Added: configurable automatic ICE recovery through `autoIceRestart`. `true` uses defaults; object form supports `maxAttempts` (default `1`), `disconnectedDelayMs` (default `7000`), and `retryDelayMs` (default `250`).
- Added: `sessionIceRecoveryExhausted`, `kernel.events.onSessionIceRecoveryExhausted()`, `useSessionIceRecoveryExhausted()`, and its public payload type for consumer-controlled call termination after recovery is exhausted.
- Added: `CallPlayer` retries remote audio playback after `track.unmute` and when the PeerConnection reaches `connected`.
- Fixed: ICE recovery handles a temporary JsSIP re-INVITE rejection without consuming an actual restart attempt, cleans timers/listeners after PeerConnection replacement and session completion, and bounds readiness retries.
- Fixed: wrapper-only ICE recovery configuration is excluded from JsSIP UA configuration during reconnect.
- Added: Vitest regression coverage for ICE restart retry, transient `disconnected`, and watchdog cancellation after reconnection.

## 1.1.3

- Fixed: `maxSessionCount` now limits only simultaneous incoming sessions; outgoing sessions do not consume the limit. Excess incoming INVITEs are rejected with SIP `486 Busy Here`.
- Fixed: max-limit rejection now forwards the native JsSIP `failed` event emitted by `RTCSession.terminate()` through a one-shot listener that is also removed when termination throws. The payload remains unmodified and therefore does not synthesize `status_code` or `reason_phrase`.
- Fixed: incoming-session slots are reserved atomically and released on every terminal path, partial initialization rollback, and full cleanup.
- Fixed: session registration is synchronous, and stale queued state updates can no longer restore an outdated SIP status after disconnect/reset.
- Fixed: UA lifecycle state written by event handlers is now updated synchronously before the corresponding public events are emitted; the unnecessary `queueMicrotask` batching layer and `batchSet` contract were removed.
- Fixed: exceptions thrown by SIP event listeners or state subscribers are isolated, logged, and no longer interrupt session lifecycle or other subscribers.
- Fixed: `pendingMedia` is always cleared after `call()`; a failed outgoing call now removes only sessions created by that call instead of all `dialing` sessions.
- Fixed: caller-provided `MediaStream` tracks are treated as externally owned and are detached without being stopped when one session is cleaned up.
- Fixed: `answerSession()` validates the session before storing its media stream, preventing media from being attached to a nonexistent session.
- Fixed: SIP/reconnect configuration is validated before the active UA is stopped; synchronous reconnect failures are logged and continue through the configured retry schedule.
- Fixed: partial session setup is rolled back through the common cleanup path, and terminal events no longer run WebRTC/state cleanup twice.
- Fixed: audio-bind retry timers, session listeners, PeerConnection listeners, and remote-track diagnostics are disposed on terminal/full-cleanup paths; partial listener attachment is rolled back and individual detach failures are isolated.
- Fixed: microphone recovery serializes polling attempts, handles rejected `replaceTrack()` calls, validates polling interval/retry configuration before disconnecting the active UA, and stops safely when a synchronous `micDrop` listener triggers cleanup.
- Fixed: `useCallQuality()` no longer overlaps `getStats()` calls or applies stale results after a session/PeerConnection change.
- Fixed: media observers now remain subscribed when mounted before their session exists; `useSessionMedia()` also invalidates its track cache when the PeerConnection changes.
- Fixed: JsSIP constructor validation now runs before the active UA is stopped; UA handlers are attached before transport startup, stale reconnect handlers are detached, and partial handler attachment/startup is rolled back safely.

## 1.0.5

- Added: `SipSessionState.headers` — SIP headers from the initial INVITE are now stored in session state as `Record<string, string>` (lowercase keys). Accessible via `useSipSession(sessionId)?.headers['x-custom-header']` without subscribing to `newRTCSession`.
- Fixed: `unhold` event no longer allows two sessions to be simultaneously Active — other Active sessions are now held automatically, consistent with the behaviour on `newRTCSession`.
- Fixed: `accepted` event now also holds other Active sessions before marking the answered session as Active, closing an edge case where a manual `unhold` between incoming and answering could result in two Active sessions.
- Fixed: race condition in `call()` — `mediaStream` is now stored via `pendingMedia` before `ua.call()` so it is available when `newRTCSession` fires synchronously inside the call; previously audio was set too late and could be missed entirely.
- Fixed: mic track death at or before `confirmed` was not detected for up to 4 s due to the warmup guard — `MicRecoveryManager` now does an immediate `readyState` check and attaches a native `track.ended` listener for zero-latency detection.
- Fixed: `cleanupAllSessions()` cleared the handler map without calling `session.off()` — JsSIP could still fire `ended`/`failed` events on cleaned-up sessions, reaching unmounted React components.
- Fixed: `attachCallStatsLogging` listeners (`confirmed`, `ended`, `failed`) were never removed — cleanup closures are now stored per-session and called from both `cleanupSession` and `cleanupAllSessions`.
- Fixed: a `call()` exception thrown after `newRTCSession` fires synchronously left a phantom `Dialing` session in state — the catch block now finds and removes it.
- Fixed: `hangup()` no longer throws when the JsSIP session is already terminated; the `terminate()` call is now wrapped in try/catch.
- Fixed: attended transfer (`replaces` event) was silently dropped — `e.accept()` is now called automatically in the session handler.
- Fixed: `session.off()` reference mismatch in audio bind retry — anonymous arrow wrappers `() => fn()` produced different references than the registered handlers; extracted to named refs via `audio-bind.retry.ts`.
- Refactor: audio bind retry/exhaustion state machine extracted to `audio-bind.retry.ts`; `session.lifecycle.ts` reduced from ~530 to ~220 lines.
- Refactor: `icecandidate` handler deduplication — `fireReady()` inner function replaces three identical log+flag+call sequences.
- Removed: `tokens.ts` — dead file with no imports.

## 1.0.4

- Added: `useMicDrop` hook — fires when `MicRecoveryManager` detects an audio track or sender drop. Payload: `{ sessionId, trackLive, senderLive }`. When `trackLive=true` the manager self-heals via `replaceAudioTrack`; when `trackLive=false` the application should call `getUserMedia` + `setSessionMedia` + `reinvite`.
- Added: `useSessionIceFailed` hook — fires once per session when `iceConnectionState` reaches `"failed"`. Intended for ICE restart: `reinvite(sessionId, { rtcOfferConstraints: { iceRestart: true } })`. Deduped by flag — emits at most once per session lifetime regardless of how many state-change events the PC fires.
- Added: `MicDropPayload` and `SessionIceFailedPayload` public types.
- Added: `events.onMicDrop` and `events.onSessionIceFailed` on `SipKernel`.
- Fixed: `session.handlers.ts` — all terminal session paths (`ended`, `failed`, `getusermediafailed`, three `peerconnection:*failed`) now share a single `cleanupSession()` helper, eliminating the risk of forgetting to clean up a new resource in a future change.
- Fixed: ICE failed listener is properly removed in every session terminal path and on `peerconnection` re-fire (reinvite), preventing stale DOM event listeners on a dead `RTCPeerConnection`.

## 1.0.3

- Fixed: calling `connect()` during auto-reconnect no longer leaves the old `ReconnectManager` running in the background.
- Fixed: reconnect manager now cancels immediately on WebSocket `connected` event, not only on `registered` — fixes stale reconnect loop when SIP registration is disabled.
- Added: `useCallTimer(sessionId?)` hook — returns elapsed seconds since call was accepted, updates every second.
- Added: `useCallQuality(sessionId?)` hook — polls WebRTC stats every 3 s and returns `CallQuality` (`rtt`, `packetLoss`, `jitter`, `level`).
- Added: `useSipMessages(filter?)` hook — accumulates inbound/outbound SIP MESSAGE events.
- Added: `attendedTransferSession(sessionId, replaceSessionId)` action and kernel command for attended (consultative) transfer via SIP REFER with Replaces.
- Added: `SipStatus.Reconnecting` state — set while exponential-backoff reconnect attempts are in progress.
- Added: `CallStatus.EarlyMedia` state — set when a remote 183 Session Progress with SDP body is received.
- Added: `reconnect` option in `SipConfiguration` (`enabled`, `maxAttempts`, `delayMs`, `backoffMultiplier`) for automatic reconnection with exponential backoff.
- Fixed: audio drop bug (caller could not hear callee) caused by transient ICE states (`disconnected`, `checking`) triggering premature `srcObject` reset in `useSessionMedia` / `CallPlayer`. Now only reacts to final states (`connected`, `completed`, `failed`, `closed`).

## 1.0.2

- Breaking: API surface is now explicitly fixed at package root exports (`src/index.ts`). Internal `core/*` modules are not part of the public contract.
- Breaking: `SipContext` is no longer exported from package root; use `SipProvider` + hooks (`useSipKernel`, etc.).
- Breaking: `createSipKernel()` no longer accepts injected `client`/`eventManager`; kernel composition is internal-only.
- Breaking: video-related API and state were removed (`switchCamera`, `enableVideo`, `disableVideo`, `remoteVideoEnabled`, video track surface).
- Breaking: platform/jssip-lib transitional structure was removed; architecture is consolidated into `core`.
- Added: `docs/MODULES.md` with module-level architecture map and ownership notes.
- Docs: README updated with explicit public API contract and internal boundary.

## 0.8.0

- Breaking: `SipProvider` is now kernel-only and requires `kernel` prop.
- Added `createSipKernel()` and `SipKernel` as the primary composition API.
- Added `useSipKernel()` hook for explicit direct kernel access.
- Hooks migrated internally to kernel interfaces (`store`, `commands`, `events`).
- Added new core module skeleton (`core/contracts`, `core/modules`, `core/kernel`) for modular architecture.
- Restored missing `src/jssip-lib/core/sipErrorHandler.ts` to align source with published typings/build output.

## 0.4.0

- Breaking: public client control methods now require an explicit `sessionId` as the first argument (`answer`, `hangup`, mute/hold toggles, DTMF/transfer helpers).
- Added exports for client-facing types (events, options, RTCSession/UA maps) from the package entrypoint for easier consumption.
- Allow setting media on a session id before the session object is attached to retain pending streams.
- When debug is enabled, expose `window.sipState()` and `window.sipSessions()` helpers for quick inspection (stubbed safely when disabled).

## 0.1.1

- Exported `SipSessionState` from the public entrypoint and aligned demo/imports to the new package name.

## 0.1.0

- Initial public release: React provider/hooks around bundled JsSIP client.
