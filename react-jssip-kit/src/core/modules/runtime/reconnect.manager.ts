export type ReconnectConfig = {
  enabled: boolean;
  maxAttempts?: number;
  delayMs?: number;
  backoffMultiplier?: number;
};

export class ReconnectManager {
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private _active = false;

  private readonly maxAttempts: number;
  private readonly delayMs: number;
  private readonly backoffMultiplier: number;

  constructor(
    config: ReconnectConfig,
    private readonly onAttempt: () => void,
    private readonly onExhausted: () => void
  ) {
    this.maxAttempts = config.maxAttempts ?? 5;
    this.delayMs = config.delayMs ?? 2000;
    this.backoffMultiplier = config.backoffMultiplier ?? 1.5;
  }

  start(): void {
    if (this._active) return;
    this._active = true;
    this.scheduleNext();
  }

  scheduleNext(): void {
    if (!this._active) return;
    this.attempt += 1;

    if (this.attempt > this.maxAttempts) {
      this._active = false;
      this.onExhausted();
      return;
    }

    const delay =
      this.delayMs * Math.pow(this.backoffMultiplier, this.attempt - 1);

    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this._active) return;
      try {
        this.onAttempt();
      } catch (error) {
        console.error("[react-jssip-kit] reconnect attempt failed", error);
        if (this._active) this.scheduleNext();
      }
    }, delay);
  }

  cancel(): void {
    this._active = false;
    this.attempt = 0;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  isActive(): boolean {
    return this._active;
  }
}
