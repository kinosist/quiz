export type PinVerdict = 'ok' | 'bad' | 'locked';

/**
 * 暗証番号の総当たりを防ぐ。
 * 一定時間内のまちがいが上限に達すると、その間は正しい番号でも受け付けない。
 */
export class PinGuard {
  private failures: number[] = [];

  constructor(
    private readonly maxFailures = 10,
    private readonly windowMs = 60_000,
  ) {}

  check(candidate: string, pin: string | undefined, now: number): PinVerdict {
    this.failures = this.failures.filter((t) => now - t < this.windowMs);
    if (this.failures.length >= this.maxFailures) return 'locked';
    if (pin && candidate === pin) return 'ok';
    this.failures.push(now);
    return 'bad';
  }
}
