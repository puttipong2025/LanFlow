import type { RubberBill } from "@/types";
import type { EvidenceReviewState } from "@/hooks/useRubberBillEvidenceReview";

export type EvidenceDetailRow = {
  id: string;
  sequenceNo: number;
  label: string;
  inWeight: number;
  outWeight: number;
  netWeight: number;
  rubberImageUrl: string | null;
  displayInImageUrl: string | null;
  displayOutImageUrl: string | null;
};

export type EvidenceDetail = {
  bill: {
    id: string;
    revisionNo: number;
    billNo: string;
    customerName: string;
    clientCreatedAt: string;
    manualCorrectionCount: number;
  };
  rows: EvidenceDetailRow[];
};

type EvidenceSlide =
  | { kind: "weigh"; row: EvidenceDetailRow }
  | { kind: "summary"; rubberRow: EvidenceDetailRow | null };

export function buildEvidenceSlides(detail: EvidenceDetail): EvidenceSlide[] {
  const rows = [...detail.rows].sort((left, right) => (
    left.sequenceNo - right.sequenceNo || left.id.localeCompare(right.id)
  ));
  const rubberRow = [...rows].reverse().find((row) => Boolean(row.rubberImageUrl)) ?? null;
  return [
    ...rows.map((row): EvidenceSlide => ({ kind: "weigh", row })),
    { kind: "summary", rubberRow },
  ];
}

export function evidenceImageKey(
  billId: string,
  revisionNo: number,
  rowId: string,
  role: "rubber" | "displayIn" | "displayOut",
) {
  return `${billId}:${revisionNo}:${rowId}:${role}`;
}

export type EvidenceFilter = "all" | "pending" | "pass" | "improve" | "normal";

function matchesEvidenceSearch(bill: RubberBill, search: string) {
  const needle = search.trim().toLocaleLowerCase("th");
  if (!needle) return true;
  return [bill.billNo, bill.localBillNo, bill.serverBillNo, bill.customerName, bill.billDate]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("th")
    .includes(needle);
}

export function selectEvidenceCards(
  bills: RubberBill[],
  states: EvidenceReviewState[],
  filter: EvidenceFilter,
  search: string,
) {
  const billsById = new Map(bills.map((bill) => [bill.id, bill]));
  return states.flatMap((state) => {
    const bill = billsById.get(state.billId);
    if (!bill || bill.recordStatus !== "active" || bill.syncStatus !== "synced") return [];
    if (state.reviewStatus === "outside" || !state.reviewPeriodId) return [];
    if (filter !== "all" && state.reviewStatus !== filter) return [];
    if (!matchesEvidenceSearch(bill, search)) return [];
    return [{ bill, review: state }];
  }).sort((left, right) => {
    const leftTime = Date.parse(left.review.clientCreatedAt ?? left.bill.clientCreatedAt);
    const rightTime = Date.parse(right.review.clientCreatedAt ?? right.bill.clientCreatedAt);
    const timeOrder = filter === "pending" ? leftTime - rightTime : rightTime - leftTime;
    return timeOrder || left.bill.id.localeCompare(right.bill.id);
  });
}

export function paginateEvidenceItems<T>(items: T[], requestedPage: number, pageSize = 5) {
  const totalPages = Math.max(Math.ceil(items.length / pageSize), 1);
  const currentPage = Math.min(Math.max(requestedPage, 1), totalPages);
  return {
    currentPage,
    totalPages,
    items: items.slice((currentPage - 1) * pageSize, currentPage * pageSize),
  };
}
