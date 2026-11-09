"use client";

import dynamic from "next/dynamic";
import { Settings } from "lucide-react";
import { useState } from "react";

import { useIncomeExpensePendingApprovalCount } from "@/hooks/useIncomeExpenseApprovals";
import { useRubberPendingApprovalCount } from "@/hooks/useRubberApprovalQueue";
import type { Location, Profile } from "@/types";

const RubberBillApprovalModal = dynamic(() => import("@/components/rubber-bills/RubberBillApprovalModal")
  .then((module) => module.RubberBillApprovalModal));
const IncomeExpenseApprovalModal = dynamic(() => import("@/components/income-expense/IncomeExpenseApprovalModal")
  .then((module) => module.IncomeExpenseApprovalModal));

export function HeaderApprovalActions({ profile, locations, locationId, online }: {
  profile: Profile;
  locations: Location[];
  locationId: string;
  online: boolean;
}) {
  const [open, setOpen] = useState<"rubber" | "incomeExpense" | null>(null);
  const rubberCount = useRubberPendingApprovalCount(profile.id, locations, online);
  const incomeExpenseCount = useIncomeExpensePendingApprovalCount(online);
  const actions = [
    { id: "rubber", label: "ตั้งค่าและอนุมัติบิลยาง", count: rubberCount },
    { id: "incomeExpense", label: "ตั้งค่าและอนุมัติรับ-จ่าย", count: incomeExpenseCount },
  ] as const;

  return (
    <>
      {actions.map(({ id, label, count }) => {
        const countUnavailable = online && count.isError;
        const pending = online && !countUnavailable ? count.data ?? 0 : 0;
        const accessibleLabel = pending > 0 ? `${label} รออนุมัติ ${pending} รายการ` : label;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setOpen(id)}
            disabled={!online}
            aria-label={accessibleLabel}
            title={countUnavailable ? "โหลดจำนวนงานรออนุมัติไม่สำเร็จ"
              : online ? accessibleLabel : `${label}ใช้ได้เมื่อออนไลน์เท่านั้น`}
            className="focus-ring flex h-10 items-center justify-center gap-2 rounded-md bg-settings px-3 text-sm font-semibold text-white hover:bg-settings/90 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Settings size={18} aria-hidden="true" />
            {label}
            {pending > 0 && (
              <span aria-hidden="true" className="min-w-5 rounded-full bg-amber px-1.5 py-0.5 text-center text-[10px] font-extrabold leading-none text-white">
                {pending > 99 ? "99+" : pending}
              </span>
            )}
          </button>
        );
      })}
      {open === "rubber" && (
        <RubberBillApprovalModal
          profile={profile}
          locationId={locationId}
          onClose={() => setOpen(null)}
        />
      )}
      {open === "incomeExpense" && (
        <IncomeExpenseApprovalModal
          canEditSettings={profile.role === "super_admin" && profile.isActive}
          initialLocationId="all"
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
