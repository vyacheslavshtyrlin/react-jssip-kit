export const SipStatus = {
  Disconnected: "disconnected",
  Connecting: "connecting",
  Reconnecting: "reconnecting",
  Connected: "connected",
  Registered: "registered",
  Unregistered: "unregistered",
  RegistrationFailed: "registrationFailed",
} as const;

export type SipStatus = (typeof SipStatus)[keyof typeof SipStatus];

export const CallStatus = {
  Idle: "idle",
  Dialing: "dialing",
  Ringing: "ringing",
  EarlyMedia: "earlyMedia",
  Active: "active",
  Hold: "hold",
} as const;
export type CallStatus = (typeof CallStatus)[keyof typeof CallStatus];

export type CallDirection = "local" | "remote";

export type SipSessionState = {
  id: string;
  status: CallStatus;
  direction: CallDirection | null;
  from: string | null;
  to: string | null;
  muted: boolean;
  acceptedAt: number | null;
  headers: Record<string, string>;
};

export interface SipState {
  sipStatus: SipStatus;
  error: string | null;
  sessions: SipSessionState[];
}

export interface InternalSipState extends SipState {
  sessionsById: Record<string, SipSessionState>;
  sessionIds: string[];
}

export interface StateAdapter {
  getState(): InternalSipState;
  getPublicState(): SipState;
  onChange(fn: (state: InternalSipState) => void): Unsubscribe;
  onPublicChange(fn: (state: SipState) => void): Unsubscribe;
  subscribe(fn: (state: SipState) => void): Unsubscribe;
  subscribeInternal(fn: (state: InternalSipState) => void): Unsubscribe;
  setState(partial: Partial<InternalSipState>): void;
  reset(overrides?: Partial<InternalSipState>): void;
}

export const SipStatusList = Object.values(SipStatus);
export const CallStatusList = Object.values(CallStatus);

export function isSipStatus(v: unknown): v is SipStatus {
  return (
    typeof v === "string" && (SipStatusList as readonly string[]).includes(v)
  );
}
export function isCallStatus(v: unknown): v is CallStatus {
  return (
    typeof v === "string" && (CallStatusList as readonly string[]).includes(v)
  );
}

export type Unsubscribe = () => void;
export type Listener<T> = (value: T) => void;
