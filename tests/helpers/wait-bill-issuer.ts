import { expect, type Page } from "@playwright/test";

/** New browsers must finish their online registration before an offline create. */
export async function waitForBillIssuer(page: Page, locationId?: string) {
  await expect.poll(() => page.evaluate((branch) => new Promise<boolean>(resolve => {
    const request = indexedDB.open("lanflow_sync_db");
    request.onerror = () => resolve(false);
    request.onupgradeneeded = () => { request.transaction?.abort(); resolve(false); };
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("rubber_bill_numbers")) { db.close(); resolve(false); return; }
      const tx = db.transaction("rubber_bill_numbers"), read = tx.objectStore("rubber_bill_numbers").getAll();
      tx.oncomplete = () => { db.close(); resolve(read.result.some(row => (!branch || row.key === branch)
        && row.issuer && row.incomeExpense && row.incomeExpenseStarted === true)); };
      tx.onabort = tx.onerror = () => { db.close(); resolve(false); };
    };
  }), locationId), { timeout: 30000, message: "online bill issuer registration" }).toBe(true);
}
