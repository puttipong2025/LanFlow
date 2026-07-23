import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireSystemManager } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";
import { reportErrorResponse } from "@/lib/server/report-response";
import type { ReportDetails } from "@/types/reports";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ reportId: string }> };
type Item = { entity_type: string; entity_id: string };

function ids(items: Item[], type: string) {
  return items.filter((item) => item.entity_type === type).map((item) => item.entity_id);
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function datePart(value: unknown) {
  return typeof value === "string" ? value.slice(0, 10) : "";
}

async function rowsByIds(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  table: string,
  columns: string,
  rowIds: string[]
): Promise<Array<Record<string, any>>> {
  if (rowIds.length === 0) return [];
  const { data, error } = await (admin as any).from(table).select(columns).in("id", rowIds);
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<Record<string, any>>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  if (result.auth.role === "user" && !result.auth.canAccessSystemManager) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์ดูรายงาน" }, { status: 403 });
  }

  const { reportId } = await context.params;
  const { data: header, error: headerError } = await result.supabase
    .from("report_batches")
    .select("id, report_no, location_id, cutoff_at, status, created_by_name, created_at, deleted_at, locations(name)")
    .eq("id", reportId)
    .maybeSingle();
  if (headerError) return reportErrorResponse(headerError.message);
  if (!header) return NextResponse.json({ error: "ไม่พบรายงาน" }, { status: 404 });

  const { data: itemRows, error: itemsError } = await result.supabase
    .from("report_items")
    .select("entity_type, entity_id")
    .eq("report_id", reportId);
  if (itemsError) return reportErrorResponse(itemsError.message);

  const items = (itemRows ?? []) as Item[];
  const admin = createSupabaseAdminClient();

  try {
    const [
      rubber,
      ocr,
      stock,
      stockIncome,
      stockRubberResult,
      stockBalanceResult,
      segments,
      leave,
      financial,
      payroll,
      bank,
      ledgerResult,
      latestResult,
    ] = await Promise.all([
      rowsByIds(admin, "rubber_bills", "id, bill_date, server_bill_no, local_bill_no, customer_name, bill_type, weight, deduction_total, net_total, cash_payment, transfer_payment", ids(items, "rubber_bill")),
      rowsByIds(admin, "ocr_tickets", "id, date_in, ticket_id, file_name, customer_name, license_plate, weight_in, weight_out, weight_net, weight_deducted, weight_remaining, total_amount", ids(items, "ocr_ticket")),
      rowsByIds(admin, "stock_entries", "id, tx_date, server_bill_no, transfer_bill_no, product_name, tx_type, quantity_delta, amount", ids(items, "acid_stock_entry")),
      rowsByIds(admin, "income_expense", "id, tx_date, server_bill_no, local_bill_no, stock_product_id, stock_quantity, cost, stock_products(name)", ids(items, "income_expense")),
      ids(items, "rubber_bill").length > 0
        ? (admin as any)
            .from("rubber_bill_items")
            .select("id, bill_id, quantity, total, stock_product_id, rubber_bills!inner(bill_date, server_bill_no, local_bill_no), stock_products(name)")
            .in("bill_id", ids(items, "rubber_bill"))
            .not("stock_product_id", "is", null)
        : Promise.resolve({ data: [], error: null }),
      (admin as any)
        .from("acid_stock_movements")
        .select("product_name, quantity_delta")
        .eq("location_id", header.location_id)
        .lte("created_at", header.cutoff_at),
      rowsByIds(admin, "time_segments", "id, profile_id, start_time, end_time", ids(items, "time_segment")),
      rowsByIds(admin, "leave_requests", "id, profile_id, start_date, end_date, type, updated_at", ids(items, "leave_request")),
      rowsByIds(admin, "financial_transactions", "id, profile_id, type, amount, description, approved_at, updated_at", ids(items, "financial_transaction")),
      rowsByIds(admin, "payroll_slips", "id, profile_id, month, gross_pay, total_deductions, net_pay, approved_at, updated_at", ids(items, "payroll_slip")),
      rowsByIds(
        admin,
        "money_transfers",
        "id, location_id, target_location_id, target_location_name, customer_name, transport_staff_name, transfer_type, transfer_status, net_amount_to_pay, branch_paid_amount, server_received_at, updated_at, created_at, money_transfer_slips(amount, fee)",
        [...ids(items, "bank_transfer_source"), ...ids(items, "bank_transfer_target")]
      ),
      result.supabase.rpc("get_report_income_expense_rows", { p_report_id: reportId }),
      result.supabase
        .from("report_batches")
        .select("id")
        .eq("location_id", header.location_id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (ledgerResult.error) throw new Error(ledgerResult.error.message);
    if (latestResult.error) throw new Error(latestResult.error.message);
    if (stockRubberResult.error) throw new Error(stockRubberResult.error.message);
    if (stockBalanceResult.error) throw new Error(stockBalanceResult.error.message);

    const profileIds = [...new Set([
      ...segments.map((row) => row.profile_id),
      ...leave.map((row) => row.profile_id),
      ...financial.map((row) => row.profile_id),
      ...payroll.map((row) => row.profile_id),
    ].filter(Boolean))];
    const profileRows = profileIds.length > 0
      ? await admin.from("profiles").select("id, name").in("id", profileIds)
      : { data: [], error: null };
    if (profileRows.error) throw new Error(profileRows.error.message);
    const profileName = new Map((profileRows.data ?? []).map((row) => [row.id, row.name]));

    const location = Array.isArray(header.locations) ? header.locations[0] : header.locations;
    const report = {
      id: header.id,
      reportNo: header.report_no,
      locationId: header.location_id,
      locationName: location?.name ?? "",
      cutoffAt: header.cutoff_at,
      status: header.status,
      createdByName: header.created_by_name,
      createdAt: header.created_at,
      deletedAt: header.deleted_at,
      itemCount: items.length,
      isLatestActive: latestResult.data?.id === header.id,
    } as ReportDetails["report"];

    const directionById = new Map<string, "out" | "in">([
      ...ids(items, "bank_transfer_source").map((id) => [id, "out" as const]),
      ...ids(items, "bank_transfer_target").map((id) => [id, "in" as const]),
    ] as Array<[string, "out" | "in"]>);

    const details: ReportDetails = {
      report,
      rubberBills: rubber.map((row) => ({
        date: datePart(row.bill_date),
        number: row.server_bill_no ?? row.local_bill_no ?? "",
        customer: row.customer_name ?? "",
        billType: row.bill_type ?? "",
        weight: number(row.weight),
        deduction: number(row.deduction_total),
        net: number(row.net_total),
        cash: number(row.cash_payment),
        transfer: number(row.transfer_payment),
      })),
      ocrTickets: ocr.map((row) => ({
        date: datePart(row.date_in),
        number: row.ticket_id ?? row.file_name ?? "",
        customer: row.customer_name ?? "",
        licensePlate: row.license_plate ?? "",
        weightIn: number(row.weight_in),
        weightOut: number(row.weight_out),
        weightNet: number(row.weight_net),
        weightDeducted: number(row.weight_deducted),
        weightRemaining: number(row.weight_remaining),
        amount: number(row.total_amount),
      })),
      incomeExpense: ((ledgerResult.data ?? []) as Array<Record<string, any>>).map((row) => ({
        date: datePart(row.tx_date),
        number: row.number ?? "",
        type: row.entry_type as "income" | "expense",
        title: row.title ?? "",
        amount: number(row.amount),
      })),
      stock: [
        ...stock.map((row) => ({
          date: datePart(row.tx_date),
          number: row.server_bill_no ?? row.transfer_bill_no ?? "",
          product: row.product_name ?? "",
          type: row.tx_type ?? "",
          quantity: number(row.quantity_delta),
          amount: number(row.amount),
        })),
        ...stockIncome
          .filter((row) => row.stock_product_id && number(row.stock_quantity) > 0)
          .map((row) => {
            const product = Array.isArray(row.stock_products) ? row.stock_products[0] : row.stock_products;
            return {
              date: datePart(row.tx_date),
              number: row.server_bill_no ?? row.local_bill_no ?? "",
              product: product?.name ?? "",
              type: "ขายสินค้า",
              quantity: -Math.abs(number(row.stock_quantity)),
              amount: number(row.cost),
            };
          }),
        ...((stockRubberResult.data ?? []) as Array<Record<string, any>>).map((row) => {
          const bill = Array.isArray(row.rubber_bills) ? row.rubber_bills[0] : row.rubber_bills;
          const product = Array.isArray(row.stock_products) ? row.stock_products[0] : row.stock_products;
          return {
            date: datePart(bill?.bill_date),
            number: bill?.server_bill_no ?? bill?.local_bill_no ?? "",
            product: product?.name ?? "",
            type: "หักจากบิลยาง",
            quantity: -Math.abs(number(row.quantity)),
            amount: number(row.total),
          };
        }),
      ],
      stockBalances: [...((stockBalanceResult.data ?? []) as Array<Record<string, any>>).reduce<Map<string, number>>(
        (balances, row) => balances.set(
          row.product_name ?? "",
          (balances.get(row.product_name ?? "") ?? 0) + number(row.quantity_delta)
        ),
        new Map<string, number>()
      )].map(([product, quantity]) => ({ product, quantity })),
      timePayroll: [
        ...segments.map((row) => ({
          date: datePart(row.end_time),
          number: `TS-${row.id.slice(0, 8)}`,
          category: "เวลาทำงาน",
          employee: profileName.get(row.profile_id) ?? "",
          detail: `${row.start_time} – ${row.end_time}`,
          quantity: Math.max(0, (new Date(row.end_time).getTime() - new Date(row.start_time).getTime()) / 3_600_000),
          amount: null,
        })),
        ...leave.map((row) => ({
          date: datePart(row.start_date),
          number: `LV-${row.id.slice(0, 8)}`,
          category: "ลา",
          employee: profileName.get(row.profile_id) ?? "",
          detail: `${row.type}: ${row.start_date} – ${row.end_date}`,
          quantity: Math.max(1, Math.floor((new Date(row.end_date).getTime() - new Date(row.start_date).getTime()) / 86_400_000) + 1),
          amount: null,
        })),
        ...financial.map((row) => ({
          date: datePart(row.approved_at ?? row.updated_at),
          number: `FT-${row.id.slice(0, 8)}`,
          category: row.type ?? "ธุรกรรมการเงิน",
          employee: profileName.get(row.profile_id) ?? "",
          detail: row.description ?? "",
          quantity: null,
          amount: number(row.amount),
        })),
        ...payroll.map((row) => ({
          date: datePart(row.approved_at ?? row.updated_at),
          number: `PS-${row.id.slice(0, 8)}`,
          category: "เงินเดือน",
          employee: profileName.get(row.profile_id) ?? "",
          detail: `${row.month} (ขั้นต้น ${number(row.gross_pay).toFixed(2)} / หัก ${number(row.total_deductions).toFixed(2)})`,
          quantity: null,
          amount: number(row.net_pay),
        })),
      ],
      bankTransfers: bank.map((row) => {
        const slips = (Array.isArray(row.money_transfer_slips) ? row.money_transfer_slips : []) as Array<Record<string, any>>;
        const direction = directionById.get(row.id) ?? "out";
        return {
          date: datePart(row.server_received_at ?? row.updated_at ?? row.created_at),
          number: `TR-${row.id.slice(0, 8)}`,
          direction,
          party: direction === "in"
            ? "สาขาต้นทาง"
            : row.target_location_name ?? row.customer_name ?? row.transport_staff_name ?? "",
          status: row.transfer_status ?? "",
          amount: number(row.net_amount_to_pay),
          slipAmount: slips.reduce((sum, slip) => sum + number(slip.amount), 0),
          fee: slips.reduce((sum, slip) => sum + number(slip.fee), 0),
          branchPaid: number(row.branch_paid_amount),
        };
      }),
    };

    return NextResponse.json(details, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return reportErrorResponse(error instanceof Error ? error.message : "โหลดรายงานไม่สำเร็จ");
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const result = await requireSystemManager(request);
  if (!result.ok) return result.response;
  const { reportId } = await context.params;
  const { data, error } = await result.supabase.rpc("delete_report_batch", {
    p_report_id: reportId,
  });
  if (error) return reportErrorResponse(error.message);
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
