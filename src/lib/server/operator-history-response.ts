import { MONEY_HISTORY_ROUTES, type OperatorMoneyHistory } from "@/lib/operator-money-history";
import { isIsoTimestamp, isJsonObject, isUuid } from "./management-route-error";

type RawOperatorHistory = Omit<OperatorMoneyHistory, "nextCursor"> & {
  nextCursor: { at: string; id: string } | null;
};
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const date = (value: unknown) => typeof value === "string" && isIsoTimestamp(`${value}T00:00:00Z`);

export function isOperatorHistoryResponse(value: unknown): value is RawOperatorHistory {
  if (!isJsonObject(value) || !date(value.selectedDate) || !date(value.availableFrom) || !date(value.availableTo)
    || !count(value.retentionDays) || !isJsonObject(value.counts)
    || !["all", "create", "update", "delete"].every((key) => count((value.counts as Record<string, unknown>)[key]))
    || (value.latestAt !== null && !isIsoTimestamp(value.latestAt))) return false;
  if (value.nextCursor !== null && (!isJsonObject(value.nextCursor)
    || !isUuid(value.nextCursor.id) || !isIsoTimestamp(value.nextCursor.at))) return false;
  if (!Array.isArray(value.actors) || !value.actors.every((actor) => isJsonObject(actor)
    && (actor.key === "unknown" || isUuid(actor.key)) && typeof actor.name === "string")) return false;
  if (!Array.isArray(value.locations) || !value.locations.every((item) => isJsonObject(item)
    && isUuid(item.key) && typeof item.name === "string" && count(item.count))) return false;
  if (!Array.isArray(value.routes) || !value.routes.every((item) => isJsonObject(item)
    && typeof item.key === "string" && Object.hasOwn(MONEY_HISTORY_ROUTES, item.key) && count(item.count))) return false;
  return Array.isArray(value.rows) && value.rows.length <= 10 && value.rows.every((row) => isJsonObject(row)
    && isUuid(row.id) && isUuid(row.locationId) && typeof row.locationName === "string"
    && typeof row.route === "string" && Object.hasOwn(MONEY_HISTORY_ROUTES, row.route)
    && typeof row.action === "string" && ["create", "update", "delete"].includes(row.action)
    && typeof row.direction === "string" && ["income", "expense"].includes(row.direction)
    && typeof row.amount === "number" && Number.isFinite(row.amount) && row.amount >= 0
    && ["sourceType", "kind", "number", "title", "actorName"].every((key) => typeof row[key] === "string")
    && isIsoTimestamp(row.occurredAt));
}
