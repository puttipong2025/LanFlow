import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type RubberBillPolicyStatus = "ready" | "loading" | "error";

export function useRubberBillPolicyGate(
  scope: string,
  isOnline: boolean,
  refreshSettings: () => Promise<{ error: unknown; data?: unknown }>,
) {
  const [state, setState] = useState<{ scope: string; status: RubberBillPolicyStatus }>({ scope, status: "ready" });
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, [scope]);

  function resetPolicy() {
    generation.current += 1;
    setState({ scope, status: "ready" });
  }

  async function refreshPolicy() {
    const attempt = ++generation.current;
    if (!isOnline) {
      setState({ scope, status: "ready" });
      return true;
    }
    setState({ scope, status: "loading" });
    try {
      const result = await refreshSettings();
      if (attempt !== generation.current) return false;
      const success = !result.error && Boolean(result.data);
      setState({ scope, status: success ? "ready" : "error" });
      return success;
    } catch {
      if (attempt === generation.current) setState({ scope, status: "error" });
      return false;
    }
  }

  async function refreshPolicyBeforeOpeningBill() {
    const success = await refreshPolicy();
    if (!success) toast.error("โหลดกติกาบิลยางล่าสุดไม่สำเร็จ");
    return success;
  }

  const policyStatus = state.scope === scope ? state.status : "error";
  return { policyStatus, refreshPolicy, resetPolicy, refreshPolicyBeforeOpeningBill };
}
