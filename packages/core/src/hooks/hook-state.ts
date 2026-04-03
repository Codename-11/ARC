/**
 * Session-scoped state store for hooks.
 *
 * Each hook gets an isolated namespace keyed by `${sessionId}:${hookName}`.
 * State is in-memory only — intentionally ephemeral across process restarts.
 */
export class HookStateStore {
  /** Outer key: `${sessionId}:${hookName}`, inner key: arbitrary string. */
  private store = new Map<string, Map<string, unknown>>();

  private scopeKey(sessionId: string, hookName: string): string {
    return `${sessionId}:${hookName}`;
  }

  /** Retrieve a value. Returns `undefined` if the key or scope doesn't exist. */
  get<T>(sessionId: string, hookName: string, key: string): T | undefined {
    const scope = this.store.get(this.scopeKey(sessionId, hookName));
    return scope?.get(key) as T | undefined;
  }

  /** Set a value within a session+hook scope. Creates the scope if needed. */
  set(sessionId: string, hookName: string, key: string, value: unknown): void {
    const sk = this.scopeKey(sessionId, hookName);
    let scope = this.store.get(sk);
    if (!scope) {
      scope = new Map<string, unknown>();
      this.store.set(sk, scope);
    }
    scope.set(key, value);
  }

  /** Clear all state for a session (across all hooks). Does not affect other sessions. */
  clear(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }
}
