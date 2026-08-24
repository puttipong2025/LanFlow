import {
  ArrowDownUp,
  Banknote,
  CircleDollarSign,
  ClipboardList,
  Images,
  Package,
  PackageCheck,
  Printer,
  Plus,
  ShieldCheck,
  Users,
  Clock
} from "lucide-react";

export type Tab = "dashboard" | "rubber" | "rubber-evidence" | "rubber-export" | "cash" | "cash-count" | "acid-stock" | "customers" | "transport" | "money-transfer" | "reports" | "admin" | "time-tracking";

export const tabs: Array<{ id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: "dashboard", label: "ภาพรวม", icon: ClipboardList },
  { id: "rubber", label: "บิลยาง", icon: Plus },
  { id: "rubber-evidence", label: "ตรวจหลักฐาน", icon: Images },
  { id: "rubber-export", label: "ส่งออกยาง", icon: PackageCheck },
  { id: "cash", label: "รับ-จ่าย", icon: Banknote },
  { id: "acid-stock", label: "สต็อกสินค้า", icon: Package },
  { id: "customers", label: "ลูกค้า", icon: Users },
  { id: "transport", label: "ขนส่งและพนักงาน", icon: ArrowDownUp },
  { id: "money-transfer", label: "โอนเงิน", icon: ArrowDownUp },
  { id: "time-tracking", label: "เวลาและเงินเดือน", icon: Clock },
  { id: "reports", label: "รายงาน", icon: Printer },
  { id: "cash-count", label: "นับเงิน", icon: CircleDollarSign },
  { id: "admin", label: "Admin", icon: ShieldCheck }
];
