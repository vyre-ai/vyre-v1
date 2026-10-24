// A sliding-window limiter by key: at most `limit` hits in the last `windowMs`. The clock is injected so tests do not wait.

export interface Limited { ok: boolean; retryAfterSec: number; remaining: number }

export class RateLimit {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  /** Count one hit for the key if there is room. */
  take(key: string): Limited {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (recent.length >= this.limit) {
      const oldest = recent[0] ?? t;
      this.hits.set(key, recent);
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + this.windowMs - t) / 1000)), remaining: 0 };
    }
    recent.push(t);
    this.hits.set(key, recent);
    return { ok: true, retryAfterSec: 0, remaining: this.limit - recent.length };
  }

  /** Forget keys with no hit in the window, so the map does not grow without end. */
  sweep(): number {
    const t = this.now();
    let dropped = 0;
    for (const [k, v] of this.hits) {
      if (!v.some((x) => t - x < this.windowMs)) { this.hits.delete(k); dropped += 1; }
    }
    return dropped;
  }

  get size(): number { return this.hits.size; }
}
