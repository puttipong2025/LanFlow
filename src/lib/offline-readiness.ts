import { readBootstrapCache } from "@/lib/lanflow/bootstrap-cache";
import { getSyncDb, SYNC_QUEUE_STORE } from "@/lib/idb-core";
import { OFFLINE_AUTH_MAX_AGE_MS } from "@/lib/offline-auth-policy";
import { rubberNumberingReady } from "@/lib/rubber-bills/numbering-idb";

type OfflineAsset = { url: string; revision: string };
type OfflineManifest = { buildId: string; assets: OfflineAsset[] };
export type OfflineReadiness = { percent: number; ready: boolean; detail: string };
const MANIFEST_PATH = "/offline-assets.json";

export function readinessPercent(completed: number, total: number, prerequisites: boolean) {
  if (!total) return 0;
  const percent = Math.floor((Math.max(0, completed) / total) * 100);
  return Math.min(prerequisites ? 100 : 99, percent);
}

function isManifest(value: unknown): value is OfflineManifest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OfflineManifest>;
  return typeof candidate.buildId === "string" && Boolean(candidate.buildId)
    && Array.isArray(candidate.assets) && candidate.assets.length > 0
    && candidate.assets.every((asset) => typeof asset?.url === "string"
      && asset.url.startsWith("/") && !asset.url.startsWith("//")
      && typeof asset.revision === "string");
}

export async function readOfflineManifest(online: boolean, signal?: AbortSignal) {
  const metadata = await caches.open("lanflow-offline-manifest");
  if (online) {
    const response = await fetch(MANIFEST_PATH, { cache: "no-store", signal });
    if (!response.ok || response.redirected) throw new Error("ยังโหลดรายการไฟล์แอปไม่สำเร็จ");
    const manifest: unknown = await response.clone().json();
    if (!isManifest(manifest)) throw new Error("ยังไม่มีรายการไฟล์ออฟไลน์ที่ใช้ตรวจสอบได้");
    await metadata.put(MANIFEST_PATH, response);
    return manifest;
  }
  const cached = await metadata.match(MANIFEST_PATH);
  const manifest: unknown = cached ? await cached.json() : null;
  if (!isManifest(manifest)) throw new Error("เชื่อมต่ออินเทอร์เน็ตเพื่อเตรียมใช้งานครั้งแรก");
  return manifest;
}

export async function inspectOfflineReadiness(manifest: OfflineManifest, userId: string, locationId: string): Promise<OfflineReadiness> {
  const keys = await caches.keys();
  const precaches = await Promise.all(keys.filter((key) => key.startsWith("workbox-precache-")).map((key) => caches.open(key)));
  const assets = await Promise.all(manifest.assets.map(async (asset) => {
    const url = new URL(asset.url, location.origin);
    url.searchParams.set("__WB_REVISION__", asset.revision);
    return (await Promise.all(precaches.map((cache) => cache.match(url.href)))).some((response) => response?.ok);
  }));
  const shell = await caches.open("lanflow-start-url").then((cache) => cache.match("/"));
  // Inspect cached HTML too: an old shell must not pass against a new worker's assets.
  const shellHtml = shell?.ok && shell.headers.get("content-type")?.includes("text/html") ? await shell.text() : "";
  const shellAssets = [...shellHtml.matchAll(/(?:src|href)=["'](\/_next\/static\/[^"']+)["']/g)].map((match) => match[1]);
  const shellFilesReady = shellAssets.some((url) => /^\/_next\/static\/chunks\/app\/page-[^/]+\.js$/.test(new URL(url, location.origin).pathname)) && (await Promise.all(shellAssets.map(async (url) =>
    (await Promise.all(precaches.map((cache) => cache.match(url, { ignoreSearch: true })))).some((response) => response?.ok)
  ))).every(Boolean);
  let authReady = false;
  try {
    const auth = JSON.parse(localStorage.getItem(`lanflow:auth-profile:${userId}`) ?? "null");
    const age = Date.now() - new Date(auth?.validatedAt).getTime();
    authReady = localStorage.getItem("lanflow:last-auth-user") === userId
      && auth?.profile?.id === userId && Number.isFinite(age) && age >= 0 && age <= OFFLINE_AUTH_MAX_AGE_MS;
  } catch { /* Invalid or unavailable local storage is not ready. */ }
  const bootstrap = readBootstrapCache(userId);
  const branchReady = Boolean(bootstrap?.locations.some((branch) => branch.id === locationId)
    && bootstrap.profile.locationIds.includes(locationId));
  let queueReady = false;
  try {
    const db = await getSyncDb();
    try {
      await new Promise<void>((resolve, reject) => {
        // A writable transaction verifies queue access without changing any pending record.
        const tx = db.transaction(SYNC_QUEUE_STORE, "readwrite");
        tx.objectStore(SYNC_QUEUE_STORE).count();
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(new Error("พื้นที่เก็บรายการออฟไลน์ยังไม่พร้อม"));
      });
      queueReady = true;
    } finally { db.close(); }
  } catch { /* Storage denial must keep readiness below 100%. */ }
  const workerReady = Boolean(navigator.serviceWorker.controller);
  const needsNumbering = bootstrap?.profile.role === "admin" || bootstrap?.profile.role === "super_admin";
  const numberingReady = !needsNumbering || await rubberNumberingReady(locationId).catch(() => false);
  const checks = [Boolean(shellHtml) && shellFilesReady, authReady, branchReady, workerReady, queueReady, numberingReady];
  const completed = assets.filter(Boolean).length + checks.filter(Boolean).length;
  const total = assets.length + checks.length;
  const percent = readinessPercent(completed, total, checks.every(Boolean));
  return {
    percent, ready: percent === 100,
    detail: !numberingReady ? "เชื่อมต่ออินเทอร์เน็ตเพื่อเตรียมรหัสเครื่องออกบิล"
      : !queueReady ? "พื้นที่เก็บรายการออฟไลน์ยังไม่พร้อม"
      : !authReady ? "เชื่อมต่ออินเทอร์เน็ตเพื่อยืนยันบัญชีอีกครั้ง"
        : !branchReady ? "กำลังเตรียมข้อมูลสาขาปัจจุบัน"
        : !shellFilesReady ? "กำลังเตรียมไฟล์สำหรับเปิดแอปใหม่"
          : assets.some((ready) => !ready) || !workerReady ? "ไฟล์แอปยังไม่ครบ กรุณาเชื่อมต่ออินเทอร์เน็ตและเปิดแอปไว้เพื่อเตรียมข้อมูล"
            : "ไฟล์แอป บัญชี สาขา และพื้นที่เก็บรายการพร้อม · ประวัติแสดงเฉพาะข้อมูลที่มีในเครื่อง",
  };
}
