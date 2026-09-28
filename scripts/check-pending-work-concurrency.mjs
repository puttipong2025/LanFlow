import { spawn, spawnSync } from "node:child_process";

const docker = (args) => spawnSync("docker", args, { encoding: "utf8" });
const listed = docker(["ps", "--format", "{{.Names}}"]);
if (listed.status !== 0) throw new Error(listed.stderr || "docker ps failed");
const candidates = listed.stdout.split(/\r?\n/).filter((name) => name.startsWith("supabase_db_"));
const container = process.env.SUPABASE_DB_CONTAINER
  ?? candidates.find((name) => name === "supabase_db_webapp")
  ?? (candidates.length === 1 ? candidates[0] : null);
if (!container) throw new Error("Set SUPABASE_DB_CONTAINER to the local Supabase database container");

const psqlArgs = (sql) => [
  "exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1",
  "-U", "postgres", "-d", "postgres", "-Atc", sql,
];
function run(sql) {
  const result = docker(psqlArgs(sql));
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "psql failed");
  return result.stdout.trim();
}
function runAsync(sql) {
  const child = spawn("docker", psqlArgs(sql), { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return {
    result: new Promise((resolve) => child.on("close", (status) => resolve({ status, stdout, stderr }))),
  };
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const managerId = "72000000-0000-4000-8000-000000000001";
const locations = {
  incomePending: "71000000-0000-4000-8000-000000000001",
  incomeReport: "71000000-0000-4000-8000-000000000002",
  cashPending: "71000000-0000-4000-8000-000000000003",
  cashReport: "71000000-0000-4000-8000-000000000004",
  cashTarget: "71000000-0000-4000-8000-000000000005",
  stockPending: "71000000-0000-4000-8000-000000000006",
  stockReport: "71000000-0000-4000-8000-000000000007",
};
const allLocations = Object.values(locations).map((id) => `'${id}'`).join(", ");
const incomeIds = ["73000000-0000-4000-8000-000000000001", "73000000-0000-4000-8000-000000000002"];
const cashIds = ["74000000-0000-4000-8000-000000000001", "74000000-0000-4000-8000-000000000002"];
const productId = "75000000-0000-4000-8000-000000000001";
const stockIds = ["76000000-0000-4000-8000-000000000001", "76000000-0000-4000-8000-000000000002"];

const cleanup = `
delete from public.income_expense_approval_requests where request_idempotency_key like 'pending-race-income-%';
delete from public.cash_transfer_delete_requests where transfer_id in ('${cashIds[0]}', '${cashIds[1]}');
delete from public.stock_entry_approval_requests where request_idempotency_key like 'pending-race-stock-%';
delete from public.report_items where location_id in (${allLocations});
delete from public.report_batches where location_id in (${allLocations});
delete from private.document_number_counters where location_id in (${allLocations});
delete from public.money_transfer_cash_details where transfer_id in ('${cashIds[0]}', '${cashIds[1]}');
delete from public.money_transfers where id in ('${cashIds[0]}', '${cashIds[1]}');
delete from public.stock_entries where id in ('${stockIds[0]}', '${stockIds[1]}');
delete from public.stock_products where id = '${productId}';
delete from public.income_expense where id in ('${incomeIds[0]}', '${incomeIds[1]}');
set constraints all immediate;
delete from public.dashboard_money_events where location_id in (${allLocations});
delete from public.user_locations where user_id = '${managerId}';
delete from public.locations where id in (${allLocations});
delete from public.profiles where id = '${managerId}';
`;

function reportSql(locationId, hold = false) {
  return `
    ${hold ? "begin;" : ""}
    select set_config('request.jwt.claim.sub', '${managerId}', ${hold ? "true" : "false"});
    select set_config('request.jwt.claims', '{"sub":"${managerId}","role":"authenticated"}', ${hold ? "true" : "false"});
    ${hold ? "set local role authenticated;" : "set role authenticated;"}
    select public.create_report_batch('${locationId}');
    ${hold ? "select pg_sleep(2); commit;" : ""}
  `;
}

async function assertRace(config) {
  const pendingWinner = runAsync(`begin; ${config.pendingFirstInsert} select pg_sleep(2); commit;`);
  await delay(500);
  const reportLoser = runAsync(reportSql(config.pendingLocation));
  const [pendingResult, reportResult] = await Promise.all([pendingWinner.result, reportLoser.result]);
  if (pendingResult.status !== 0) throw new Error(`${config.label} pending-first failed: ${pendingResult.stderr}`);
  if (reportResult.status === 0 || !reportResult.stderr.includes("PENDING_WORK_BLOCKED")) {
    throw new Error(`${config.label} pending-first did not block report: ${reportResult.stdout}\n${reportResult.stderr}`);
  }

  const reportWinner = runAsync(reportSql(config.reportLocation, true));
  await delay(500);
  const pendingLoser = runAsync(config.reportFirstInsert);
  const [reportWinnerResult, pendingLoserResult] = await Promise.all([reportWinner.result, pendingLoser.result]);
  if (reportWinnerResult.status !== 0) throw new Error(`${config.label} report-first failed: ${reportWinnerResult.stderr}`);
  if (pendingLoserResult.status === 0 || !pendingLoserResult.stderr.includes("REPORT_LOCKED:")) {
    throw new Error(`${config.label} report-first did not block pending: ${pendingLoserResult.stdout}\n${pendingLoserResult.stderr}`);
  }

  const state = JSON.parse(run(`
    select jsonb_build_object(
      'pendingFirstCount', (${config.pendingFirstCount}),
      'pendingFirstReports', (select count(*) from public.report_batches where location_id = '${config.pendingLocation}' and status = 'active'),
      'reportFirstCount', (${config.reportFirstCount}),
      'reportFirstReports', (select count(*) from public.report_batches where location_id = '${config.reportLocation}' and status = 'active')
    );
  `));
  if (state.pendingFirstCount !== 1 || state.pendingFirstReports !== 0
    || state.reportFirstCount !== 0 || state.reportFirstReports !== 1) {
    throw new Error(`${config.label} invariant failed: ${JSON.stringify(state)}`);
  }
  console.log(`${config.label} concurrency: PASS`);
}

try {
  run(cleanup);
  run(`
    insert into public.locations (id, name, code, is_active) values
      ('${locations.incomePending}', 'Pending race income first', 'PRI1', true),
      ('${locations.incomeReport}', 'Pending race income second', 'PRI2', true),
      ('${locations.cashPending}', 'Pending race cash first', 'PRC1', true),
      ('${locations.cashReport}', 'Pending race cash second', 'PRC2', true),
      ('${locations.cashTarget}', 'Pending race cash target', 'PRCT', true),
      ('${locations.stockPending}', 'Pending race stock first', 'PRS1', true),
      ('${locations.stockReport}', 'Pending race stock second', 'PRS2', true);
    insert into public.profiles (id, phone, name, role, is_active, can_access_super_admin_features)
    values ('${managerId}', '0897200001', 'Pending Race Manager', 'admin', true, true);
    insert into public.user_locations (user_id, location_id, is_primary)
    select '${managerId}', id, id = '${locations.incomePending}' from public.locations where id in (${allLocations});

    insert into public.income_expense (
      id, client_temp_id, local_bill_no, sync_status, location_id, type, number,
      tx_date, title, cost, bill_option, created_by_user_id, created_by_name,
      created_by_phone, created_at, updated_at
    ) values
      ('${incomeIds[0]}', 'pending-race-income-first', 'PRI-IE-1', 'synced', '${locations.incomePending}', 'expense', 'PRI-IE-1', current_date, 'Pending race income first', 10, 'ค่าใช้จ่าย', '${managerId}', 'Pending Race Manager', '0897200001', now(), now()),
      ('${incomeIds[1]}', 'pending-race-income-second', 'PRI-IE-2', 'synced', '${locations.incomeReport}', 'expense', 'PRI-IE-2', current_date, 'Pending race income second', 20, 'ค่าใช้จ่าย', '${managerId}', 'Pending Race Manager', '0897200001', now(), now());

    insert into public.money_transfers (
      id, client_temp_id, idempotency_key, location_id, net_amount_to_pay,
      transfer_status, transfer_type, transfer_method, target_location_id,
      target_location_name, sync_status, created_by_user_id, created_by_name,
      created_by_phone, created_at, updated_at
    ) values
      ('${cashIds[0]}', 'pending-race-cash-first', 'pending-race-cash-first', '${locations.cashPending}', 20, 'paid', 'cash', 'cash', '${locations.cashTarget}', 'Pending race cash target', 'synced', '${managerId}', 'Pending Race Manager', '0897200001', now(), now()),
      ('${cashIds[1]}', 'pending-race-cash-second', 'pending-race-cash-second', '${locations.cashReport}', 20, 'paid', 'cash', 'cash', '${locations.cashTarget}', 'Pending race cash target', 'synced', '${managerId}', 'Pending Race Manager', '0897200001', now(), now());
    insert into public.money_transfer_cash_details (
      transfer_id, sent_coin_1_count, sent_coin_2_count, sent_coin_5_count,
      sent_coin_10_count, sent_banknote_20_count, sent_banknote_50_count,
      sent_banknote_100_count, sent_banknote_500_count, sent_banknote_1000_count,
      cash_status, sent_at, created_at, updated_at
    ) values
      ('${cashIds[0]}', 0, 0, 0, 0, 1, 0, 0, 0, 0, 'pending_receipt', now(), now(), now()),
      ('${cashIds[1]}', 0, 0, 0, 0, 1, 0, 0, 0, 0, 'pending_receipt', now(), now(), now());

    insert into public.stock_products (id, name, unit) values ('${productId}', 'Pending Race Product', 'ถัง');
    insert into public.stock_entries (
      id, tx_date, product_id, product_name, quantity_delta, amount, location_id,
      tx_type, created_by_user_id, created_by_name, created_by_phone, created_at, updated_at
    ) values
      ('${stockIds[0]}', current_date, '${productId}', 'Pending Race Product', 2, 200, '${locations.stockPending}', 'receive', '${managerId}', 'Pending Race Manager', '0897200001', now(), now()),
      ('${stockIds[1]}', current_date, '${productId}', 'Pending Race Product', 1, 100, '${locations.stockReport}', 'receive', '${managerId}', 'Pending Race Manager', '0897200001', now(), now());
  `);

  const forwardLocks = runAsync(`
    begin;
    select private.lock_report_locations(array['${locations.cashPending}'::uuid, '${locations.cashTarget}'::uuid]);
    select pg_sleep(1);
    commit;
  `);
  await delay(250);
  const reverseLocks = runAsync(`
    begin;
    select private.lock_report_locations(array['${locations.cashTarget}'::uuid, '${locations.cashPending}'::uuid]);
    commit;
  `);
  const [forwardResult, reverseResult] = await Promise.all([forwardLocks.result, reverseLocks.result]);
  if (forwardResult.status !== 0 || reverseResult.status !== 0) {
    throw new Error(`sorted multi-branch locks failed: ${forwardResult.stderr}\n${reverseResult.stderr}`);
  }
  console.log("sorted multi-branch locks: PASS");

  await assertRace({
    label: "income/expense",
    pendingLocation: locations.incomePending,
    reportLocation: locations.incomeReport,
    pendingFirstInsert: `insert into public.income_expense_approval_requests (requested_operation, request_idempotency_key, requested_payload, source_income_expense_id, matched_reasons, location_id, tx_type, title, cost, requested_by_user_id, requested_by_name, requested_by_phone) values ('delete', 'pending-race-income-pending-first', '{}', '${incomeIds[0]}', array['amount_threshold'], '${locations.incomePending}', 'expense', 'Pending race income first', 10, '${managerId}', 'Pending Race Manager', '0897200001');`,
    reportFirstInsert: `insert into public.income_expense_approval_requests (requested_operation, request_idempotency_key, requested_payload, source_income_expense_id, matched_reasons, location_id, tx_type, title, cost, requested_by_user_id, requested_by_name, requested_by_phone) values ('delete', 'pending-race-income-report-first', '{}', '${incomeIds[1]}', array['amount_threshold'], '${locations.incomeReport}', 'expense', 'Pending race income second', 20, '${managerId}', 'Pending Race Manager', '0897200001');`,
    pendingFirstCount: "select count(*) from public.income_expense_approval_requests where request_idempotency_key = 'pending-race-income-pending-first'",
    reportFirstCount: "select count(*) from public.income_expense_approval_requests where request_idempotency_key = 'pending-race-income-report-first'",
  });

  await assertRace({
    label: "cash delete",
    pendingLocation: locations.cashPending,
    reportLocation: locations.cashReport,
    pendingFirstInsert: `insert into public.cash_transfer_delete_requests (transfer_id, source_location_id, source_location_name, target_location_id, target_location_name, transfer_display_no, sent_total, received_total, difference_total, requested_by_user_id, requested_by_name, requested_by_phone) values ('${cashIds[0]}', '${locations.cashPending}', 'Pending race cash first', '${locations.cashTarget}', 'Pending race cash target', 'PRC-CASH-1', 20, 0, -20, '${managerId}', 'Pending Race Manager', '0897200001');`,
    reportFirstInsert: `insert into public.cash_transfer_delete_requests (transfer_id, source_location_id, source_location_name, target_location_id, target_location_name, transfer_display_no, sent_total, received_total, difference_total, requested_by_user_id, requested_by_name, requested_by_phone) values ('${cashIds[1]}', '${locations.cashReport}', 'Pending race cash second', '${locations.cashTarget}', 'Pending race cash target', 'PRC-CASH-2', 20, 0, -20, '${managerId}', 'Pending Race Manager', '0897200001');`,
    pendingFirstCount: `select count(*) from public.cash_transfer_delete_requests where transfer_id = '${cashIds[0]}' and request_status = 'pending'`,
    reportFirstCount: `select count(*) from public.cash_transfer_delete_requests where transfer_id = '${cashIds[1]}' and request_status = 'pending'`,
  });

  await assertRace({
    label: "stock delete",
    pendingLocation: locations.stockPending,
    reportLocation: locations.stockReport,
    pendingFirstInsert: `insert into public.stock_entry_approval_requests (request_idempotency_key, requested_payload, stock_entry_id, tx_type, product_id, product_name, quantity, location_id, location_name, requested_by_user_id, requested_by_name, requested_by_phone) values ('pending-race-stock-pending-first', '{}', '${stockIds[0]}', 'receive', '${productId}', 'Pending Race Product', 2, '${locations.stockPending}', 'Pending race stock first', '${managerId}', 'Pending Race Manager', '0897200001');`,
    reportFirstInsert: `insert into public.stock_entry_approval_requests (request_idempotency_key, requested_payload, stock_entry_id, tx_type, product_id, product_name, quantity, location_id, location_name, requested_by_user_id, requested_by_name, requested_by_phone) values ('pending-race-stock-report-first', '{}', '${stockIds[1]}', 'receive', '${productId}', 'Pending Race Product', 1, '${locations.stockReport}', 'Pending race stock second', '${managerId}', 'Pending Race Manager', '0897200001');`,
    pendingFirstCount: "select count(*) from public.stock_entry_approval_requests where request_idempotency_key = 'pending-race-stock-pending-first' and request_status = 'pending'",
    reportFirstCount: "select count(*) from public.stock_entry_approval_requests where request_idempotency_key = 'pending-race-stock-report-first' and request_status = 'pending'",
  });

  console.log("pending-work concurrency matrix: PASS");
} finally {
  run(cleanup);
}
