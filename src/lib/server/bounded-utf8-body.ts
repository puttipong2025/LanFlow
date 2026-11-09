import { TextDecoder } from "node:util";

type BoundedUtf8Body =
  | { status: "ok"; text: string }
  | { status: "too_large" }
  | { status: "invalid_utf8" };

export async function readBoundedUtf8Body(request: Request, maxBytes: number): Promise<BoundedUtf8Body> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    return { status: "too_large" };
  }
  if (!request.body) return { status: "ok", text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        void reader.cancel().catch(() => {});
        return { status: "too_large" };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    return { status: "ok", text: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length)) };
  } catch {
    return { status: "invalid_utf8" };
  }
}
