"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LoaderCircle, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import type { Location } from "@/types";
import type {
  DashboardManagerConfig,
  DashboardMoneyHistoryAction,
  DashboardMoneyHistoryRow,
  DashboardRefreshRequest,
} from "@/types/dashboard";
import { formatCurrency, formatNumber } from "@/lib/format";
import { formatPayrollCurrency } from "@/lib/time-tracking/format";
import {
  useDashboardMoneyHistory,
  useDashboardSnapshot,
} from "@/hooks/useDashboardOverview";
import { assertApiResponse, authFetch } from "@/lib/auth-fetch";
import { isNetworkCancellation } from "@/lib/network-abort";
import { cn } from "@/lib/cn";

const KIND_LABELS: Record<string, string> = {
  income: "รายรับ",
  expense: "รายจ่าย",
  transfer_in: "เงินโอนเข้า",
  transfer_out: "เงินโอนออก",
  rubber_bill: "บิลยาง",
  rubber_export: "ส่งออกยาง",
};

function formatOccurredAt(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function pricePerKg(value: number | null) {
  return value == null ? "—" : `${formatNumber(value)} บาท/กก.`;
}

function TrendMetricCard({
  label,
  value,
  detail,
  formula,
  children,
}: {
  label: string;
  value: string;
  detail: string;
  formula: string;
  children?: ReactNode;
}) {
  const isCompact = children == null;

  return (
    <section
      aria-label={label}
      className={cn(
        "flex min-w-0 flex-col rounded-xl border border-mint/80 bg-white shadow-panel",
        isCompact ? "self-start p-4" : "h-full min-h-64 p-5",
      )}
    >
      <h3 className="text-balance text-sm font-semibold text-ink/60">{label}</h3>
      <p
        className={cn(
          "text-2xl font-bold tabular-nums text-ink",
          isCompact ? "mt-1.5" : "mt-2",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-pretty text-sm text-ink/60">{detail}</p>
      <p
        className={cn(
          "w-fit max-w-full rounded-full bg-mint/45 px-2.5 py-1 text-pretty text-xs text-ink/55",
          isCompact ? "mt-3" : "mt-4",
        )}
      >
        สูตร: {formula}
      </p>
      {children}
    </section>
  );
}

function rowKind(row: DashboardMoneyHistoryRow) {
  return KIND_LABELS[row.kind] ?? (row.direction === "income" ? "รายรับ" : "รายจ่าย");
}

const ACTION_LABELS: Record<Exclude<DashboardMoneyHistoryAction, "all">, string> = {
  create: "เพิ่มใหม่",
  update: "แก้ไข",
  delete: "ลบ",
};

const ACTION_FILTERS: Array<{
  value: DashboardMoneyHistoryAction;
  label: string;
}> = [
  { value: "all", label: "แสดงทั้งหมด" },
  { value: "create", label: "เพิ่มใหม่" },
  { value: "update", label: "แก้ไข" },
  { value: "delete", label: "ลบ" },
];

export function Dashboard({
  selectedLocation,
  online,
  canConfigureDashboard,
  canRequestDashboardRefresh,
}: {
  selectedLocation: Location;
  online: boolean;
  canConfigureDashboard: boolean;
  canRequestDashboardRefresh: boolean;
}) {
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([null]);
  const [historyDate, setHistoryDate] = useState<string | null>(null);
  const [historyAction, setHistoryAction] =
    useState<DashboardMoneyHistoryAction>("all");
  const [managerConfig, setManagerConfig] =
    useState<DashboardManagerConfig | null>(null);
  const [managerBusy, setManagerBusy] = useState<"save" | "refresh" | null>(
    null,
  );
  const [manualRequest, setManualRequest] = useState<{
    locationId: string;
    requestedVersion: number;
    requestedAt: number;
  } | null>(null);
  const [manualLongRunning, setManualLongRunning] = useState(false);
  const [manualRefreshError, setManualRefreshError] = useState<string | null>(
    null,
  );
  const cursor = cursorHistory[cursorHistory.length - 1];
  const requestedVersion =
    manualRequest?.locationId === selectedLocation.id
      ? manualRequest.requestedVersion
      : null;
  const snapshot = useDashboardSnapshot(
    selectedLocation.id,
    online,
    requestedVersion,
  );
  const history = useDashboardMoneyHistory(
    selectedLocation.id,
    online,
    historyDate,
    historyAction,
    cursor,
  );

  useEffect(() => {
    setCursorHistory([null]);
    setHistoryDate(null);
    setHistoryAction("all");
    setManualRequest(null);
    setManualLongRunning(false);
    setManualRefreshError(null);
    setManagerBusy((current) => current === "refresh" ? null : current);
  }, [selectedLocation.id]);

  useEffect(() => {
    if (!online || !canConfigureDashboard) {
      setManagerConfig(null);
      return;
    }
    let active = true;
    const params = new URLSearchParams({ locationId: selectedLocation.id });
    void authFetch(`/api/lanflow/dashboard/config?${params}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        await assertApiResponse(response);
        return response.json() as Promise<DashboardManagerConfig>;
      })
      .then((config) => {
        if (active) setManagerConfig(config);
      })
      .catch(() => {
        if (active) setManagerConfig(null);
      });
    return () => {
      active = false;
    };
  }, [canConfigureDashboard, online, selectedLocation.id]);

  useEffect(() => {
    if (!manualRequest || manualRequest.locationId !== selectedLocation.id) {
      return;
    }
    const waitMs = 120_000 - (Date.now() - manualRequest.requestedAt);
    if (waitMs <= 0) {
      setManualLongRunning(true);
      return;
    }
    const timeout = window.setTimeout(() => setManualLongRunning(true), waitMs);
    return () => window.clearTimeout(timeout);
  }, [manualRequest, selectedLocation.id]);

  useEffect(() => {
    if (
      !manualRequest ||
      manualRequest.locationId !== selectedLocation.id ||
      !snapshot.data
    ) {
      return;
    }
    if (snapshot.data.snapshotVersion >= manualRequest.requestedVersion) {
      toast.success("คำนวณ Dashboard ใหม่สำเร็จแล้ว");
      setManualRequest(null);
      setManualLongRunning(false);
      setManualRefreshError(null);
      setManagerBusy((current) => current === "refresh" ? null : current);
      return;
    }
    if (snapshot.data.status === "failed") {
      toast.error(snapshot.data.lastError || "คำนวณ Dashboard ไม่สำเร็จ");
      setManualRequest(null);
      setManualLongRunning(false);
      setManagerBusy((current) => current === "refresh" ? null : current);
    }
  }, [manualRequest, selectedLocation.id, snapshot.data]);

  async function saveRefreshInterval() {
    if (!managerConfig) return;
    setManagerBusy("save");
    try {
      const params = new URLSearchParams({ locationId: selectedLocation.id });
      const response = await authFetch(
        `/api/lanflow/dashboard/config?${params}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            locationId: selectedLocation.id,
            intervalMinutes: managerConfig.intervalMinutes,
            purchaseAverageMin: managerConfig.thresholds.purchaseAverageMin,
            netCashMin: managerConfig.thresholds.netCashMin,
            stockItems: managerConfig.thresholds.stockItems.map((item) => ({
              productId: item.productId,
              minimumBalance: item.minimumBalance,
            })),
          }),
        },
      );
      await assertApiResponse(response);
      setManagerConfig(await response.json());
      toast.success("บันทึกรอบคำนวณ Dashboard แล้ว");
    } catch (error) {
      if (!isNetworkCancellation(error)) {
        toast.error(
          error instanceof Error ? error.message : "บันทึกรอบคำนวณไม่สำเร็จ",
        );
      }
    } finally {
      setManagerBusy(null);
    }
  }

  async function requestRefresh() {
    setManagerBusy("refresh");
    setManualLongRunning(false);
    setManualRefreshError(null);
    let accepted = false;
    try {
      const response = await authFetch("/api/lanflow/dashboard/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locationId: selectedLocation.id }),
      });
      await assertApiResponse(response);
      const refresh = await response.json() as DashboardRefreshRequest;
      if (
        !Number.isSafeInteger(refresh.requestedVersion) ||
        refresh.requestedVersion < 1
      ) {
        throw new Error("ระบบไม่ได้ส่งรุ่นข้อมูลที่ต้องคำนวณกลับมา");
      }
      accepted = true;
      setManualRequest({
        locationId: selectedLocation.id,
        requestedVersion: refresh.requestedVersion,
        requestedAt: Date.now(),
      });
      await snapshot.refetch();
    } catch (error) {
      if (!isNetworkCancellation(error)) {
        const message =
          error instanceof Error ? error.message : "สั่งคำนวณใหม่ไม่สำเร็จ";
        setManualRefreshError(message);
        toast.error(message);
      }
    } finally {
      if (!accepted) setManagerBusy(null);
    }
  }

  const refreshWorking =
    managerBusy === "refresh" ||
    snapshot.data?.status === "queued" ||
    snapshot.data?.status === "running";
  const dashboardControls =
    (canConfigureDashboard || canRequestDashboardRefresh) && (
    <section className="flex flex-wrap items-end gap-3 rounded-xl border border-mint/80 bg-white p-4 shadow-panel">
      {canConfigureDashboard && managerConfig && (
        <>
          <label className="text-sm font-semibold text-ink">
            รอบคำนวณกลางทั้งระบบ (นาที)
            <input
              type="number"
              min={10}
              max={1440}
              step={1}
              value={managerConfig.intervalMinutes}
              onChange={(event) =>
                setManagerConfig((current) =>
                  current
                    ? {
                        ...current,
                        intervalMinutes: Number(event.target.value),
                      }
                    : current,
                )
              }
              className="focus-ring mt-1 block h-10 w-40 rounded-md border border-black/15 px-3"
            />
          </label>
          <button
            type="button"
            onClick={saveRefreshInterval}
            disabled={managerBusy !== null}
            className="focus-ring flex h-10 items-center gap-2 rounded-lg bg-commit px-3 text-sm font-semibold text-white shadow-sm hover:bg-commit/90 disabled:opacity-50"
          >
            {managerBusy === "save" ? (
              <LoaderCircle className="animate-spin" size={16} />
            ) : (
              <Save size={16} />
            )}
            บันทึกรอบ
          </button>
        </>
      )}
      {canRequestDashboardRefresh && (
        <button
          type="button"
          onClick={requestRefresh}
          disabled={managerBusy !== null || refreshWorking}
          aria-describedby="dashboard-refresh-status"
          className="focus-ring flex h-10 items-center gap-2 rounded-lg bg-settings px-3 text-sm font-semibold text-white shadow-sm hover:bg-settings/90 disabled:opacity-50"
        >
          {refreshWorking ? (
            <LoaderCircle className="animate-spin" size={16} aria-hidden="true" />
          ) : (
            <RefreshCw size={16} aria-hidden="true" />
          )}
          {refreshWorking ? "กำลังคำนวณ…" : "คำนวณสาขานี้ใหม่"}
        </button>
      )}
      <p
        id="dashboard-refresh-status"
        role="status"
        aria-live="polite"
        className={`text-pretty text-xs ${
          manualRefreshError || snapshot.data?.status === "failed"
            ? "font-semibold text-danger"
            : "text-ink/50"
        }`}
      >
        {manualRefreshError
          ? manualRefreshError
          : snapshot.data?.status === "failed"
            ? snapshot.data.lastError || "คำนวณ Dashboard ไม่สำเร็จ"
            : manualLongRunning
          ? "ใช้เวลานานกว่าปกติ ระบบยังคำนวณอยู่"
          : snapshot.data?.status === "queued"
            ? "รอเริ่มคำนวณสาขานี้…"
            : snapshot.data?.status === "running"
              ? "กำลังสร้างผลคำนวณล่าสุดของสาขานี้…"
              : canConfigureDashboard
                ? "รอบกลางต่ำสุด 10 นาที · ปุ่มนี้เริ่มคำนวณสาขาที่เลือกทันที"
                : "Admin คำนวณใหม่ได้เฉพาะสาขาที่ได้รับมอบหมาย"}
      </p>
    </section>
  );

  if (!online) {
    return (
      <section className="rounded-xl border border-amber/30 bg-white p-6 text-center shadow-panel">
        <h2 className="text-lg font-bold text-ink">ภาพรวม · {selectedLocation.name}</h2>
        <p className="mt-2 text-sm font-semibold text-amber">
          ต้องออนไลน์เพื่อดูภาพรวมล่าสุด
        </p>
      </section>
    );
  }

  if (snapshot.isLoading && !snapshot.data) {
    return (
      <section className="rounded-xl border border-mint/80 bg-white p-6 text-center shadow-panel">
        <p className="text-sm font-semibold text-ink/60">กำลังโหลดภาพรวม...</p>
      </section>
    );
  }

  if (snapshot.isError || !snapshot.data) {
    return (
      <section className="rounded-xl border border-danger/20 bg-white p-6 text-center shadow-panel">
        <p className="text-sm font-semibold text-danger">โหลดข้อมูลภาพรวมไม่สำเร็จ</p>
        <button
          type="button"
          onClick={() => snapshot.refetch()}
          className="focus-ring mt-3 rounded-lg bg-actionSecondary px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-actionSecondary/90"
        >
          ลองใหม่
        </button>
      </section>
    );
  }

  const summary = snapshot.data.summary;
  const nextCursor = history.data?.nextCursor ?? null;
  const visibleRows = history.isPlaceholderData ? [] : history.data?.rows ?? [];
  const hasCurrentSummary = Boolean(
    summary?.cashToday
      && summary.rubberRemaining
      && summary.purchaseToday.averagePrice !== undefined,
  );
  if (!summary || !hasCurrentSummary) {
    return (
      <div className="space-y-5">
        <section className="rounded-xl border border-mint/80 bg-white p-6 text-center shadow-panel">
          <LoaderCircle className="mx-auto animate-spin text-leaf" size={22} />
          <h2 className="mt-3 text-lg font-bold text-ink">
            กำลังเตรียม Dashboard · {selectedLocation.name}
          </h2>
          <p className="mt-1 text-sm text-ink/55">
            ระบบจะเก็บผลสำเร็จล่าสุดไว้หนึ่งชุดต่อสาขา · สถานะ{" "}
            {snapshot.data.status}
          </p>
          {snapshot.data.lastError && (
            <p className="mt-2 text-sm font-semibold text-danger">
              {snapshot.data.lastError}
            </p>
          )}
        </section>
        {dashboardControls}
      </div>
    );
  }
  const hasWaterLossData = summary.waterLoss7Days.percent != null;
  const hasWeightGain = hasWaterLossData && summary.waterLoss7Days.weight < 0;
  const waterLossValue = !hasWaterLossData
    ? "—"
    : hasWeightGain
      ? `น้ำหนักเพิ่ม ${formatNumber(Math.abs(summary.waterLoss7Days.weight))} กก.`
      : `${formatNumber(summary.waterLoss7Days.weight)} กก.`;
  const waterLossDetail = !hasWaterLossData
    ? "ไม่มีรายการส่งออก"
    : `${hasWeightGain ? "เพิ่ม " : ""}${formatNumber(
        Math.abs(summary.waterLoss7Days.percent ?? 0),
      )}% · ${summary.waterLoss7Days.exportCount} เที่ยว`;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-balance text-2xl font-bold text-ink">ภาพรวม · {selectedLocation.name}</h1>
        <p className="mt-1 text-sm text-ink/55">
          ผลคำนวณล่าสุด{" "}
          {snapshot.data.calculatedAt
            ? formatOccurredAt(snapshot.data.calculatedAt)
            : "ยังไม่เคยคำนวณ"}
          {snapshot.data.status !== "ready"
            ? ` · สถานะ ${snapshot.data.status}`
            : ""}
        </p>
      </div>

      {dashboardControls}

      <div className="grid gap-3 xl:grid-cols-3">
        <section className="rounded-xl border border-mint/80 bg-white p-5 shadow-panel">
          <h2 className="text-balance text-lg font-bold text-ink">รับ–จ่ายสุทธิสะสม</h2>
          <p className="mt-1 text-pretty text-sm text-ink/55">
            เฉพาะรายการที่มีผลต่อยอดของสาขาจริง
          </p>
          <p
            className={`mt-4 text-3xl font-bold tabular-nums ${
              summary.netCashFlow < 0 ? "text-danger" : "text-leaf"
            }`}
          >
            {formatCurrency(summary.netCashFlow)}
          </p>
          <p className="mt-1 text-pretty text-sm text-ink/60">
            วันนี้ · รับ {formatCurrency(summary.cashToday.income)} · จ่ายจริง {formatCurrency(summary.cashToday.expense)} · สุทธิ {formatCurrency(summary.cashToday.net)}
          </p>
        </section>

        <section className="rounded-xl border border-mint/80 bg-white p-5 shadow-panel xl:col-span-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-balance text-lg font-bold text-ink">ภาพรวมบิลยาง</h2>
              <p className="mt-1 text-pretty text-sm text-ink/55">
                ยอดสะสมไม่รวมบิลรับจากสาขาและบิลที่ส่งออกแล้ว · วันนี้ยังคงนับกิจกรรมรับซื้อจริง
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-full bg-amber/10 px-2.5 py-1 text-amber">
                รอกำหนดราคา {summary.rubberRemaining.unpricedBillCount} บิล
              </span>
              <span className="rounded-full bg-settings/10 px-2.5 py-1 text-settings">
                รออนุมัติ {summary.rubberRemaining.pendingApprovalCount} บิล
              </span>
            </div>
          </div>

          <div className="mt-4 grid overflow-hidden rounded-lg border border-mint/80 bg-mint/80 sm:grid-cols-2 xl:grid-cols-5">
            <div className="bg-white p-3.5">
              <p className="text-sm font-semibold text-ink/60">บิลยางสะสม</p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-ink">
                {formatNumber(summary.rubberRemaining.billCount)} บิล
              </p>
              <p className="mt-1 text-pretty text-sm text-ink/60">
                วันนี้ {formatNumber(summary.purchaseToday.billCount)} บิล
              </p>
            </div>
            <div className="border-t border-mint/80 bg-white p-3.5 sm:border-l sm:border-t-0">
              <p className="text-sm font-semibold text-ink/60">น้ำหนักสุทธิสะสม</p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-ink">
                {formatNumber(summary.rubberRemaining.netWeight)} กก.
              </p>
              <p className="mt-1 text-pretty text-sm text-ink/60">
                วันนี้ {formatNumber(summary.purchaseToday.netWeight)} กก.
              </p>
            </div>
            <div className="border-t border-mint/80 bg-white p-3.5 xl:border-l xl:border-t-0">
              <p className="text-sm font-semibold text-ink/60">ราคาเฉลี่ยสะสม</p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-ink">
                {pricePerKg(summary.rubberRemaining.averagePrice)}
              </p>
              <p className="mt-1 text-pretty text-sm text-ink/60">
                วันนี้ {pricePerKg(summary.purchaseToday.averagePrice)}
              </p>
            </div>
            <div className="border-t border-mint/80 bg-white p-3.5 sm:border-l xl:border-t-0">
              <p className="text-sm font-semibold text-ink/60">มูลค่ายางสะสม</p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-ink">
                {formatCurrency(summary.rubberRemaining.rubberValue)}
              </p>
              <p className="mt-1 text-pretty text-sm text-ink/60">
                วันนี้ {formatCurrency(summary.purchaseToday.rubberValue)}
              </p>
            </div>
            <div className="border-t border-mint/80 bg-white p-3.5 sm:col-span-2 xl:col-span-1 xl:border-l xl:border-t-0">
              <p className="text-sm font-semibold text-ink/60">ยอดหักเงินสะสม</p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-ink">
                {formatCurrency(summary.rubberRemaining.deductionTotal)}
              </p>
              <p className="mt-1 text-pretty text-sm text-ink/60">
                วันนี้ {formatCurrency(summary.purchaseToday.deductionTotal)}
              </p>
            </div>
          </div>
        </section>
      </div>

      <section aria-labelledby="dashboard-trends-heading">
        <div>
          <h2
            id="dashboard-trends-heading"
            className="text-balance text-lg font-bold text-ink"
          >
            แนวโน้มและการดำเนินงาน
          </h2>
          <p className="mt-1 text-pretty text-sm text-ink/55">
            ตัวชี้วัดย้อนหลัง ต้นทุน ภาระดำเนินงาน และสต็อกล่าสุด
          </p>
        </div>

        <div className="mt-3 grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <TrendMetricCard
            label="ยอดซื้อยางเฉลี่ย 7 วัน"
            value={formatCurrency(summary.purchase7Days.dailyAverage)}
            detail={`รวม ${formatCurrency(summary.purchase7Days.paidTotal)}`}
            formula="Σ ยอดซื้อ 7 วัน ÷ 7"
          />
          <TrendMetricCard
            label="ต้นทุนซื้อเฉลี่ย 7 วัน"
            value={pricePerKg(summary.purchase7Days.averageCostPerKg)}
            detail={`${formatNumber(summary.purchase7Days.netWeight)} กก.`}
            formula="Σ ยอดซื้อ 7 วัน ÷ Σ น้ำหนักซื้อ 7 วัน"
          />
          <TrendMetricCard
            label="ภาระดำเนินงานต่อยอดซื้อสะสม"
            value={
              summary.operatingBurdenPercent == null
                ? "—"
                : `${formatNumber(summary.operatingBurdenPercent)}%`
            }
            detail={`${formatCurrency(summary.operatingExpenseAccumulated)} ÷ ${formatCurrency(summary.payablePurchaseAccumulated)} · ยิ่งต่ำยิ่งดี`}
            formula="รายจ่ายดำเนินงานสะสม ÷ ยอดซื้อยางที่ต้องจ่ายสะสม × 100"
          />
          <TrendMetricCard
            label="น้ำหนักสูญเสีย 7 วัน"
            value={waterLossValue}
            detail={waterLossDetail}
            formula="Σ (น้ำหนักต้นทาง − น้ำหนักจริง) 7 วัน"
          />
          <TrendMetricCard
            label="สต็อกสินค้า"
            value={`${summary.stock.inStockCount} ชนิด`}
            detail={`หมด ${summary.stock.outOfStockCount} ชนิด`}
            formula="ยอดคงเหลือ = Σ รับเข้า − Σ จ่ายออก"
          >
            <div
              aria-label="ยอดคงเหลือแยกรายสินค้า"
              className="mt-3 max-h-24 min-h-0 space-y-1 overflow-y-auto border-t border-black/5 pt-2 text-sm"
            >
              {summary.stock.items.length === 0 ? (
                <p className="text-pretty text-ink/50">ยังไม่มีสินค้า</p>
              ) : summary.stock.items.map((item) => (
                <div
                  key={item.productId}
                  className="flex min-w-0 items-center justify-between gap-3"
                >
                  <span className="truncate text-ink/70">{item.name}</span>
                  <span
                    className={cn(
                      "shrink-0 font-semibold tabular-nums",
                      item.balance <= 0 ? "text-clay" : "text-ink",
                    )}
                  >
                    {formatNumber(item.balance)} {item.unit}
                  </span>
                </div>
              ))}
            </div>
          </TrendMetricCard>
        </div>
      </section>

      <section className="rounded-xl border border-mint/80 bg-white p-4 shadow-panel">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink">ประวัติรายการเงินล่าสุด</h2>
            <p className="text-sm text-ink/50">
              หน้า {cursorHistory.length} · 10 เหตุการณ์ต่อหน้า · เก็บย้อนหลัง {history.data?.retentionDays ?? 15} วัน
            </p>
          </div>
          <label className="text-sm font-semibold text-ink/70">
            วันที่เกิดเหตุการณ์
            <input
              type="date"
              value={historyDate ?? history.data?.selectedDate ?? ""}
              min={history.data?.availableFrom}
              max={history.data?.availableTo}
              onChange={(event) => {
                setHistoryDate(event.target.value || null);
                setCursorHistory([null]);
              }}
              className="focus-ring ml-2 h-9 rounded-md border border-black/15 bg-white px-2 text-sm text-ink"
            />
          </label>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2" aria-label="กรอง action รายการเงิน">
          {ACTION_FILTERS.map((filter) => {
            const active = historyAction === filter.value;
            return (
              <button
                key={filter.value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setHistoryAction(filter.value);
                  setCursorHistory([null]);
                }}
                className={`focus-ring inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                  active
                    ? "bg-actionSecondary text-white hover:bg-actionSecondary/90"
                    : "border border-actionSecondary/20 bg-white text-actionSecondary hover:bg-field"
                }`}
              >
                {filter.label}
                <span
                  className={`min-w-6 rounded-full px-1.5 py-0.5 text-center text-xs ${
                    active ? "bg-white/20 text-white" : "bg-field text-ink/70"
                  }`}
                >
                  {history.data?.counts[filter.value] ?? 0}
                </span>
              </button>
            );
          })}
          {history.isFetching && (
            <span role="status" className="text-xs font-semibold text-ink/50">
              กำลังโหลด...
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-ink/60">
                <th className="py-2 pr-3">วันเวลา</th>
                <th className="pr-3">Action</th>
                <th className="pr-3">ประเภท</th>
                <th className="pr-3">เลขรายการ</th>
                <th className="pr-3">รายละเอียด</th>
                <th className="pr-3 text-right">จำนวนเงิน</th>
                <th>ผู้ดำเนินการ</th>
              </tr>
            </thead>
            <tbody>
              {history.isLoading || history.isPlaceholderData ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-ink/50">กำลังโหลดรายการ...</td>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-ink/50">
                    ยังไม่มีเหตุการณ์เงินในวันที่เลือก
                  </td>
                </tr>
              ) : visibleRows.map((row) => (
                <tr key={row.id} className="border-b border-black/5">
                  <td className="whitespace-nowrap py-3 pr-3">{formatOccurredAt(row.occurredAt)}</td>
                  <td className="pr-3">
                    <span className="rounded-full bg-actionSecondary/10 px-2 py-1 text-xs font-semibold text-actionSecondary">
                      {ACTION_LABELS[row.action]}
                    </span>
                  </td>
                  <td className="pr-3">
                    <span className="rounded-full bg-field px-2 py-1 text-xs font-semibold">
                      {rowKind(row)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap pr-3 font-semibold">{row.number}</td>
                  <td className="max-w-[360px] pr-3">{row.title}</td>
                  <td className={`whitespace-nowrap pr-3 text-right font-semibold ${row.direction === "income" ? "text-leaf" : "text-clay"}`}>
                    {row.direction === "income" ? "+" : "-"}{row.sourceType === "payroll_slip"
                      ? formatPayrollCurrency(row.amount)
                      : formatCurrency(row.amount)}
                  </td>
                  <td className="whitespace-nowrap">{row.actorName || "ระบบ"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={cursorHistory.length === 1 || history.isFetching}
            onClick={() => setCursorHistory([null])}
            className="focus-ring rounded-lg border border-actionSecondary/25 bg-white px-3 py-2 text-sm font-semibold text-actionSecondary hover:bg-field disabled:cursor-not-allowed disabled:opacity-40"
          >
            วันที่ล่าสุด · {history.data?.latestAt ? formatOccurredAt(history.data.latestAt) : "—"}
          </button>
          <button
            type="button"
            disabled={!nextCursor || history.isFetching}
            onClick={() => nextCursor && setCursorHistory((history) => [...history, nextCursor])}
            className="focus-ring rounded-lg bg-actionSecondary px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-actionSecondary/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            วันที่ย้อนหลัง · ก่อน {visibleRows.length > 0
              ? formatOccurredAt(visibleRows[visibleRows.length - 1].occurredAt)
              : "—"}
          </button>
        </div>
      </section>
    </div>
  );
}
