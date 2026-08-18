export function createScopedSingleFlight() {
  const active = new Map<string, Promise<unknown>>();

  return function runSingleFlight<T>(scopeKey: string, run: () => Promise<T>): Promise<T> {
    const existing = active.get(scopeKey) as Promise<T> | undefined;
    if (existing) return existing;

    const promise = run().finally(() => {
      if (active.get(scopeKey) === promise) active.delete(scopeKey);
    });
    active.set(scopeKey, promise);
    return promise;
  };
}
