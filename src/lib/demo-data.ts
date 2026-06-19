import type { IncomeExpense, Location, Profile, RubberBill } from "@/types";

export const demoLocations: Location[] = [
  { id: "loc-lankhao", name: "ลานข้าวหอม", code: "LKH", active: true },
  { id: "loc-chanuman", name: "ชานุมาน", code: "CNM", active: true },
  { id: "loc-pakung", name: "ป่ากุงใหญ่", code: "PKY", active: true }
];

export const demoProfile: Profile = {
  id: "user-demo",
  name: "ผู้ดูแลระบบ",
  phone: "0800000000",
  role: "super_admin",
  locationIds: demoLocations.map((location) => location.id)
};

export const initialBills: RubberBill[] = [
  {
    id: "bill-demo-1",
    clientTempId: "synced-demo-1",
    localBillNo: "TEMP-LKH-DEMO-R0001",
    serverBillNo: "260618-001",
    syncStatus: "synced",
    idempotencyKey: "create:synced-demo-1",
    locationId: "loc-lankhao",
    billNo: "260618-001",
    billDate: "2026-06-18",
    customerName: "ตัวอย่าง สาขานี้จ่าย",
    customerType: "สาขานี้จ่าย",
    billType: "บิลเครื่องชั่งเล็ก",
    weight: 940,
    price: 27.5,
    deductionTotal: 180,
    netTotal: 25670,
    cashPayment: 25670,
    transferPayment: 0,
    acidPackCount: 2,
    createdByName: "ผู้ดูแลระบบ",
    createdByPhone: "0800000000",
    clientCreatedAt: "2026-06-18T02:20:00.000Z",
    serverCreatedAt: "2026-06-18T02:20:05.000Z",
    clientRecordedAt: "2026-06-18T02:20:00.000Z",
    serverReceivedAt: "2026-06-18T02:20:05.000Z",
    revisionNo: 0,
    recordStatus: "active"
  }
];

export const initialTransactions: IncomeExpense[] = [
  {
    id: "tx-demo-1",
    clientTempId: "synced-tx-demo-1",
    localBillNo: "TEMP-LKH-DEMO-C0001",
    serverBillNo: "1",
    syncStatus: "synced",
    idempotencyKey: "create:synced-tx-demo-1",
    locationId: "loc-lankhao",
    type: "income",
    number: "1",
    txDate: "2026-06-18",
    title: "รับเงินสดประจำวัน",
    cost: 80000,
    billOption: "รายรับ",
    transactionOption: "ภายในสาขานี้",
    createdByName: "ผู้ดูแลระบบ",
    createdByPhone: "0800000000",
    clientCreatedAt: "2026-06-18T02:10:00.000Z",
    serverCreatedAt: "2026-06-18T02:10:05.000Z",
    clientRecordedAt: "2026-06-18T02:10:00.000Z",
    serverReceivedAt: "2026-06-18T02:10:05.000Z",
    revisionNo: 0,
    recordStatus: "active"
  },
  {
    id: "tx-demo-2",
    clientTempId: "synced-tx-demo-2",
    localBillNo: "TEMP-LKH-DEMO-C0002",
    serverBillNo: "1",
    syncStatus: "synced",
    idempotencyKey: "create:synced-tx-demo-2",
    locationId: "loc-lankhao",
    type: "expense",
    number: "1",
    txDate: "2026-06-18",
    title: "ค่าแรงหน้าลาน",
    cost: 2500,
    billOption: "ค่าใช้จ่าย",
    transactionOption: "ภายในสาขานี้",
    createdByName: "ผู้ดูแลระบบ",
    createdByPhone: "0800000000",
    clientCreatedAt: "2026-06-18T03:15:00.000Z",
    serverCreatedAt: "2026-06-18T03:15:05.000Z",
    clientRecordedAt: "2026-06-18T03:15:00.000Z",
    serverReceivedAt: "2026-06-18T03:15:05.000Z",
    revisionNo: 0,
    recordStatus: "active"
  }
];
