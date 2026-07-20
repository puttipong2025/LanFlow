export async function printReceiptHtml(html: string) {
  if (typeof document === "undefined" || typeof window === "undefined") {
    throw new Error("เปิดหน้าต่างพิมพ์ได้เฉพาะใน browser");
  }

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  document.body.appendChild(iframe);

  try {
    const frameWindow = iframe.contentWindow;
    const frameDocument = iframe.contentDocument;
    if (!frameWindow || !frameDocument) throw new Error("ไม่สามารถสร้างเอกสารสำหรับพิมพ์ได้");

    frameDocument.open();
    frameDocument.write(html);
    frameDocument.close();
    await new Promise<void>((resolve) => {
      if (frameDocument.readyState === "complete") resolve();
      else iframe.addEventListener("load", () => resolve(), { once: true });
    });

    await new Promise<void>((resolve, reject) => {
      let printStarted = false;
      let settled = false;
      const finish = () => {
        if (!printStarted || settled) return;
        settled = true;
        window.removeEventListener("focus", finish);
        frameWindow.removeEventListener("afterprint", finish);
        resolve();
      };
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        window.removeEventListener("focus", finish);
        frameWindow.removeEventListener("afterprint", finish);
        reject(new Error("หมดเวลารอหน้าต่างพิมพ์ กรุณาลองใหม่"));
      }, 120_000);
      frameWindow.addEventListener("afterprint", () => {
        window.clearTimeout(timeout);
        finish();
      }, { once: true });
      window.addEventListener("focus", () => {
        window.setTimeout(() => {
          window.clearTimeout(timeout);
          finish();
        }, 200);
      }, { once: true });
      frameWindow.focus();
      printStarted = true;
      frameWindow.print();
    });
  } finally {
    iframe.remove();
  }
}
