// Observe existing accessible modal primitives; no new keyboard/focus implementation.
export function hasOpenBusinessForm() {
  return Boolean(document.querySelector('[role="dialog"] form, dialog[open] form'));
}

export function waitForBusinessForms(signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new Error("การอัปเดตถูกยกเลิก"));
  if (!hasOpenBusinessForm()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      if (!signal.aborted && hasOpenBusinessForm()) return;
      observer.disconnect(); signal.removeEventListener("abort", finish);
      if (signal.aborted) reject(new Error("การอัปเดตถูกยกเลิก")); else resolve();
    };
    const observer = new MutationObserver(finish);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "role"] });
    signal.addEventListener("abort", finish, { once: true });
    finish();
  });
}
