type TimeTrackingActionRequest = {
  action: string;
  payload: Record<string, any>;
};

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function readTimeTrackingActionRequest(
  request: Request,
): Promise<TimeTrackingActionRequest | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (!isRecord(body) || typeof body.action !== "string") return null;
  if (body.payload !== undefined && !isRecord(body.payload)) return null;
  return { action: body.action, payload: body.payload ?? {} };
}
