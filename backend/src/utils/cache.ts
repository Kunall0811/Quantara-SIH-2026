/**
 * Minimal in-memory TTL cache used to protect free-tier API quotas
 * (TomTom especially) from duplicate/repeated requests, per the SIH
 * brief's "request caching, throttling, duplicate request prevention"
 * requirement. Swap for Redis in production if you need a shared cache
 * across multiple backend instances.
 */
interface Entry<T> { value: T; expiresAt: number; }

export class TtlCache<T> {
  private store = new Map<string, Entry<T>>();
  constructor(private ttlMs: number) {}

  get(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (Date.now() > e.expiresAt) { this.store.delete(key); return undefined; }
    return e.value;
  }
  set(key: string, value: T) {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
  async getOrCompute(key: string, compute: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await compute();
    this.set(key, value);
    return value;
  }
  size() { return this.store.size; }
}
