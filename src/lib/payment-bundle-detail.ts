export type PaymentBundleDetailPage = {
  payload: Record<string, unknown>;
  children: Array<Record<string, unknown>>;
  nextCreatedAt: string | null;
  nextId: string | null;
};

export function parsePaymentBundleDetailPage(
  value: unknown,
  seenCursors: Set<string>,
  expectedBundleId?: string,
  seenChildIds: Set<string> = new Set(),
): PaymentBundleDetailPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ข้อมูลรายละเอียดชุดจ่ายรวมไม่ถูกต้อง");
  }

  const payload = value as Record<string, unknown>;
  if (typeof payload.id !== "string" || !Array.isArray(payload.children)) {
    throw new Error("ข้อมูลรายละเอียดชุดจ่ายรวมไม่ครบถ้วน");
  }
  if (expectedBundleId && payload.id !== expectedBundleId) {
    throw new Error("ข้อมูลรายละเอียดชุดจ่ายรวมไม่ตรงกับรายการที่ขอ");
  }
  if (typeof payload.has_more_children !== "boolean") {
    throw new Error("ข้อมูลสถานะหน้าถัดไปของชุดจ่ายรวมไม่ถูกต้อง");
  }

  const children = payload.children.map((child) => {
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      throw new Error("ข้อมูลรายการลูกในชุดจ่ายรวมไม่ถูกต้อง");
    }
    const row = child as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.created_at !== "string") {
      throw new Error("ข้อมูลรายการลูกในชุดจ่ายรวมไม่ครบถ้วน");
    }
    return row;
  });
  const pageChildIds = new Set<string>();
  for (const child of children) {
    const childId = child.id as string;
    if (seenChildIds.has(childId) || pageChildIds.has(childId)) {
      throw new Error("ข้อมูลรายการลูกในชุดจ่ายรวมซ้ำกัน");
    }
    pageChildIds.add(childId);
  }

  if (!payload.has_more_children) {
    for (const childId of pageChildIds) seenChildIds.add(childId);
    return {
      payload,
      children,
      nextCreatedAt: null,
      nextId: null,
    };
  }

  const nextCreatedAt = payload.next_child_created_at;
  const nextId = payload.next_child_id;
  if (typeof nextCreatedAt !== "string" || typeof nextId !== "string") {
    throw new Error("ข้อมูลหน้าถัดไปของชุดจ่ายรวมไม่ครบถ้วน");
  }
  const lastChild = children.at(-1);
  if (!lastChild) {
    throw new Error("ข้อมูลหน้าถัดไปของชุดจ่ายรวมไม่มีรายการอ้างอิง");
  }
  if (lastChild.id !== nextId || lastChild.created_at !== nextCreatedAt) {
    throw new Error("ข้อมูลหน้าถัดไปของชุดจ่ายรวมไม่ตรงกับรายการสุดท้าย");
  }

  const cursor = `${nextCreatedAt}:${nextId}`;
  if (seenCursors.has(cursor)) {
    throw new Error("ข้อมูลหน้าถัดไปของชุดจ่ายรวมวนซ้ำ");
  }
  seenCursors.add(cursor);
  for (const childId of pageChildIds) seenChildIds.add(childId);

  return {
    payload,
    children,
    nextCreatedAt,
    nextId,
  };
}
