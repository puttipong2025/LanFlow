
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
