import { loadSourceModule } from "./load-source-module";
import type { IncomeExpenseApprovalAppliesTo as Scope } from "../../src/types";

type Element = { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };
function find(value: unknown, predicate: (element: Element) => boolean): Element | undefined {
  if (Array.isArray(value)) return value.map(item => find(item, predicate)).find(Boolean);
  if (!value || typeof value !== "object") return;
  const element = value as Element;
  return predicate(element) ? element : find(element.props?.children, predicate);
}

export function keywordFormFixture(existingScope: Scope, desiredScope: Scope, active = true) {
  let renderingKeyword = false;
  let stateIndex = 0;
  let writes = 0;
  let issue: string | null = null;
  const module = loadSourceModule<typeof import("../../src/components/income-expense/IncomeExpenseApprovalSettings")>("src/components/income-expense/IncomeExpenseApprovalSettings.tsx", {
    react: {
      useState: (initial: unknown) => {
        const states = [" Scope ", desiredScope, "contains", "1000", null];
        return [renderingKeyword ? states[stateIndex++] : initial, () => {}];
      },
      useRef: (current: unknown) => ({ current }), useId: () => "fixture",
    },
    "@/hooks/useOnlineStatus": { useOnlineStatus: () => true },
    "@/components/shared/AlertDialog": { AlertDialog: () => null },
    "./approval-display": { appliesToLabels: {}, matchModeLabels: {}, parseOptionalAmount: (value: string) => value ? Number(value) : null, formatApprovalAmount: String },
    "./approval-setting-action": { useApprovalSettingAction: () => ({ busy: false, needsReload: false, error: null,
      setError: (value: string) => { issue = value; }, run: async (action: () => Promise<unknown>) => { await action(); return true; },
    }) },
  });
  const tree = module.IncomeExpenseApprovalSettings({ settings: undefined,
    keywords: [{ id: "7f000000-0000-4000-8000-000000000001", keyword: "scope", appliesTo: existingScope, isActive: active, matchMode: "contains", approvalMinAmount: null }],
    canEdit: true, settingsLoading: false, keywordsLoading: false, settingsError: false, keywordsError: false,
    save: async () => {}, add: async () => { writes++; }, disable: async () => {}, retrySettings: async () => undefined, retryKeywords: async () => [], onBusyChange: () => {},
  });
  const section = find(tree, element => typeof element.type === "function" && element.type.name === "KeywordRules")!;
  renderingKeyword = true;
  const child = (section.type as (props: unknown) => unknown)(section.props);
  const form = find(child, element => element.type === "form")!;
  return {
    submit: async () => { (form.props!.onSubmit as (event: unknown) => void)({ preventDefault() {} }); await Promise.resolve(); await Promise.resolve(); },
    writes: () => writes, issue: () => issue, onSubmit: form.props!.onSubmit,
  };
}
