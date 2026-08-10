import type { MoneyTransferItem } from "@/types";

type SourceRubberBill = {
  id: string;
  billNo: string;
  netWeight: number;
  price: number;
  rubberValue: number;
  deductionTotal: number;
  netTotal: number;
  serverCreatedAt?: string | null;
};

type SourceOcrTicket = {
  id: string;
  ticketId: string | null;
  weightRemaining: number | null;
  totalAmount: number | null;
  moneyDeducted?: number | null;
  createdAt?: string | null;
};

export type MoneyTransferSourceDetailRow = {
  sourceId: string;
  sourceType: MoneyTransferItem["sourceType"];
  sourceLabel: "บิลยาง" | "OCR";
  sourceNumber: string;
  createdAt: string | null;
  netWeight: number | null;
  averagePrice: number | null;
  rubberValue: number | null;
  deductedAmount: number | null;
  netPayableAmount: number | null;
  isMissing: boolean;
};

export type MoneyTransferSourceDetailTotals = {
  netWeight: number;
  averagePrice: number | null;
  rubberValue: number;
  deductedAmount: number;
  netPayableAmount: number;
  missingCount: number;
};

function finiteOrNull(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundToTwo(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sourceTimestamp(value: string | null) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function missingRow(item: MoneyTransferItem): MoneyTransferSourceDetailRow {
  return {
    sourceId: item.sourceId,
    sourceType: item.sourceType,
    sourceLabel: item.sourceType === "rubber_bill" ? "บิลยาง" : "OCR",
    sourceNumber: "ไม่พบข้อมูลต้นทาง",
    createdAt: null,
    netWeight: null,
    averagePrice: null,
    rubberValue: null,
    deductedAmount: null,
    netPayableAmount: null,
    isMissing: true,
  };
}

export function buildMoneyTransferSourceDetails({
  items,
  rubberBills,
  ocrTickets,
}: {
  items: MoneyTransferItem[];
  rubberBills: SourceRubberBill[];
  ocrTickets: SourceOcrTicket[];
}) {
  const rubberBillsById = new Map(rubberBills.map((bill) => [bill.id, bill]));
  const ocrTicketsById = new Map(ocrTickets.map((ticket) => [ticket.id, ticket]));

  const rows = items.map((item): MoneyTransferSourceDetailRow => {
    if (item.sourceType === "rubber_bill") {
      const bill = rubberBillsById.get(item.sourceId);
      if (!bill) return missingRow(item);

      return {
        sourceId: item.sourceId,
        sourceType: item.sourceType,
        sourceLabel: "บิลยาง",
        sourceNumber: bill.billNo,
        createdAt: bill.serverCreatedAt ?? null,
        netWeight: finiteOrNull(bill.netWeight),
        averagePrice: finiteOrNull(bill.price),
        rubberValue: finiteOrNull(bill.rubberValue),
        deductedAmount: finiteOrNull(bill.deductionTotal),
        netPayableAmount: finiteOrNull(bill.netTotal),
        isMissing: false,
      };
    }

    const ticket = ocrTicketsById.get(item.sourceId);
    if (!ticket) return missingRow(item);

    const netWeight = finiteOrNull(ticket.weightRemaining);
    const rubberValue = finiteOrNull(ticket.totalAmount);
    const deductedAmount = finiteOrNull(ticket.moneyDeducted) ?? 0;

    return {
      sourceId: item.sourceId,
      sourceType: item.sourceType,
      sourceLabel: "OCR",
      sourceNumber: ticket.ticketId || "—",
      createdAt: ticket.createdAt ?? null,
      netWeight,
      averagePrice: rubberValue != null && netWeight != null && netWeight > 0
        ? roundToTwo(rubberValue / netWeight)
        : null,
      rubberValue,
      deductedAmount,
      netPayableAmount: rubberValue == null ? null : rubberValue - deductedAmount,
      isMissing: false,
    };
  }).sort((a, b) => {
    const aTimestamp = sourceTimestamp(a.createdAt);
    const bTimestamp = sourceTimestamp(b.createdAt);
    if (aTimestamp !== bTimestamp) return aTimestamp < bTimestamp ? 1 : -1;
    if (a.sourceId === b.sourceId) return 0;
    return a.sourceId < b.sourceId ? 1 : -1;
  });

  const totals = rows.reduce<MoneyTransferSourceDetailTotals>((result, row) => ({
    netWeight: result.netWeight + (row.netWeight ?? 0),
    averagePrice: null,
    rubberValue: result.rubberValue + (row.rubberValue ?? 0),
    deductedAmount: result.deductedAmount + (row.deductedAmount ?? 0),
    netPayableAmount: result.netPayableAmount + (row.netPayableAmount ?? 0),
    missingCount: result.missingCount + (row.isMissing ? 1 : 0),
  }), {
    netWeight: 0,
    averagePrice: null,
    rubberValue: 0,
    deductedAmount: 0,
    netPayableAmount: 0,
    missingCount: 0,
  });

  totals.averagePrice = totals.netWeight > 0
    ? roundToTwo(totals.rubberValue / totals.netWeight)
    : null;

  return { rows, totals };
}
