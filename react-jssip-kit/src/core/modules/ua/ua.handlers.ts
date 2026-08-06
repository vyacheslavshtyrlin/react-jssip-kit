import type { UAEventMap } from "../../sip/types";
import { SipStatus } from "../../contracts/state";
import type { StateAdapter } from "../../contracts/state";
import type { JsSIPEventMap } from "../../sip/types";
import type { JssipEventEmitter } from "../event/event-target.emitter";
import type {
  IncomingMessageEvent,
  IncomingOptionsEvent,
  OutgoingMessageEvent,
  OutgoingOptionsEvent,
} from "jssip/lib/UA";

type Deps = {
  emitter: JssipEventEmitter<JsSIPEventMap>;
  state: StateAdapter;
  onNewRTCSession: UAEventMap["newRTCSession"];
  onDisconnected: () => void;
  onConnected: () => void;
};

export function createUAHandlers(deps: Deps): Partial<UAEventMap> {
  const { emitter, state } = deps;

  return {
    connecting: (e) => {
      state.setState({ sipStatus: SipStatus.Connecting });
      emitter.emit("connecting", e);
    },
    connected: (e) => {
      state.setState({ sipStatus: SipStatus.Connected });
      deps.onConnected();
      emitter.emit("connected", e);
    },
    disconnected: (e) => {
      emitter.emit("disconnected", e);
      deps.onDisconnected();
    },
    registered: (e) => {
      state.setState({ sipStatus: SipStatus.Registered, error: null });
      deps.onConnected();
      emitter.emit("registered", e);
    },
    unregistered: (e) => {
      state.setState({ sipStatus: SipStatus.Unregistered });
      emitter.emit("unregistered", e);
    },
    registrationFailed: (e) => {
      state.setState({
        sipStatus: SipStatus.RegistrationFailed,
        error: e?.cause || "registration failed",
      });
      emitter.emit("registrationFailed", e);
    },
    newRTCSession: deps.onNewRTCSession,
    newMessage: (e: IncomingMessageEvent | OutgoingMessageEvent) =>
      emitter.emit("newMessage", e),
    sipEvent: (e: any) => emitter.emit("sipEvent", e),
    newOptions: (e: IncomingOptionsEvent | OutgoingOptionsEvent) =>
      emitter.emit("newOptions", e),
  };
}
