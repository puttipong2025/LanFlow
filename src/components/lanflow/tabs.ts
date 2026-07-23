import {
  ArrowDownUp,
  Banknote,
  ClipboardList,
  FileImage,
  Package,
  Printer,
  Plus,
  ShieldCheck,
  Users,
  Clock
} from "lucide-react";

export type Tab = "dashboard" | "rubber" | "cash" | "acid-stock" | "customers" | "transport" | "money-transfer" | "ocr" | "reports" | "admin" | "time-tracking";

export const tabs: Array<{ id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: "dashboard", label: "ภาพรวม", icon: ClipboardList },
  { id: "rubber", label: "บิลยาง", icon: Plus },
  { id: "cash", label: "รับ-จ่าย", icon: Banknote },
  { id: "acid-stock", label: "สต็อกสินค้า", icon: Package },
  { id: "customers", label: "ลูกค้า", icon: Users },
  { id: "transport", label: "ขนส่งและพนักงาน", icon: ArrowDownUp },
  { id: "money-transfer", label: "โอนเงิน", icon: ArrowDownUp },
  { id: "ocr", label: "อ่านใบชั่ง", icon: FileImage },
  { id: "time-tracking", label: "เวลาและเงินเดือน", icon: Clock },
  { id: "reports", label: "รายงาน", icon: Printer },
  { id: "admin", label: "Admin", icon: ShieldCheck }
];
