import type { SlipValidationIssue } from "./slip-validation";

export function SlipValidationSummary({ issues }: { issues: SlipValidationIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div role="alert" className="rounded-md border border-clay/25 bg-clay/10 px-4 py-3 text-sm text-ink/80">
      <p className="font-bold">กรุณาตรวจข้อมูลสลิป</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {issues.map((issue, index) => <li key={`${issue.slipId}-${issue.field}-${index}`}>{issue.message}</li>)}
      </ul>
    </div>
  );
}
