"use client";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { RubberWeightAlertSettings } from "./RubberWeightAlertSettings";
import type { RubberWeightAlertConfig } from "@/lib/lanflow/rubber-weight-alert";
export function ThresholdAlertSettings(props: {
  initialConfig: RubberWeightAlertConfig; onAccessDenied: () => void;
  onSaved: (config: RubberWeightAlertConfig) => void;
}) {
  const [kind, setKind] = useState<"weight" | "cash">("weight");
  return <div className="space-y-4">
    <div className="flex gap-2" aria-label="ประเภทการตั้งค่าแจ้งเตือน">
      {(["weight", "cash"] as const).map((value) => <button key={value} type="button" aria-pressed={kind === value}
        onClick={() => setKind(value)} className={cn("focus-ring min-h-11 rounded-md border px-4 text-sm font-semibold", kind === value ? "border-river bg-river text-white" : "border-black/15 bg-white text-ink")}>
        {value === "cash" ? "เงินต่ำกว่าเกณฑ์" : "น้ำหนักเกินเกณฑ์"}
      </button>)}
    </div>
    <RubberWeightAlertSettings key={kind} {...props} kind={kind} />
  </div>;
}
