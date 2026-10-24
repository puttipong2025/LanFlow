export function mapCashCount(row: Record<string, any>) {
  return {
    id: row.id, reportNo: row.count_no, locationId: row.location_id,
    cutoffAt: row.cutoff_at, actualTotal: Number(row.actual_total),
    accountBalance: Number(row.account_balance), countedTotal: Number(row.counted_total),
    systemBalance: row.system_balance == null ? null : Number(row.system_balance),
    differenceTotal: row.system_balance == null ? null : Number(row.difference_total),
    checkedByName: row.checked_by_name, checkedAt: row.checked_at,
    formulaVersion: row.formula_version, status: row.status,
    createdByName: row.created_by_name, createdAt: row.created_at, deletedAt: row.deleted_at,
  };
}
