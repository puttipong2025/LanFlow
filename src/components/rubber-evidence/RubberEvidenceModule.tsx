"use client";

import {
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ImageOff,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AlertDialog } from "@/components/shared/AlertDialog";
import { OperationWaitingDialog } from "@/components/shared/OperationWaitingDialog";
import { useRubberBillEvidenceReview, type EvidenceReviewState } from "@/hooks/useRubberBillEvidenceReview";
import { useRubberEvidenceFeed, type RubberEvidenceView } from "@/hooks/useRubberEvidenceFeed";
import { useRubberEvidencePage } from "@/hooks/useRubberEvidencePage";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { canManageSystemFeatures } from "@/lib/permissions";
import {
  buildEvidenceSlides,
  evidenceImageKey,
  type EvidenceDetailRow,
} from "@/lib/rubber-evidence/slides";
import type { Location, Profile, RubberBill } from "@/types";

const CARD_PAGE_SIZE = 5;

const statusLabel = {
  outside: "นอกช่วงตรวจ",
  normal: "หลักฐานครบ",
  pending: "รอตรวจ",
  pass: "ผ่าน",
  improve: "ควรปรับปรุง",
} as const;

const statusClass = {
  outside: "bg-slate-100 text-slate-600",
  normal: "bg-mint text-ink",
  pending: "bg-amber-100 text-amber-800",
  pass: "bg-green-100 text-green-800",
  improve: "bg-red-100 text-red-800",
} as const;

function formatEvidenceDateTime(value: string | null) {
  if (!value) return "ไม่ทราบเวลา";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
}

function ImagePanel({
  title,
  mappedUrl,
  objectUrl,
  error,
  pending,
}: {
  title: string;
  mappedUrl: string | null;
  objectUrl?: string;
  error?: string;
  pending: boolean;
}) {
  return (
    <figure className="min-w-0 rounded-lg border border-black/10 bg-field p-2">
      <figcaption className="mb-2 text-pretty text-sm font-bold text-ink">{title}</figcaption>
      {!mappedUrl ? (
        <div className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-md bg-white p-3 text-center text-sm text-ink/55">
          <ImageOff aria-hidden="true" size={26} />
          ไม่มี mapping {title}
        </div>
      ) : error ? (
        <div className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-md bg-danger/5 p-3 text-center text-sm text-danger">
          <TriangleAlert aria-hidden="true" size={24} />
          <span className="text-pretty">โหลดรูปที่มี mapping ไม่สำเร็จ: {error}</span>
        </div>
      ) : objectUrl ? (
        // Object URLs are authenticated, revision-scoped blobs owned by the page loader.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={objectUrl} alt={title} className="mx-auto max-h-52 w-full rounded-md bg-white object-contain" />
      ) : (
        <div className="flex min-h-36 items-center justify-center rounded-md bg-white text-sm text-ink/55" aria-live="polite">
          {pending ? "กำลังเตรียมรูป..." : "ยังไม่ได้เตรียมรูป"}
        </div>
      )}
    </figure>
  );
}

function imageProps(
  billId: string,
  revisionNo: number,
  row: EvidenceDetailRow,
  role: "rubber" | "displayIn" | "displayOut",
  page: ReturnType<typeof useRubberEvidencePage>,
) {
  const key = evidenceImageKey(billId, revisionNo, row.id, role);
  const mappedUrl = role === "rubber"
    ? row.rubberImageUrl
    : role === "displayIn"
      ? row.displayInImageUrl
      : row.displayOutImageUrl;
  return {
    mappedUrl,
    objectUrl: page.imageUrls[key],
    error: page.imageErrors[key],
    pending: (page.pendingImagesByBill[billId] ?? 0) > 0,
  };
}

function EvidenceCard({
  bill,
  review,
  page,
  canManage,
  online,
  busy,
  activeSlide,
  actionError,
  onSlideChange,
  onDecision,
  onRetry,
}: {
  bill: RubberBill;
  review: EvidenceReviewState;
  page: ReturnType<typeof useRubberEvidencePage>;
  canManage: boolean;
  online: boolean;
  busy: boolean;
  activeSlide: number;
  actionError?: string;
  onSlideChange: (slide: number) => void;
  onDecision: (decision: "pass" | "improve") => void;
  onRetry: () => void;
}) {
  const detail = page.details[bill.id];
  const detailError = page.detailErrors[bill.id];
  const slides = detail ? buildEvidenceSlides(detail) : [];
  const hasAnyMappedImage = detail?.rows.some((row) => (
    row.rubberImageUrl || row.displayInImageUrl || row.displayOutImageUrl
  )) ?? false;
  const slideIndex = Math.min(activeSlide, Math.max(slides.length - 1, 0));
  const slide = slides[slideIndex];
  const hasImageError = Object.keys(page.imageErrors).some((key) => key.startsWith(`${bill.id}:${bill.revisionNo}:`));
  const imagesPending = (page.pendingImagesByBill[bill.id] ?? 0) > 0;
  const canDecide = canManage && online && !busy && Boolean(detail) && !detailError && !hasImageError && !imagesPending;

  function move(delta: number) {
    if (slides.length <= 1) return;
    onSlideChange((slideIndex + delta + slides.length) % slides.length);
  }

  return (
    <article
      id={`evidence-card-${bill.id}`}
      data-testid={`evidence-card-${bill.id}`}
      className="min-w-0 scroll-mt-4 rounded-xl border border-black/10 bg-white p-3 shadow-panel sm:p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-balance font-bold text-ink">{bill.serverBillNo ?? bill.billNo ?? bill.localBillNo}</h3>
          <p className="truncate text-pretty text-sm text-ink/60">{bill.customerName} · {formatEvidenceDateTime(review.clientCreatedAt)}</p>
          {review.reviewedByName && (
            <p className="truncate text-pretty text-xs text-ink/55">
              ตรวจล่าสุดโดย {review.reviewedByName} · {formatEvidenceDateTime(review.reviewedAt)}
            </p>
          )}
        </div>
        <span className={cn("rounded-full px-2 py-1 text-xs font-bold", statusClass[review.reviewStatus])}>
          {statusLabel[review.reviewStatus]}
        </span>
      </header>

      <div className="mt-3 flex flex-wrap gap-1.5 text-xs font-semibold">
        {review.missingRubber && <span className="rounded-full bg-danger/10 px-2 py-1 text-danger">ไม่มีรูปยาง</span>}
        {review.missingDisplayIn && <span className="rounded-full bg-danger/10 px-2 py-1 text-danger">ไม่มีรูปจอเข้า</span>}
        {review.hasManualCorrection && <span className="rounded-full bg-amber/15 px-2 py-1 text-amber-800">แก้ด้วยมือ</span>}
      </div>

      {detailError ? (
        <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          <p className="text-pretty">โหลดรายละเอียดไม่สำเร็จ: {detailError}</p>
          <button type="button" onClick={onRetry} disabled={!online} title={!online ? "ลองใหม่ได้เมื่อออนไลน์" : undefined} className="focus-ring mt-2 inline-flex h-9 items-center gap-2 rounded-md bg-danger px-3 font-semibold text-white disabled:opacity-50">
            <RefreshCw size={15} /> ลองใหม่
          </button>
        </div>
      ) : !detail ? (
        <div className="mt-3 rounded-lg bg-field p-4 text-center text-sm text-ink/55">กำลังเตรียมรายละเอียด...</div>
      ) : (
        <>
          {!hasAnyMappedImage && (
            <div className="mt-3 flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-black/15 bg-field p-3 text-center text-sm text-ink/60">
              <ImageOff size={24} aria-hidden="true" />
              <strong className="text-ink">ไม่พบรูปหลักฐาน</strong>
              <span>ยังตรวจข้อมูลน้ำหนักและสรุปบิลได้</span>
            </div>
          )}
          <div className="mt-3 flex items-center justify-between gap-2">
            <button type="button" aria-label="สไลด์ก่อนหน้า" onClick={() => move(-1)} disabled={slides.length <= 1} className="focus-ring grid size-11 place-items-center rounded-md bg-actionSecondary text-white disabled:opacity-40">
              <ChevronLeft size={20} />
            </button>
            <div className="min-w-0 text-center">
              <p className="truncate text-sm font-bold text-ink">{slide?.kind === "weigh" ? `รายการชั่ง ${slide.row.sequenceNo}` : "สรุป"}</p>
              <p className="tabular-nums text-xs text-ink/55">{slideIndex + 1} / {slides.length}</p>
            </div>
            <button type="button" aria-label="สไลด์ถัดไป" onClick={() => move(1)} disabled={slides.length <= 1} className="focus-ring grid size-11 place-items-center rounded-md bg-actionSecondary text-white disabled:opacity-40">
              <ChevronRight size={20} />
            </button>
          </div>

          {slide?.kind === "weigh" && (
            <section className="mt-3 space-y-3" aria-label={`รายการชั่ง ${slide.row.sequenceNo}`}>
              <div className="grid grid-cols-3 gap-2 rounded-lg bg-sand p-3 text-center text-sm">
                <div><span className="block text-xs text-ink/55">เข้า</span><strong className="tabular-nums">{formatNumber(slide.row.inWeight)}</strong></div>
                <div><span className="block text-xs text-ink/55">ออก</span><strong className="tabular-nums">{formatNumber(slide.row.outWeight)}</strong></div>
                <div><span className="block text-xs text-ink/55">สุทธิ</span><strong className="tabular-nums">{formatNumber(slide.row.netWeight)}</strong></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <ImagePanel title="รูปจอชั่งเข้า" {...imageProps(bill.id, bill.revisionNo, slide.row, "displayIn", page)} />
                <ImagePanel title="รูปจอชั่งออก" {...imageProps(bill.id, bill.revisionNo, slide.row, "displayOut", page)} />
              </div>
            </section>
          )}

          {slide?.kind === "summary" && (
            <section className="mt-3 space-y-3" aria-label="สรุปบิล">
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-sand p-3 text-sm">
                <div><span className="block text-xs text-ink/55">น้ำหนักสุทธิ</span><strong className="tabular-nums">{formatNumber(bill.netWeight)} กก.</strong></div>
                <div><span className="block text-xs text-ink/55">น้ำหนักที่หัก</span><strong className="tabular-nums">{formatNumber(bill.deductWeight)} กก.</strong></div>
                <div><span className="block text-xs text-ink/55">เงินที่หัก</span><strong className="tabular-nums">{formatNumber(bill.deductionTotal)} บาท</strong></div>
                <div><span className="block text-xs text-ink/55">ยอดจ่ายลูกค้า</span><strong className="tabular-nums">{formatNumber(bill.netTotal)} บาท</strong></div>
              </div>
              {slide.rubberRow ? (
                <ImagePanel title={`รูปยาง รายการ ${slide.rubberRow.sequenceNo}`} {...imageProps(bill.id, bill.revisionNo, slide.rubberRow, "rubber", page)} />
              ) : (
                <div className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-lg bg-field p-3 text-center text-sm text-ink/55">
                  <ImageOff size={26} aria-hidden="true" /> ไม่มี mapping รูปยาง
                </div>
              )}
            </section>
          )}
        </>
      )}

      {hasImageError && (
        <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          <p className="text-pretty">มีรูปที่โหลดไม่สำเร็จ จึงยังตัดสินการ์ดนี้ไม่ได้</p>
          <button type="button" onClick={onRetry} disabled={!online} title={!online ? "ลองใหม่ได้เมื่อออนไลน์" : undefined} className="focus-ring mt-2 inline-flex h-9 items-center gap-2 rounded-md bg-danger px-3 font-semibold text-white disabled:opacity-50">
            <RefreshCw size={15} /> โหลดรูปใหม่
          </button>
        </div>
      )}

      {canManage && ["pending", "pass", "improve"].includes(review.reviewStatus) && (
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-black/10 pt-3">
          <button type="button" disabled={!canDecide} title={!online ? "บันทึกผลได้เมื่อออนไลน์เท่านั้น" : imagesPending ? "รอรูปทั้งหมดของการ์ดนี้ก่อน" : undefined} onClick={() => onDecision("improve")} className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-amber px-2 text-sm font-bold text-white disabled:opacity-50">
            <RotateCcw size={17} /> ควรปรับปรุง
          </button>
          <button type="button" disabled={!canDecide} title={!online ? "บันทึกผลได้เมื่อออนไลน์เท่านั้น" : imagesPending ? "รอรูปทั้งหมดของการ์ดนี้ก่อน" : undefined} onClick={() => onDecision("pass")} className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-leaf px-2 text-sm font-bold text-white disabled:opacity-50">
            <CheckCircle2 size={17} /> ผ่าน
          </button>
        </div>
      )}
      {actionError && <p className="mt-2 text-pretty text-sm text-danger" role="alert">{actionError}</p>}
    </article>
  );
}

export function RubberEvidenceModule({
  selectedLocation,
  profile,
  online,
  initialBillId,
  onInitialBillHandled,
}: {
  selectedLocation: Location;
  profile: Profile;
  online: boolean;
  initialBillId?: string | null;
  onInitialBillHandled?: () => void;
}) {
  const review = useRubberBillEvidenceReview(selectedLocation.id);
  const canManage = canManageSystemFeatures(profile);
  const [view, setView] = useState<RubberEvidenceView>("pending");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [targetBillId, setTargetBillId] = useState<string | null>(initialBillId ?? null);
  const [pageNumber, setPageNumber] = useState(1);
  const [slidesByBill, setSlidesByBill] = useState<Record<string, number>>({});
  const [confirmPassAll, setConfirmPassAll] = useState(false);
  const [confirmClosePeriod, setConfirmClosePeriod] = useState(false);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});

  const feed = useRubberEvidenceFeed({
    ownerUserId: profile.id,
    locationId: selectedLocation.id,
    view,
    search: debouncedSearch,
    billId: targetBillId,
  });
  const totalPages = Math.max(1, Math.ceil(feed.cards.length / CARD_PAGE_SIZE));
  const currentPage = Math.min(pageNumber, totalPages);
  const pageCards = feed.cards.slice((currentPage - 1) * CARD_PAGE_SIZE, currentPage * CARD_PAGE_SIZE);
  const pageIdentityKey = pageCards.map(({ bill }) => `${bill.id}:${bill.revisionNo}`).join("|");
  const pageIdentities = useMemo(
    () => pageCards.map(({ bill }) => ({ id: bill.id, revisionNo: bill.revisionNo })),
    // Status polling recreates card wrappers; image preparation only depends on identity + revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageIdentityKey],
  );
  const evidencePage = useRubberEvidencePage(pageIdentities, online);

  useEffect(() => {
    setView("pending");
    setSearch("");
    setDebouncedSearch("");
    setTargetBillId(null);
    setPageNumber(1);
  }, [selectedLocation.id]);

  useEffect(() => {
    if (!initialBillId) return;
    setTargetBillId(initialBillId);
    setPageNumber(1);
  }, [initialBillId]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!targetBillId || feed.isLoading) return;
    const index = feed.cards.findIndex(({ bill }) => bill.id === targetBillId);
    if (index < 0) {
      toast.error("ไม่พบบิลเป้าหมายในสิทธิ์สาขา");
      onInitialBillHandled?.();
      return;
    }
    setSearch("");
    setPageNumber(Math.floor(index / CARD_PAGE_SIZE) + 1);
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`evidence-card-${targetBillId}`)?.scrollIntoView({ block: "start" });
      onInitialBillHandled?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [feed.cards, feed.isLoading, onInitialBillHandled, targetBillId]);

  async function decide(bill: RubberBill, decision: "pass" | "improve") {
    setActionErrors((current) => ({ ...current, [bill.id]: "" }));
    try {
      const result = await review.decide({
        billId: bill.id,
        revisionNo: bill.revisionNo,
        expectedStatus: pageCards.find((card) => card.bill.id === bill.id)?.review.reviewStatus as "pending" | "pass" | "improve",
        decision,
      });
      if (result.state === "stale") {
        throw new Error("สถานะบิลเปลี่ยนแล้ว กรุณาตรวจรายการล่าสุด");
      }
      toast.success(decision === "pass" ? "ทำเครื่องหมายผ่านแล้ว" : "ทำเครื่องหมายควรปรับปรุงแล้ว");
    } catch (error) {
      setActionErrors((current) => ({
        ...current,
        [bill.id]: error instanceof Error ? error.message : "บันทึกผลตรวจไม่สำเร็จ",
      }));
    }
  }

  async function togglePeriod() {
    try {
      const result = review.overview.isOpen ? await review.closeReview() : await review.openReview();
      if (result.state === "blocked") {
        setConfirmClosePeriod(false);
        toast.error(`ยังมีรอตรวจ ${Number(result.pendingCount ?? review.overview.pendingCount)} รายการ`);
        return;
      }
      toast.success(review.overview.isOpen ? "ปิดการตรวจหลักฐานแล้ว" : "เปิดการตรวจหลักฐานแล้ว");
      setConfirmClosePeriod(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "เปลี่ยนสถานะรอบตรวจไม่สำเร็จ");
    }
  }

  async function passAll() {
    try {
      const result = await review.passAll({
        pendingCount: review.overview.pendingCount,
        fingerprint: review.overview.pendingFingerprint,
      });
      if (result.state === "stale") {
        throw new Error("รายการรอตรวจเปลี่ยนแล้ว กรุณาตรวจจำนวนใหม่");
      }
      setConfirmPassAll(false);
      toast.success(`ทำเครื่องหมายผ่าน ${review.overview.pendingCount} รายการแล้ว`);
    } catch (error) {
      setConfirmPassAll(false);
      toast.error(error instanceof Error ? error.message : "ตรวจทั้งหมดไม่สำเร็จ");
    }
  }

  const viewOptions: Array<[RubberEvidenceView, string]> = [
    ["pending", "รอตรวจ"],
    ["history", "ประวัติการตรวจ"],
  ];

  async function nextPage() {
    if (currentPage < totalPages) {
      setPageNumber(currentPage + 1);
      return;
    }
    if (!feed.hasMore) return;
    const result = await feed.fetchNextPage();
    if ((result.data?.pages.flatMap((page) => page.cards).length ?? feed.cards.length) > feed.cards.length) {
      setPageNumber(currentPage + 1);
    }
  }

  return (
    <section aria-label="ตรวจหลักฐาน" className="space-y-4 pb-[env(safe-area-inset-bottom)]">
      <header className="rounded-xl border border-black/10 bg-white p-4 shadow-panel sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-mint p-2 text-ink"><ShieldCheck size={22} /></span>
            <div>
              <h2 className="text-balance text-xl font-bold text-ink">ตรวจหลักฐาน</h2>
              <p className="text-pretty text-sm text-ink/60">
                {selectedLocation.name} · {review.overview.isOpen ? `เปิดรอบอยู่ · รอตรวจ ${review.overview.pendingCount} งาน` : "ยังไม่เปิดรอบตรวจ"}
              </p>
            </div>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              {review.overview.pendingCount > 0 && (
                <button type="button" onClick={() => setConfirmPassAll(true)} disabled={!online || review.isMutating} className="focus-ring inline-flex h-10 items-center gap-2 rounded-md bg-leaf px-3 text-sm font-bold text-white disabled:opacity-50">
                  <CheckCheck size={17} /> ตรวจทั้งหมดให้ผ่าน
                </button>
              )}
              <button type="button" onClick={() => review.overview.isOpen ? setConfirmClosePeriod(true) : void togglePeriod()} disabled={!online || review.isMutating} className={cn("focus-ring h-10 rounded-md px-4 text-sm font-bold text-white disabled:opacity-50", review.overview.isOpen ? "bg-danger" : "bg-settings")}>
                {review.overview.isOpen ? "ปิดการตรวจ" : "เปิดการตรวจ"}
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="rounded-xl border border-black/10 bg-white p-3 shadow-panel sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1 rounded-lg bg-field p-1" aria-label="กรองสถานะหลักฐาน">
            {viewOptions.map(([value, label]) => {
              return (
                <button key={value} type="button" aria-pressed={view === value} onClick={() => { setView(value); setTargetBillId(null); setPageNumber(1); }} className={cn("focus-ring min-h-9 rounded-md px-3 text-sm font-semibold", view === value ? "bg-river text-white shadow-sm" : "text-ink hover:bg-white")}>
                  {label}
                </button>
              );
            })}
          </div>
          <label className="text-sm font-semibold text-ink">
            <span className="sr-only">ค้นหาบิลหลักฐาน</span>
            <input value={search} onChange={(event) => { setSearch(event.target.value); setTargetBillId(null); setPageNumber(1); }} placeholder="ค้นหาเลขบิลหรือลูกค้า" className="focus-ring h-10 w-full rounded-md border border-black/20 bg-white px-3 sm:w-72" />
          </label>
        </div>
      </div>

      {(review.isLoading || feed.isLoading) && <div className="rounded-xl bg-white p-8 text-center text-ink/55">กำลังโหลดคิวตรวจ...</div>}
      {(review.isError || feed.isError) && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-center text-danger">
          <p>โหลดคิวตรวจไม่สำเร็จ</p>
          <button type="button" onClick={() => void Promise.all([review.refetch(), feed.refetch()])} className="focus-ring mt-2 rounded-md bg-danger px-3 py-2 text-sm font-semibold text-white">ลองใหม่</button>
        </div>
      )}
      {!review.isLoading && !review.isError && !feed.isLoading && !feed.isError && pageCards.length === 0 && (
        <div className="rounded-xl border border-dashed border-black/15 bg-white p-8 text-center">
          <p className="text-pretty text-ink/60">{search ? "ไม่พบบิลที่ค้นหา" : view === "pending" ? "ไม่มีงานรอตรวจ" : "ยังไม่มีประวัติการตรวจ"}</p>
          {!search && <button type="button" onClick={() => setView(view === "pending" ? "history" : "pending")} className="focus-ring mt-3 h-10 rounded-md bg-river px-4 text-sm font-semibold text-white">{view === "pending" ? "ดูประวัติการตรวจ" : "กลับไปงานรอตรวจ"}</button>}
        </div>
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {pageCards.map(({ bill, review: state }) => (
          <EvidenceCard
            key={`${bill.id}:${bill.revisionNo}`}
            bill={bill}
            review={state}
            page={evidencePage}
            canManage={canManage}
            online={online}
            busy={review.isMutating}
            activeSlide={slidesByBill[bill.id] ?? 0}
            actionError={actionErrors[bill.id]}
            onSlideChange={(slide) => setSlidesByBill((current) => ({ ...current, [bill.id]: slide }))}
            onDecision={(decision) => void decide(bill, decision)}
            onRetry={evidencePage.retry}
          />
        ))}
      </div>

      {feed.cards.length > 0 && (
        <nav aria-label="แบ่งหน้าการ์ดหลักฐาน" className="flex items-center justify-center gap-3 rounded-xl bg-white p-3 shadow-panel">
          <button type="button" aria-label="หน้าก่อนหน้า" onClick={() => setPageNumber(Math.max(currentPage - 1, 1))} disabled={currentPage <= 1} className="focus-ring grid size-10 place-items-center rounded-md bg-actionSecondary text-white disabled:opacity-40"><ChevronLeft size={19} /></button>
          <span className="tabular-nums text-sm font-semibold text-ink">หน้า {currentPage} / {totalPages} · โหลดแล้ว {feed.cards.length} รายการ</span>
          <button type="button" aria-label="หน้าถัดไป" onClick={() => void nextPage()} disabled={(currentPage >= totalPages && !feed.hasMore) || feed.isFetchingNextPage} className="focus-ring grid size-10 place-items-center rounded-md bg-actionSecondary text-white disabled:opacity-40"><ChevronRight size={19} /></button>
        </nav>
      )}

      <OperationWaitingDialog
        open={evidencePage.waiting}
        title="กำลังเตรียมหลักฐาน"
        description="กำลังโหลดรายละเอียดและรูปแรกของการ์ดในหน้านี้"
        progress={`รูปแรกพร้อม ${evidencePage.preparedFirstImages}/${evidencePage.totalFirstImages}`}
        onCancel={evidencePage.cancel}
      />
      <AlertDialog
        open={confirmPassAll}
        title="ตรวจทั้งหมดให้ผ่าน?"
        description={`สาขา ${selectedLocation.name} · ระบบจะตรวจสถานะซ้ำก่อนบันทึก ${review.overview.pendingCount} รายการ`}
        confirmLabel="ยืนยันให้ผ่านทั้งหมด"
        busy={review.isMutating}
        onCancel={() => setConfirmPassAll(false)}
        onConfirm={() => void passAll()}
      />
      <AlertDialog
        open={confirmClosePeriod}
        title="ปิดรอบตรวจ?"
        description="บิลใหม่หลังเวลาปิดจะไม่อยู่ในรอบนี้ และระบบจะปฏิเสธหากยังมีรายการรอตรวจ"
        confirmLabel="ยืนยันปิดรอบ"
        busy={review.isMutating}
        onCancel={() => setConfirmClosePeriod(false)}
        onConfirm={() => void togglePeriod()}
      />
    </section>
  );
}
