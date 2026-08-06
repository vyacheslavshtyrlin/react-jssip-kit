import type {
  InternalSipState,
  SipState,
  StateAdapter,
} from "../../contracts/state";
import { getInitialSipState } from "./sip.state";

export type SipStateListener = (state: InternalSipState) => void;
export type PublicSipStateListener = (state: SipState) => void;

export class SipStateStore implements StateAdapter {
  private state: InternalSipState = getInitialSipState();
  private publicState: SipState = {
    sipStatus: this.state.sipStatus,
    error: this.state.error,
    sessions: this.state.sessions,
  };
  private listeners = new Set<SipStateListener>();
  private publicListeners = new Set<PublicSipStateListener>();

  getState(): InternalSipState {
    return this.state;
  }

  getPublicState(): SipState {
    return this.publicState;
  }

  onChange(fn: SipStateListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onPublicChange(fn: PublicSipStateListener): () => void {
    this.publicListeners.add(fn);
    return () => this.publicListeners.delete(fn);
  }

  subscribe(fn: PublicSipStateListener): () => void {
    return this.onPublicChange(fn);
  }

  subscribeInternal(fn: SipStateListener): () => void {
    return this.onChange(fn);
  }

  setState(partial: Partial<InternalSipState>) {
    if (!partial || Object.keys(partial).length === 0) return;
    const changed: Partial<InternalSipState> = {};
    let hasChanges = false;

    (Object.keys(partial) as (keyof InternalSipState)[]).forEach((key) => {
      const nextValue = partial[key];
      if (Object.is(this.state[key], nextValue)) return;
      changed[key] = nextValue as never;
      hasChanges = true;
    });

    if (!hasChanges) return;

    const next = { ...this.state, ...changed };
    const nextPublicState: SipState = {
      sipStatus: next.sipStatus,
      error: next.error,
      sessions: next.sessions,
    };
    const publicChanged =
      this.publicState.sipStatus !== nextPublicState.sipStatus ||
      this.publicState.error !== nextPublicState.error ||
      this.publicState.sessions !== nextPublicState.sessions;

    this.state = next;
    this.publicState = nextPublicState;
    this.emit(publicChanged);
  }

  reset(overrides: Partial<InternalSipState> = {}) {
    this.setState({ ...getInitialSipState(), ...overrides });
  }

  private emit(emitPublic: boolean) {
    for (const fn of Array.from(this.listeners)) {
      try {
        fn(this.state);
      } catch (error) {
        console.error("[react-jssip-kit] state listener failed", error);
      }
    }
    if (emitPublic) {
      for (const fn of Array.from(this.publicListeners)) {
        try {
          fn(this.publicState);
        } catch (error) {
          console.error(
            "[react-jssip-kit] public state listener failed",
            error
          );
        }
      }
    }
  }
}
