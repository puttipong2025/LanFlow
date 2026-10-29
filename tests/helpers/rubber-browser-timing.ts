import type { Page } from '@playwright/test';

export type BrowserTimingEvent = { kind: string; atMs: number; commandId?: string; durationMs?: number };
declare global { interface Window { rubberTimingEvents: BrowserTimingEvent[] } }

// Test-page probes only. Never retain payloads, names, credentials or PDF bytes.
export async function installRubberBrowserTiming(page: Page, marker: string) {
  await page.addInitScript(marker => {
    const events = window.rubberTimingEvents = [] as BrowserTimingEvent[];
    const now = () => performance.timeOrigin + performance.now();
    const commandKeys = new Map<IDBValidKey, string>();
    const transactionCommands = new WeakMap<IDBTransaction, Set<string>>();
    const visibility = new MutationObserver(() => {
      if (!events.some(event => event.kind === 'click')) return;
      const row = [...document.querySelectorAll('tr')].find(row => row.textContent?.includes(marker)
        && [...row.querySelectorAll('span')].some(span => span.textContent === 'ซิงก์แล้ว'));
      if (!row) return;
      events.push({ kind: 'confirmed-ui-dom', atMs: now() });
      requestAnimationFrame(() => events.push({ kind: 'confirmed-ui-frame', atMs: now() }));
      visibility.disconnect();
    });
    visibility.observe(document, { subtree: true, childList: true, characterData: true });
    document.addEventListener('click', event => {
      const button = (event.target as Element)?.closest('button');
      if (button?.textContent?.trim() !== 'บันทึกบิล') return;
      events.push({ kind: 'click', atMs: now() });
    }, true);
    const disabled = Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, 'disabled')!;
    Object.defineProperty(HTMLButtonElement.prototype, 'disabled', {
      ...disabled, set(this: HTMLButtonElement, value: boolean) {
        disabled.set!.call(this, value);
        if (value && this.textContent?.trim() === 'บันทึกบิล') events.push({ kind: 'button-disabled', atMs: now() });
      },
    });
    for (const method of ['add', 'put'] as const) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function(value: unknown, key?: IDBValidKey) {
        const request = key === undefined ? original.call(this, value) : original.call(this, value, key);
        const event = value as { entity?: string; payload?: { commandId?: string }; queueId?: IDBValidKey };
        if (this.name === 'sync_queue' && event?.entity === 'rubber_bills' && event.payload?.commandId) {
          const commandId = event.payload.commandId;
          const commands = transactionCommands.get(this.transaction) ?? new Set<string>();
          if (!commands.has(commandId)) {
            commands.add(commandId); transactionCommands.set(this.transaction, commands);
            this.transaction.addEventListener('complete', () => events.push({ kind: 'outbox-commit', commandId, atMs: now() }));
          }
          request.addEventListener('success', () => commandKeys.set(event.queueId ?? request.result, commandId));
        }
        return request;
      };
    }
    const originalDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function(key: IDBValidKey | IDBKeyRange) {
      const request = originalDelete.call(this, key);
      const commandId = key instanceof IDBKeyRange ? undefined : commandKeys.get(key);
      if (this.name === 'sync_queue' && commandId) this.transaction.addEventListener('complete',
        () => events.push({ kind: 'acknowledgement-commit', commandId, atMs: now() }));
      return request;
    };
    const originalFetch = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const url = new URL(typeof args[0] === 'string' || args[0] instanceof URL ? args[0] : args[0].url, location.href);
      const started = now();
      const response = await originalFetch(...args);
      if (['/api/auth/me', '/api/lanflow/rubber-bills/command-context', '/api/lanflow/rubber-bills/queue'].includes(url.pathname)) {
        const kind = url.pathname.endsWith('command-context') ? 'context-http' : url.pathname.endsWith('/me') ? 'auth-http' : 'queue-http';
        events.push({ kind, atMs: started, durationMs: now() - started });
      }
      return response;
    };
  }, marker);
}
