# react-jssip-kit: технический конспект к собеседованию

> Актуально на 6 ноября 2026 года. Основано на `main`, коммит [`d14657e`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/tree/d14657e1dfb56782478689d07342ea0fa062e183), версия пакета `1.2.7`. Это анализ исходников, а не пересказ README.

## Оглавление

1. [Короткий вывод](#1-короткий-вывод)
2. [Рассказы о проекте на 1 и 3 минуты](#2-рассказы-о-проекте)
3. [Архитектура и поток данных](#3-архитектура-и-поток-данных)
4. [JavaScript в проекте](#4-javascript-в-проекте)
5. [React в проекте](#5-react-в-проекте)
6. [TypeScript в проекте](#6-typescript-в-проекте)
7. [SIP, WebRTC и границы ответственности](#7-sip-webrtc-и-границы-ответственности)
8. [Разработка npm-пакета](#8-разработка-npm-пакета)
9. [Вопросы интервьюера](#9-вопросы-интервьюера)
10. [Критический разбор](#10-критический-разбор)
11. [Итоговая шпаргалка](#11-итоговая-шпаргалка)

## 1. Короткий вывод

`react-jssip-kit` — типизированный адаптационный слой между React-приложением и JsSIP. JsSIP решает SIP-сигнализацию и управляет `RTCSession`; браузер реализует WebSocket, доступ к микрофону, `MediaStream` и `RTCPeerConnection`; библиотека связывает эти внешние системы с React через стабильный kernel, внешний store, команды, типизированные события, hooks и небольшой `CallPlayer`.

Главная ценность — приложение не размазывает по компонентам:

- создание и остановку `JsSIP.UA`;
- подписки на UA и RTCSession events;
- проекцию событий в состояние звонков;
- поиск сырой сессии по id;
- cleanup listeners, timers, peer connections и media tracks;
- повторное подключение, ICE recovery и диагностику;
- синхронизацию внешнего store с concurrent React.

Публичный путь использования: `createSipKernel()` → `<SipProvider kernel={kernel}>` → hooks (`useSipSelector`, `useSipActions`, `useSipEvent`, `useSessionMedia`) → UI пользователя. Корневой экспорт определён в [`src/index.ts`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/index.ts).

## 2. Рассказы о проекте

### 2.1 На одну минуту

Я создал `react-jssip-kit`, потому что в React-приложениях работа с JsSIP быстро превращается в повторяющийся инфраструктурный код: нужно держать UA и звонковые сессии вне React, подписываться на десятки событий, отражать их в UI и гарантированно снимать подписки. Библиотека выносит это в переиспользуемый типизированный слой.

Приложение один раз создаёт kernel, передаёт его в `SipProvider`, а компоненты получают состояние и команды через hooks. Например, `useSipSelector` подписывает компонент только на нужный срез состояния, `useSipActions` даёт `call`, `answer`, `hangup`, mute, hold и transfer, а `useSessionMedia` и `CallPlayer` подключают удалённый звук.

Внутри события JsSIP синхронно проходят через обработчики сессии, обновляют внешний store и уведомляют React через `useSyncExternalStore`. Отдельно реализованы cleanup, reconnect, контроль нескольких звонков, ICE recovery и mic recovery. Практический результат — единый контракт для softphone UI и меньше ошибок из-за устаревших closures, дублирующихся listeners и потерянной очистки ресурсов.

### 2.2 На три минуты

Проект появился из повторяющейся задачи: в каждом React softphone приходилось заново соединять императивный JsSIP с декларативным UI. JsSIP создаёт долгоживущий `UA`, выдаёт изменяемые `RTCSession` и синхронно/асинхронно эмитит события. Если работать с ним прямо в компонентах, бизнес-UI начинает знать о `newRTCSession`, `accepted`, `failed`, `peerconnection`, raw media tracks и деталях снятия listeners.

Я вынес общую механику в библиотеку с двумя слоями. Core не зависит от React: `SipClient` координирует UA, session, media, state, reconnect и debug modules. `createSipKernel` служит composition root и даёт стабильные порты: `commands`, `store`, `events`, `media`. React-слой только внедряет kernel через Context и адаптирует внешний store и события в hooks.

Ключевой поток такой: JsSIP эмитит, например, `accepted`; session handler обновляет нормализованное состояние через projector; `SipStateStore` создаёт новый snapshot и синхронно уведомляет подписчиков; `useSyncExternalStore` просит React перечитать snapshot; selector возвращает прежнюю ссылку, если выбранное значение эквивалентно, поэтому несвязанный компонент не ререндерится.

Сложности были на границах жизненного цикла. `newRTCSession` при исходящем звонке может произойти синхронно внутри `ua.call`, поэтому пользовательский `MediaStream` сохраняется как pending до вызова и потребляется при создании session controller. Для событий нужны точные ссылки на handlers, иначе их невозможно снять. Для media важно различать поток приложения и поток, которым библиотека владеет: чужие tracks нельзя безусловно останавливать. Для React callbacks используется ref, чтобы listener оставался стабильным, но видел актуальный handler.

Библиотека не пытается быть UI-kit или SIP-сервером. Она оставляет внешний вид приложению, а протокол — JsSIP и серверу. Результат — пакет с ESM/CJS и `.d.ts`, единым публичным API и переиспользуемой инфраструктурой звонка. При этом я честно отмечаю ограничения: интеграционное покрытие пока небольшое, `SipClient` остаётся крупным orchestrator, а некоторые границы типов JsSIP требуют `any`/casts.

## 3. Архитектура и поток данных

### 3.1 Слои

```text
React UI
  │ state/hooks/actions/events
  ▼
SipProvider ── Context (Dependency Injection)
  │
  ▼
SipKernel (composition root / facade)
  ├── commands ─────► SipClient
  ├── store ◄──────── SipStateStore
  ├── events ◄─────── SipEventManager
  └── media ◄──────── MediaModule
                       │
SipClient               ├── SessionModule / SessionManager
  ├── UaModule ─────────┤   └── WebRTCSessionController
  ├── ReconnectManager  ├── MicRecoveryManager
  └── BrowserUnload     └── debug runtime
           │
           ▼
     JsSIP.UA / RTCSession
           │
           ▼
WebSocket + browser WebRTC APIs
```

Core и React действительно разделены: React импортируется только bindings/components, а lifecycle звонка живёт в `src/core`. Карта модулей документирована в [`docs/MODULES.md`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/docs/MODULES.md).

### 3.2 Composition root и Facade

[`createSipKernel`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/kernel/createSipKernel.ts#L18) создаёт `SipClient`, event manager и media module, затем собирает единый объект. Это composition root: зависимости создаются в одном месте. Это также facade: UI вызывает понятные `commands.call`, `commands.hangup`, `events.onSession`, не зная внутренней цепочки объектов.

Facade не абсолютно закрытый: kernel публично отдаёт `client` и `eventManager`. Это полезный escape hatch, но расширяет поверхность, которую сложнее менять совместимо.

### 3.3 Dependency Injection

DI подтверждается кодом на двух уровнях:

- [`SipProvider`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/provider/index.tsx#L10) получает готовый kernel извне и внедряет его через Context;
- внутренние модули получают зависимости конструкторами/фабриками: store, emitter, manager и callbacks, а не создают их глобально.

Это упрощает замену kernel для аккаунта и модульное тестирование. Kernel нужно создать вне render: иначе новая identity context value пересоздаёт подписки, а старый runtime требуется явно остановить.

### 3.4 Observer

Observer используется реально, а не только терминологически:

- [`JssipEventEmitter`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/modules/event/event-target.emitter.ts#L6) хранит `Set` listeners и возвращает unsubscribe;
- [`SipStateStore`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/modules/state/sip.state.store.ts#L11) уведомляет internal/public subscribers;
- JsSIP сам использует event-emitter модель;
- React подписывается на store через `useSyncExternalStore`.

Копирование bucket через `Array.from` перед обходом защищает текущую рассылку от удаления listener другим listener. Исключение одного обработчика ловится, поэтому оно не прерывает остальных наблюдателей.

### 3.5 Состояние

Публичный snapshot:

```ts
interface SipState {
  sipStatus: SipStatus;
  error: string | null;
  sessions: SipSessionState[];
}
```

Внутреннее состояние добавляет `sessionsById` и `sessionIds`. Такое дублирование даёт O(1) поиск core-операциям и удобный массив UI. [`session.state.projector.ts`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/modules/session/session.state.projector.ts) обязан атомарно поддерживать обе формы.

`setState` сравнивает поля через `Object.is`, создаёт новый internal snapshot и отдельный public snapshot. Public listeners вызываются только при изменении `sipStatus`, `error` или ссылки `sessions`; internal listeners — при любом internal change. Стабильность snapshot критична для `useSyncExternalStore`.

### 3.6 Поток события до React

```text
JsSIP RTCSession emits "accepted"
  → createSessionHandlers.accepted(event)
  → emitter.emit("accepted", event)
  → upsertSessionState(status=active, acceptedAt=Date.now())
  → SipStateStore.setState(new snapshots)
  → store subscribers notified synchronously
  → useSyncExternalStore reads snapshot
  → useSipSelector computes selected slice
  → React schedules/commits affected component render
```

Реализация `accepted`, hold, mute, early media и terminal events находится в [`session.handlers.ts`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/modules/session/session.handlers.ts#L188). Важно: store notification синхронна, но React render не обязан происходить в том же stack frame.

### 3.7 Жизненный цикл соединения и звонка

**Connect:** `commands.connect` → `SipClient.connect` отделяет wrapper config от JsSIP config → валидирует uri/password/sockets → останавливает прежний runtime → ставит `connecting` → создаёт и стартует `JsSIP.UA` → UA events проецируют `connected`/`registered`/ошибку. Код: [`sip.client.ts#L131`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/client/sip.client.ts#L131), [`ua.handlers.ts`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/modules/ua/ua.handlers.ts#L22).

**Outgoing:** media сохраняется до `ua.call`, потому что JsSIP может синхронно эмитить `newRTCSession`; lifecycle создаёт controller, handlers и состояние `dialing`; `progress` с SDP даёт `earlyMedia`; `accepted` — `active`; `confirmed` включает mic monitoring.

**Incoming:** `newRTCSession` с `originator=remote`; при превышении `maxSessionCount` — SIP 486; иначе состояние `ringing`; `answer` передаёт options в RTCSession.

**End:** `ended`/`failed` вызывают idempotent `finishSession`; снимаются timers и ICE listener, session handlers, stats/audio listeners; отключается mic recovery; manager очищает controller; projector удаляет сессию. Общая очистка реализована в [`SessionModule.cleanupAllSessions`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/modules/session/session.module.ts#L212).

## 4. JavaScript в проекте

### 4.1 Call Stack, Event Loop, microtasks и macrotasks

Call stack выполняет синхронную цепочку до возврата. Поэтому комментарий перед `ua.call()` важен: `newRTCSession` способен отработать внутри того же stack, до следующей строки после `ua.call`. Pending media записывается заранее в [`SessionManager.setPendingMedia`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/modules/session/session.manager.ts#L26).

После опустошения stack event loop обрабатывает очереди. Promise reactions/`await` continuations — microtasks; `setTimeout`/`setInterval` и DOM events — tasks (часто говорят macrotasks). Microtasks выполняются перед следующей task.

Примеры:

- `sender.replaceTrack(null).catch(...)` продолжает Promise в microtask;
- reconnect backoff, ICE delays, timer звонка и quality polling используют timers;
- JsSIP/PeerConnection events приходят через внешние event sources;
- `CallPlayer.play()` возвращает Promise, и controller не допускает параллельных попыток.

### 4.2 Promise и async/await

`useCallQuality` делает `await pc.getStats()`. Между `await` состояние мира может измениться, поэтому код хранит `generation`, `disposed` и конкретный `pc`. Результат применяется только если всё ещё относится к текущему connection. Это защита от race: старый `getStats()` не должен перезаписать качество новой сессии.

### 4.3 Замыкания

Замыкания удерживают timers, counters и session id. Это удобно, но может удерживать объекты после unmount, если не вызвать cleanup. В `createSessionHandlers` локальные флаги (`sessionEnded`, `iceRestartAttempts`) принадлежат ровно одной сессии. В React event hooks актуальный callback хранится в ref: подписка зависит от event, а не от identity callback. Это решает stale closure без постоянной переподписки.

### 4.4 `this`, классы и прототипы

Классы `SipClient`, `SessionManager`, `ReconnectManager` — синтаксис над прототипами. Методы вызываются через объект, поэтому `this` указывает на instance. Передача несвязанного метода могла бы потерять `this`; kernel вместо этого создаёт arrow wrappers (`() => client.disconnect()`), лексически захватывающие `client`. Store `subscribe` в kernel также стабилен.

### 4.5 Синхронные и асинхронные события

Собственный emitter вызывает listeners синхронно в `emit`. DOM/transport/WebRTC events планируются браузером. Даже если источник асинхронный, обработчик и последующий `store.setState` внутри одного callback синхронны. Нельзя предполагать, что все JsSIP events обязательно асинхронны: исходящий `newRTCSession` — контрпример.

### 4.6 Race conditions

JavaScript однопоточен для обычного кода, но race остаются как гонки порядка завершения:

- устаревший Promise stats против нового peer connection;
- terminal events `ended` и `failed`, поэтому cleanup idempotent;
- ICE `disconnected` может восстановиться до timeout, поэтому timer отменяется;
- новый session может появиться до React effect, поэтому event manager сначала подписывается на `newRTCSession`, затем attach-ится к уже существующей сессии;
- повторный remote SDP answer может прийти в `stable`; известный дубликат не уничтожает живую сессию.

### 4.7 Память и GC

GC удаляет только недостижимые объекты. Listener в emitter, timer callback, DOM event listener, Context/kernel singleton и `MediaStreamTrack` сохраняют достижимость или внешний ресурс. Поэтому cleanup — не косметика. Библиотека возвращает unsubscribe, хранит точные handler references, чистит timers, снимает PeerConnection/track listeners и при владении потоком вызывает `track.stop()`.

`stop()` важнее ожидания GC: микрофон — внешний ресурс. При этом библиотека останавливает только tracks, которыми считает себя владеющей; consumer-provided media по умолчанию не присваивается библиотеке.

## 5. React в проекте

### 5.1 Context и Provider

Context переносит стабильный kernel по дереву, а не часто меняющееся состояние. Поэтому store updates не меняют `contextValue` и сами по себе не ререндерят всех consumers. [`SipProvider`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/provider/index.tsx) мемоизирует `props.kernel`; реальная стабильность всё равно зависит от родителя.

### 5.2 Custom hooks и внешний store

`useSipState` и selectors используют [`useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore), предназначенный именно для внешних источников. React получает `subscribe` и `getSnapshot`, проверяет snapshot до commit и корректно работает при concurrent rendering.

`useSipSelector` дополнительно кеширует selection. Если `equalityFn(prev, next)` истинен, возвращается прежняя ссылка. Это важно: компоненту со статусом регистрации не нужен ререндер из-за изменения таймера звонка.

### 5.3 useState и useRef

`useState` нужен для данных, которые должны рисоваться: remote stream, peer connection, call quality, messages. `useRef` — для mutable значения без render: актуальный callback, interval id, набор track ids, кеш выбранного значения. Изменение `.current` не инициирует render.

### 5.4 useEffect и cleanup

Effects синхронизируют UI с внешними системами: event subscriptions, intervals, PeerConnection listeners и `<audio>`. Каждый setup возвращает симметричный cleanup. Это соответствует [официальной модели `useEffect`](https://react.dev/reference/react/useEffect).

В Strict Mode development React выполняет дополнительный setup → cleanup → setup. Hooks библиотеки выдерживают это, потому что unsubscribe, `clearInterval` и `removeEventListener` вызываются cleanup-функциями. Сам `connect` в consumer effect тоже должен возвращать `disconnect`; иначе двойной цикл выявит утечку. [Strict Mode](https://react.dev/reference/react/StrictMode) не дублирует effects в production.

### 5.5 useMemo и useCallback

Они не «ускоряют всё». В проекте `useMemo` применяется для стабильного action facade и вычисления выбранного session id. `useCallback` стабилизирует `updateRemoteStream`, поскольку функция входит в effect dependencies. Их польза — identity там, где она участвует в подписках/сравнениях.

### 5.6 Stale closures

Если передать listener, закрывший старый prop/state, он увидит старое значение. `useSipEvent` пишет handler в `handlerRef.current` на каждом render, а зарегистрированный wrapper обращается к ref во время события. Так listener остаётся тем же, но вызывает свежий callback.

### 5.7 Причины ререндеров

Компонент ререндерится при изменении собственного state, parent render, используемого Context value или snapshot внешнего store. `useSipState` получает весь public snapshot и обновится при любом public field. `useSipSelector` с узким scalar selection уменьшает это. Возврат нового массива/объекта из selector без equality function всё равно означает изменение.

### 5.8 Предотвращение утечек

- unsubscribe из event/store observers;
- удаление DOM/PC/track listeners;
- очистка interval/timeout;
- `disposed/generation` перед `setState` после Promise;
- очистка `audio.srcObject`;
- стабильный kernel и явный `disconnect` при logout/unmount.

## 6. TypeScript в проекте

### 6.1 Публичный API

Типы реэкспортируются только из package root. `SipKernel` задаёт порты, command signatures и typed subscriptions. `SipConfiguration` — `Omit<UAConfiguration, "password" | "uri">` плюс wrapper options: reconnect, mic recovery, max sessions и ICE recovery. Это сохраняет совместимость с JsSIP и отделяет обязательные credentials в аргументах `connect`.

### 6.2 Generics и типизация событий

Главный пример — связь имени события и payload:

```ts
type ListenerPayload<L> = L extends (event: infer P) => unknown ? P : never;
type UAEventPayload<K extends UAEventName> = ListenerPayload<UAEventMap[K]>;

onUA<K extends UAEventName>(
  event: K,
  handler: (payload?: UAEventPayload<K>) => void
): () => void;
```

Это conditional type + `infer`: для `"registered"` handler получает payload именно registered-event, а опечатка имени не компилируется. Mapped type строит `JsSIPEventMap`. Реализация: [`src/core/sip/types.ts`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/sip/types.ts#L22).

### 6.3 Utility types, guards и unions

- `Omit` формирует config;
- `Partial<RTCSessionEventMap>` разрешает реализовать нужный набор handlers;
- `Pick<HTMLAudioElement, ...>` сужает test seam playback controller;
- `Parameters<typeof createUAHandlers>[0]` переиспользует тип dependencies;
- `SipStatus` и `CallStatus` построены из `as const` objects;
- `isSipStatus`/`isCallStatus` — runtime type guards.

Полноценная discriminated union мало используется. Ближайшие примеры — `direction: "local" | "remote"`, `source: "failed" | "disconnected"`, quality level. Для сложного event domain можно было бы ввести union `{type, payload}`, но текущий generic event map точнее подходит emitter API.

### 6.4 Type safety и её границы

`strict: true`, declaration build и типы JsSIP дают хорошую consumer safety. Но runtime остаётся динамическим: библиотека проверяет наличие `session`, `peerconnection`, `sendOptions`; в местах неполных JsSIP declarations использует casts/`any`. Это честная anti-corruption boundary, но её надо локализовать и тестировать.

`tsup` генерирует `.d.ts` из root entry. Публичный тип обязан быть достижим из `src/index.ts`; иначе декларация может существовать внутри, но consumer её не импортирует.

## 7. SIP, WebRTC и границы ответственности

### 7.1 Что такое SIP

SIP — протокол сигнализации: идентификация адресов `sip:user@domain`, регистрация, установление/изменение/завершение сессии. Он не является самим аудиопотоком. В браузерной схеме SIP messages идут к серверу по WebSocket/WSS, а media обычно идёт через WebRTC.

### 7.2 Что делает JsSIP

JsSIP реализует SIP user agent в браузере: создаёт `UA`, подключается через `WebSocketInterface`, регистрируется, посылает INVITE/MESSAGE/OPTIONS и создаёт `RTCSession`. Событие [`newRTCSession`](https://jssip.net/documentation/api/ua/) сообщает о входящей или исходящей сессии. RTCSession управляет answer/terminate/mute/hold/DTMF/refer и WebRTC negotiation.

### 7.3 Что делает браузер

Браузер:

- запрашивает разрешение через `navigator.mediaDevices.getUserMedia`;
- возвращает `MediaStream` с `MediaStreamTrack`;
- реализует `RTCPeerConnection`, SDP/ICE, codecs и media transport;
- воспроизводит remote stream через `<audio srcObject>`;
- применяет secure-context/autoplay/privacy policies.

[`getUserMedia`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) показывает permission prompt и может завершиться `NotAllowedError`, `NotFoundError` и другими ошибками. Библиотека не может обойти решение пользователя.

### 7.4 Что делает react-jssip-kit

Библиотека не реализует SIP parser, ICE stack или доступ к устройству. Она:

- конфигурирует и координирует JsSIP;
- отображает UA/session events в React-friendly state;
- предоставляет команды и typed events;
- связывает raw session с session id и media;
- строит remote `MediaStream` из receivers;
- наблюдает качество через `getStats`;
- управляет cleanup/reconnect/опциональным ICE и mic recovery.

### 7.5 Установка звонка

Упрощённо:

```text
Caller UI → call()
  → JsSIP sends SIP INVITE with SDP offer over WSS
  → SIP server routes INVITE
  → Callee gets newRTCSession, answer()
  → SIP 200 OK with SDP answer; caller sends ACK
  → ICE selects candidate pair (STUN/TURN may participate)
  → SRTP audio flows between endpoints or via relay
  → JsSIP events drive UI state
```

SIP server routes signaling; STUN helps discover public mapping; TURN relays media when direct route fails. Для production TURN обычно обязателен. SDP описывает capabilities, ICE candidates — сетевые пути.

### 7.6 MediaStream, mute, hold, transfer

`MediaStream` — контейнер tracks, а не сами bytes-файлы. `mute` в controller отключает local audio track (`enabled=false`) и вызывает JsSIP `session.mute`; `unmute` делает обратное. `hold`/`unhold` — SIP/WebRTC renegotiation с обновлением направления media, не просто громкость UI. Blind transfer вызывает REFER на target; attended transfer передаёт `replaces` с другой RTCSession.

### 7.7 Завершение и ошибки

При hangup JsSIP отправляет соответствующий SIP termination (BYE для установленного dialog, CANCEL/ответ в другой фазе по правилам сессии). Затем `ended`/`failed` запускает cleanup. Transport disconnect и WebRTC media failure — разные вещи: WebSocket может упасть при ещё живом peer connection. Реализация без wrapper reconnect сохраняет call state до terminal session event; с reconnect cleanup выполняется перед перезапуском UA, потому что `UA.stop()` завершает RTCSession.

Ошибки разделены на registration failure, getUserMedia failure, SDP/peerconnection failures, ICE failed и exhausted recovery. UI может подписаться на typed events и показать понятное действие пользователю.

## 8. Разработка npm-пакета

### 8.1 Зачем выделять библиотеку

Выделение оправдано, когда механизм повторяется в нескольких экранах/приложениях, имеет самостоятельный контракт и жизненный цикл и может тестироваться отдельно. Не стоит выделять код только ради «чистой архитектуры»: стоимость — versioning, docs, compatibility и release process.

### 8.2 Публичный API

Root entry — договор. Внутренние пути не поддерживаются. API должен быть небольшим, composable, типизированным и не заставлять consumer знать внутренние классы. Здесь удачный основной путь — kernel/provider/hooks; raw `client` и низкоуровневые factories являются расширением для advanced usage.

### 8.3 peerDependencies

`react`, `react-dom`, `jssip` объявлены peers: приложение должно иметь одну совместимую копию React и контролировать JsSIP version. Одновременно они находятся в devDependencies для локальной сборки/тестов. Bundler помечает их external, поэтому они не попадают в bundle.

### 8.4 ESM, CommonJS, tsup и declarations

[`tsup.config.ts`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/tsup.config.ts) собирает ESM и CJS с target ES2020, sourcemaps, tree shaking и declarations. `package.json` сопоставляет `import` → `dist/index.js`, `require` → `dist/index.cjs`, types → `dist/index.d.ts`.

`sideEffects: true` соответствует root side-effect import debugger, который может добавить browser globals. Цена — bundler не может считать весь package side-effect-free. Более узкий `sideEffects` array либо явный debug entrypoint улучшили бы tree shaking.

### 8.5 Публикация и SemVer

Перед release: tests, lint, build, проверка содержимого `npm pack`, changelog, версия, publish с 2FA/provenance при возможности. SemVer: PATCH — совместимый fix; MINOR — совместимая функция; MAJOR — breaking contract. Изменение имени export, event payload, обязательного prop или поведения cleanup может быть breaking даже без изменения типов.

### 8.6 Проверка версии 1.2.7

На исследованном коммите выполнено:

- `vitest run`: 2 test files, 10 tests passed;
- ESLint: exit 0, 0 errors, 44 `no-explicit-any` warnings;
- tsup: ESM/CJS/DTS success; предупреждение о неиспользуемом type import `EndEvent`;
- remote `main` совпадает с `d14657e`.

Это подтверждает buildability, но не доказывает корректность browser/SIP integration: нужны integration/e2e tests с mock SIP endpoint или test server.

## 9. Вопросы интервьюера

### 1. Какую проблему решает библиотека?

**Технический ответ.** Она является React-oriented facade над императивным JsSIP: централизует UA/session lifecycle, внешний store, типизированные события, media observation и cleanup. UI получает declarative snapshots и commands, не владея raw listeners.

**Просто.** Это переходник: телефонная библиотека говорит событиями, React — состоянием; пакет переводит одно в другое.

**Код:** [`createSipKernel`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/kernel/createSipKernel.ts#L18), [`useSipState`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/hooks/useSipState.ts#L5).

**Уточнят:** почему не один Context state? Он ререндерил бы всех consumers и смешал runtime ownership с UI. Почему не Redux? Внешний специализированный store меньше и не навязывает dependency приложению.

### 2. Почему kernel создаётся вне React render?

**Технический ответ.** Kernel владеет долгоживущими mutable runtime objects. Новая instance на каждом render меняет Context identity, создаёт новые stores/listeners и оставляет старый UA до явного cleanup.

**Просто.** Это телефонный аппарат, а не значение формы; его не надо заново собирать при каждом показе экрана.

**Код:** [`SipProvider`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/provider/index.tsx#L10).

**Уточнят:** когда пересоздавать? При смене изолированного account/runtime, предварительно `disconnect`. Поможет ли `useMemo` в Provider? Только сохраняет входной prop; parent всё равно должен сохранить kernel.

### 3. Как JsSIP event вызывает React render?

**Технический ответ.** Session/UA handler синхронно проектирует event в immutable store snapshot. Store вызывает subscriber; `useSyncExternalStore` перечитывает snapshot; React сравнивает его identity и рендерит подписанные компоненты. Selector может вернуть старую selection reference.

**Просто.** Событие меняет общую «карточку состояния», React получает уведомление и перечитывает её.

**Код:** [`ua.handlers.ts`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/modules/ua/ua.handlers.ts#L22), [`sip.state.store.ts`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/modules/state/sip.state.store.ts#L47), [`useSipSelector.ts`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/hooks/useSipSelector.ts#L11).

**Уточнят:** render синхронный? Notification да, commit контролирует React. Почему snapshot должен кешироваться? Иначе React видит изменение на каждом чтении и может зациклиться.

### 4. Почему `useSyncExternalStore`, а не `useEffect` + `useState`?

**Технический ответ.** `useSyncExternalStore` даёт React согласованный snapshot для concurrent rendering и проверку изменений между render и commit. Effect subscription может пропустить изменение между первоначальным чтением и setup, а также дать tearing.

**Просто.** Это официальный безопасный разъём React для внешнего store.

**Код:** [`useSipState.ts`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/hooks/useSipState.ts), [React docs](https://react.dev/reference/react/useSyncExternalStore).

**Уточнят:** что такое tearing? Части UI в одном commit видят разные версии external state. Что с SSR? Третий аргумент — server snapshot; здесь он равен текущему store, поэтому нельзя делить mutable singleton между SSR requests.

### 5. Как selector уменьшает ререндеры?

**Технический ответ.** Он вычисляет selected value и сравнивает с предыдущим через `equalityFn` (`Object.is` по умолчанию). При равенстве возвращает прежнюю reference, поэтому snapshot hook не сообщает semantic change выбранного среза.

**Просто.** Компонент следит только за нужной лампочкой, а не за всей телефонной станцией.

**Код:** [`useSipSelector.ts#L11`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/hooks/useSipSelector.ts#L11).

**Уточнят:** можно вернуть `{status}`? Да, но нужен shallow equality или memoized object. Цена equality? Она исполняется на каждое store notification.

### 6. Как решена stale closure в event hooks?

**Технический ответ.** Последний handler записывается в ref на каждом render, а effect регистрирует стабильную обёртку, которая читает `handlerRef.current` в момент события. Callback не входит в dependencies и не вызывает лишнюю переподписку.

**Просто.** Подписка остаётся прежней, но внутри всегда набирает самый свежий номер.

**Код:** [`useSipEvent.ts`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/hooks/useSipEvent.ts#L10).

**Уточнят:** почему `hasHandler` в deps? Чтобы подписаться/отписаться при переходе undefined ↔ function. Есть окно до effect? Ref обновляется во время render; committed subscription вызовет последнее committed значение.

### 7. Почему pending media записывается до `ua.call()`?

**Технический ответ.** `ua.call()` может синхронно эмитить `newRTCSession`. Lifecycle и `getOrCreateRtc` выполнятся до возврата из `call`; post-call assignment опоздает. Pending slot устанавливается заранее и одноразово потребляется новой сессией.

**Просто.** Багаж надо положить до отправления поезда, потому что событие отправления приходит внутри вызова.

**Код:** [`sip.client.ts#L283`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/client/sip.client.ts#L283), [`session.manager.ts#L26`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/modules/session/session.manager.ts#L26).

**Уточнят:** если `call` бросит? `finally` очищает pending, а появившаяся dialing phantom session удаляется. Это microtask? Нет, событие может быть в том же call stack.

### 8. Как устроено состояние нескольких сессий?

**Технический ответ.** Internal state нормализован как `sessionsById + sessionIds`, public state содержит ordered array. Projector копирует только изменённую запись/containers и синхронно обновляет обе формы. Active-session fallback выбирает active, затем первую.

**Просто.** Есть быстрый справочник по id и удобный список для экрана.

**Код:** [`state.ts`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/contracts/state.ts#L25), [`session.state.projector.ts`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/modules/session/session.state.projector.ts).

**Уточнят:** компромисс? Дублирование требует единственной точки записи. Почему не Map в public state? Array проще сериализовать и использовать в React.

### 9. Как гарантируется очистка listeners?

**Технический ответ.** Handler objects сохраняются по session id; detach использует те же function references через `off/removeListener`; effects возвращают unsubscribe; terminal cleanup idempotent; общая очистка выполняется до удаления session map.

**Просто.** Чтобы снять обработчик, нужно сохранить тот же «крючок», которым он был повешен.

**Код:** [`session.module.ts#L212`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/modules/session/session.module.ts#L212), [`sip-event-manager.adapter.ts`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/modules/event/sip-event-manager.adapter.ts#L19).

**Уточнят:** зачем detach до clear map? После clear raw session может быть недоступна. Что если listener сам отпишется во время emit? Emitter обходит snapshot `Array.from`.

### 10. Кто владеет MediaStream tracks?

**Технический ответ.** Entry хранит `ownsMediaTracks`. Consumer stream по умолчанию не owned; cleanup отвязывает senders, но останавливает tracks только при ownership. Это предотвращает выключение микрофона, совместно используемого приложением.

**Просто.** Библиотека убирает только тот ресурс, который сама обязалась закрывать.

**Код:** [`session.manager.ts#L10`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/modules/session/session.manager.ts#L10), [`webrtc-session.controller.ts#L25`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/modules/media/webrtc-session.controller.ts#L25).

**Уточнят:** GC остановит микрофон? Полагаться нельзя; `track.stop()` освобождает устройство явно. Что делает `replaceTrack(null)`? Отвязывает outgoing media от sender без обязательного закрытия PC.

### 11. Как получен remote audio?

**Технический ответ.** Media module наблюдает соответствующий `RTCPeerConnection`, собирает receiver tracks в новый `MediaStream`; hook слушает `track` и connection/ICE transitions; `CallPlayer` назначает stream в `audio.srcObject` и best-effort вызывает `play` с throttled retries.

**Просто.** Библиотека собирает входящие аудиодорожки и подключает их к невидимому аудиоплееру.

**Код:** [`media.module.ts#L18`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/modules/media/media.module.ts#L18), [`call-player.tsx`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/components/call-player.tsx#L10).

**Уточнят:** почему play может упасть? Browser autoplay policy. Почему rebuild? Receivers/tracks могут появиться после создания PC.

### 12. Чем SIP отличается от WebRTC?

**Технический ответ.** SIP — signaling/dialog protocol; WebRTC — browser media/data stack с SDP, ICE, DTLS/SRTP и RTP media. В этом проекте JsSIP переносит SIP по WebSocket и управляет WebRTC negotiation через browser APIs.

**Просто.** SIP договаривается о звонке, WebRTC переносит звук.

**Код/документация:** [JsSIP UA](https://jssip.net/documentation/api/ua/), [MDN WebRTC signaling](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Signaling_and_video_calling).

**Уточнят:** где media server? Зависит от инфраструктуры; возможен direct или TURN relay. SIP server передаёт аудио? Не обязательно, он прежде всего маршрутизирует signaling.

### 13. Как работают mute, hold и transfer?

**Технический ответ.** Mute переключает local track и вызывает RTCSession mute/unmute. Hold вызывает session hold/unhold, то есть renegotiation. Blind transfer — REFER target; attended transfer — REFER с `replaces` другой сессии.

**Просто.** Mute выключает свой микрофон, hold меняет режим звонка, transfer просит телефонию перевести собеседника.

**Код:** [`webrtc-session.controller.ts#L70`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/modules/media/webrtc-session.controller.ts#L70).

**Уточнят:** почему состояние меняется по event, а не сразу по click? Реальный успех операции подтверждает JsSIP event. Можно ли DTMF на ringing? Wrapper разрешает только active.

### 14. Как работает reconnect?

**Технический ответ.** Unexpected UA disconnect очищает sessions, переводит status в reconnecting и запускает `ReconnectManager` с exponential backoff. Последние connect args сохранены; успешный `connected/registered` отменяет timer; exhaustion сбрасывает state. Intentional disconnect reconnect не запускает.

**Просто.** После случайного обрыва библиотека повторяет подключение с увеличивающейся паузой, но не мешает явному logout.

**Код:** [`sip.client.ts#L215`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/client/sip.client.ts#L215), [`reconnect.manager.ts`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/modules/runtime/reconnect.manager.ts).

**Уточнят:** почему cleanup sessions? JsSIP `UA.stop()` завершает их; нельзя оставлять stale dialogs. Нужен jitter? В массовой production-системе да, чтобы избежать thundering herd.

### 15. Как обрабатывается ICE failure?

**Технический ответ.** На `peerconnection` ставится `iceconnectionstatechange`. `failed` эмитит diagnostic event и при включённой опции вызывает `session.renegotiate({iceRestart:true})`; `disconnected` получает grace delay. Attempts, retry delay, recovery timeout и exhausted/succeeded events ограничивают state machine.

**Просто.** При пропаже media library даёт сети время восстановиться, затем пытается заново выбрать маршрут.

**Код:** [`session.handlers.ts#L328`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/modules/session/session.handlers.ts#L328).

**Уточнят:** ICE disconnected равен failed? Нет, disconnected может быть временным. Зачем TURN? Без relay часть NAT/firewall combinations не соединится.

### 16. Как обеспечена типизация событий?

**Технический ответ.** `keyof` получает union имён из JsSIP event maps, conditional type с `infer` извлекает argument listener, mapped type связывает имя с payload, generic method сохраняет корреляцию на call site.

**Просто.** TypeScript знает: выбрал событие `failed` — callback получает именно данные ошибки, а не произвольный объект.

**Код:** [`types.ts#L22`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/sip/types.ts#L22).

**Уточнят:** зачем `as never` в adapter? TS не всегда сужает indexed generic union внутри implementation, хотя concrete calls безопасны. Что остаётся runtime? Внешняя библиотека всё равно может прислать неожиданную shape.

### 17. Какие паттерны реально применены?

**Технический ответ.** Facade — kernel/client command surface; Observer — emitter/store/JsSIP subscriptions; Dependency Injection — Provider и constructor/factory deps; Adapter — SipEventManager и React hooks; state projector — преобразование domain events в read model.

**Просто.** Один объект скрывает сложность, подписчики получают события, а зависимости передаются снаружи.

**Код:** [`createSipKernel.ts`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/kernel/createSipKernel.ts), [`event-target.emitter.ts`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/modules/event/event-target.emitter.ts).

**Уточнят:** это Redux? Нет, нет reducer/action log; state меняется через projectors. Это singleton? Factory возвращает independent instances; singleton — выбор приложения.

### 18. Почему React и JsSIP — peer dependencies?

**Технический ответ.** Host выбирает версии, React не дублируется в bundle, а JsSIP external остаётся согласованным с config/types. `tsup` externalizes все три зависимости; devDependencies нужны только разработке пакета.

**Просто.** Пакет использует уже установленные в приложении двигатель React и JsSIP, а не привозит вторую копию.

**Код:** [`package.json`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/package.json), [`tsup.config.ts`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/tsup.config.ts).

**Уточнят:** почему особенно важно для React? Две копии способны нарушить hooks/context identity. Кто устанавливает peer? Consumer/package manager, с предупреждением/автоустановкой в зависимости от npm version.

### 19. Как проект собирается и публикуется?

**Технический ответ.** tsup берёт `src/index.ts`, собирает browser-target ESM/CJS, sourcemaps и `.d.ts`, оставляя peers external. `exports` разрешает только root. `files` ограничивает публикацию dist/docs/license. `publishConfig.access=public` настраивает npm scope behavior.

**Просто.** Один исходник превращается в форматы для современного import, старого require и TypeScript editor hints.

**Код:** [`package.json`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/package.json), [`tsup.config.ts`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/tsup.config.ts).

**Уточнят:** зачем `exports`? Контролирует public entrypoints. Что проверить перед publish? `npm pack --dry-run`, consumer smoke tests ESM/CJS/types.

### 20. Что бы вы улучшили первым?

**Технический ответ.** Сначала browser-level integration tests критических lifecycles и type tests public API; затем разделил бы `SipClient` orchestration, локализовал `any`, сделал debug side effect opt-in и определил политику bounded message history. Это снижает риск без преждевременной смены работающей архитектуры.

**Просто.** Сначала усилил бы страховочную сетку, потом упрощал крупные части.

**Код:** [`sip.client.ts`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/core/client/sip.client.ts), [`useSipMessages.ts`](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/src/hooks/useSipMessages.ts).

**Уточнят:** переписать на Redux? Нет доказанной необходимости. Что тестировать первым? connect/disconnect, incoming/outgoing terminal races, cleanup, Strict Mode, reconnect, media replacement и package consumer imports.

## 10. Критический разбор

### Что сделано удачно

- Core отделён от React; hooks тонкие и понятные.
- `useSyncExternalStore` — корректный современный bridge внешнего mutable runtime.
- Kernel даёт хорошую composition boundary и позволяет несколько независимых instances.
- Типы событий коррелируют event name с payload вместо `string + any`.
- Cleanup спроектирован явно: references, unsubscribe, timers, media ownership.
- Учтена неочевидная синхронность `newRTCSession` внутри `ua.call`.
- State нормализован для core и спроецирован в удобный public shape.
- Реализованы реальные operational concerns: reconnect, call quality, ICE/mic recovery, debug.
- Публичный package entry, peers/external, dual format и declarations настроены последовательно.

### Архитектурные компромиссы

- `SipClient` координирует много подсистем и содержит config parsing, lifecycle и facade methods. Это приемлемый orchestrator, но растёт риск «god object».
- Kernel скрывает сложность, но экспортирует raw `client`/`eventManager`; consumers могут сцепиться с internals.
- Две формы sessions ускоряют чтение, но требуют безошибочного projector.
- Boolean command results просты, но теряют причину отказа. Для диагностики подошёл бы discriminated `Result` без обязательного breaking change — как дополнительный API.
- Автовыбор active/first session удобен, но в multi-call UI неявность может привести к действию над неожиданным звонком. Для критических controls лучше передавать id.

### Подтверждённые ограничения и риски

- Тесты охватывают только 2 файла/10 cases: ICE handler и audio playback. Нет UA/store/hooks/browser/package integration coverage.
- ESLint сообщает 44 `no-explicit-any` warnings. Большая часть находится на динамичной границе JsSIP/debug stats, но объём показывает неполную типовую изоляцию.
- Build выдаёт warning о неиспользуемом `EndEvent` import.
- `useSipMessages` хранит unbounded массив локально в каждом mounted hook, теряет историю при unmount и дублирует хранение между consumers. Это documented helper, не durable message store.
- Debugger импортируется как root side effect, а `sideEffects: true` ухудшает tree shaking и добавляет globals в browser runtime.
- `useSyncExternalStore(..., getState)` используется и как server snapshot. При SSR общий kernel между запросами недопустим; browser APIs всё равно делают пакет client-oriented.
- `CallPlayer` корректно сообщает blocked playback, но приложение обязано дать user gesture/retry UX.
- `getWebRTCCapabilities` проверяет базовые APIs и secure context, но не гарантирует device permission, codecs, SIP server или network reachability.

### Возможные ошибки, за которыми стоит следить

Это не утверждение о воспроизведённых дефектах, а конкретные зоны риска:

- расхождение `sessions`, `sessionsById`, `sessionIds` при обходе projector;
- вызов implicit action без id в multi-call scenario;
- event ordering между JsSIP versions;
- browser differences в RTC stats fields;
- reconnect storm без random jitter;
- регрессия ownership при добавлении внутреннего `getUserMedia`;
- новые JsSIP events без симметричного detach/cleanup.

### Приоритет улучшений

1. Integration harness с fake UA/RTCSession и browser tests hooks/Strict Mode.
2. Public API type tests (`tsd`/consumer fixtures) и ESM/CJS smoke tests.
3. Разделить config/reconnect orchestration из `SipClient`, сохранив facade.
4. Свести casts в несколько адаптеров; заменить stats `any` локальными structural types.
5. Сделать debug entrypoint opt-in и уточнить `sideEffects` metadata.
6. Добавить bounded/configurable message store либо явно оставить hook ephemeral.
7. Добавить structured command failure reasons и reconnect jitter.

Альтернатива архитектуре — хранить состояние в Redux/Zustand или actor/state-machine (XState). Redux полезен, если SIP state должен участвовать в общем app event log/devtools; actor model силён для формальных state transitions и гонок. Текущий custom store меньше по размеру и не навязывает host dependency; менять его без требований не нужно.

## 11. Итоговая шпаргалка

### Зачем

Типизированно связать React UI с долгоживущим событийным JsSIP/WebRTC runtime, централизовав состояние, команды, media и cleanup.

### Архитектура в одной строке

`JsSIP events → handlers → state projector → external store → useSyncExternalStore/selectors → React UI`; команды идут в обратную сторону через `hooks → kernel → SipClient → JsSIP/RTCSession`.

### Главные решения

- stable kernel вне render;
- Provider как DI, а не state container;
- external immutable snapshots;
- selector subscriptions;
- typed generic event maps;
- raw session registry по id;
- explicit media ownership;
- symmetric cleanup и idempotent terminal handling;
- ESM + CJS + declarations, peers external.

### 10 самых вероятных коротких вопросов

1. **Зачем `useSyncExternalStore`?** Для согласованной подписки React на внешний store.
2. **Почему kernel вне render?** Он владеет долгоживущим runtime и должен иметь стабильную identity.
3. **Где Observer?** JsSIP events, собственный emitter и store subscribers.
4. **Где Facade?** `SipKernel.commands/events/media` и `SipClient` скрывают модули.
5. **Где DI?** Готовый kernel передаётся в Provider; модули получают deps.
6. **Почему pending media до call?** `newRTCSession` может быть синхронным.
7. **Как нет stale closure?** Stable listener вызывает последний callback из ref.
8. **SIP против WebRTC?** SIP — signaling, WebRTC — media connectivity/transport.
9. **Зачем peers?** Не бандлить вторую React/JsSIP и оставить version control host-приложению.
10. **Главный недостаток?** Малое integration coverage при сложном lifecycle.

### Источники

- [Исследованный коммит GitHub](https://github.com/vyacheslavshtyrlin/react-jssip-kit/tree/d14657e1dfb56782478689d07342ea0fa062e183)
- [README](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/README.md), [API](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/docs/API.md), [Modules](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/docs/MODULES.md), [JsSIP interop](https://github.com/vyacheslavshtyrlin/react-jssip-kit/blob/d14657e1dfb56782478689d07342ea0fa062e183/react-jssip-kit/docs/JSSIP_INTEROP.md)
- [JsSIP API](https://jssip.net/documentation/api/), [UA](https://jssip.net/documentation/api/ua/), [RTCSession](https://jssip.net/documentation/api/session/)
- [React `useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore), [`useEffect`](https://react.dev/reference/react/useEffect), [`StrictMode`](https://react.dev/reference/react/StrictMode)
- [MDN `getUserMedia`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [WebRTC signaling guide](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Signaling_and_video_calling), [`RTCPeerConnection`](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection)

---

Формулировка для финала рассказа: **«Я не переписывал JsSIP и WebRTC. Я спроектировал устойчивую типизированную границу между их событийным runtime и React: с контролируемым состоянием, понятным API и симметричным жизненным циклом ресурсов».**
