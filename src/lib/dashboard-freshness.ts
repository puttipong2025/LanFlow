import type { DashboardSnapshot } from "@/types/dashboard";

const STATUS_LABELS = {
  dirty: "ข้อมูลรออัปเดต",
  queued: "อยู่ในคิวคำนวณ",
  running: "กำลังคำนวณ",
  failed: "อัปเดตไม่สำเร็จ",
  ready: null,
} as const;

export function dashboardStatusLabel(
  status: DashboardSnapshot["status"],
  isOverdue = false,
) {
  if (status === "ready") return null;
  return isOverdue ? "อัปเดตล่าช้า" : STATUS_LABELS[status];
}

export function dashboardPollInterval(
  data: DashboardSnapshot | undefined,
  requestedVersion: number | null,
  now = Date.now(),
): number | false {
  if (!data) return false;
  if (requestedVersion !== null && data.snapshotVersion < requestedVersion && data.status !== "failed") return 1_000;
  if (data.status === "queued" || data.status === "running") return 5_000;
  // Failure backoff applies even when there is no previous successful summary.
  if (data.status === "failed") {
    const nextCheck = Date.parse(data.nextCheckAt ?? "");
    return Number.isFinite(nextCheck) ? Math.max(5_000, nextCheck - now) : 30_000;
  }
  if (!data.summary || !data.summary.rubberRemaining?.branchReceipts) return 5_000;
  if (data.status === "ready") return false;
  const nextCheck = Date.parse(data.nextCheckAt ?? "");
  return Number.isFinite(nextCheck) ? Math.max(5_000, nextCheck - now) : 5_000;
}
