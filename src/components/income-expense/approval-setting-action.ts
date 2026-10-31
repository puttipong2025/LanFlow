import { useRef, useState } from "react";
import { toast } from "sonner";
import { assertApprovalSettingsOnline, ApprovalSettingsError } from "@/lib/income-expense/approval-settings-mutations";

export function useApprovalSettingAction(key: string, onPending: (key: string, value: boolean) => void) {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  async function run(action: () => Promise<unknown>, message: string) {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true); onPending(key, true); setError(null);
    try {
      assertApprovalSettingsOnline();
      await action();
      toast.success(message);
      return true;
    } catch (caught) {
      const issue = caught instanceof Error ? caught.message : "ยังยืนยันผลไม่ได้ กรุณาโหลดล่าสุดก่อนทำรายการต่อ";
      setError(issue);
      setNeedsReload(!(caught instanceof ApprovalSettingsError) || caught.uncertain || !issue.includes("ออนไลน์เท่านั้น"));
      return false;
    } finally { locked.current = false; setBusy(false); onPending(key, false); }
  }
  return { busy, error, needsReload, run, clear: () => { setError(null); setNeedsReload(false); }, setError };
}
