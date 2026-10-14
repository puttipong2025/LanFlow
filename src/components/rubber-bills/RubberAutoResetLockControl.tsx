export function RubberAutoResetLockControl({
  checked,
  disabled,
  canEdit,
  label,
  error,
  testId,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  canEdit: boolean;
  label: string;
  error?: string;
  testId: string;
  onChange: (checked: boolean) => void;
}) {
  const errorId = `${testId}-error`;
  return (
    <div className="mt-3">
      <label className="flex items-start gap-2 rounded-md bg-field/55 p-3">
        <input
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          checked={checked}
          className="mt-0.5 size-4 accent-river disabled:cursor-not-allowed"
          data-testid={testId}
          disabled={disabled}
          type="checkbox"
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="text-pretty text-sm text-ink">
          <span className="block font-semibold">{label}</span>
          {!canEdit && (
            <span className="mt-1 block text-xs text-ink/55">
              เฉพาะ Superadmin เท่านั้นที่เปลี่ยนสถานะนี้ได้
            </span>
          )}
        </span>
      </label>
      {error && (
        <p id={errorId} role="alert" className="mt-2 text-pretty text-sm text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function RubberAutoResetToggleControl({
  checked,
  disabled,
  canEdit,
  error,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  canEdit: boolean;
  error: string | null;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="mt-4 border-t border-black/10 pt-4">
      <label className="flex items-start gap-3 rounded-md bg-field/55 p-3">
        <input
          checked={checked}
          className="mt-0.5 size-4 accent-river disabled:cursor-not-allowed"
          disabled={disabled}
          type="checkbox"
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          <span className="block text-pretty text-sm font-semibold text-ink">
            รีเซ็ตราคายางที่กำหนดเป็น 0 ทุก 24 ชั่วโมง
          </span>
          <span className="mt-1 block text-pretty text-xs text-ink/55">
            แต่ละกลุ่มและสาขาที่ยังไม่จัดกลุ่มนับจากเวลาแก้ไขล่าสุดของตนเอง ระบบตรวจทุก 1 นาที
          </span>
          {!canEdit && (
            <span className="mt-1 block text-pretty text-xs text-ink/55">
              เฉพาะ Superadmin เท่านั้นที่เปิดหรือปิดกฎนี้ได้
            </span>
          )}
        </span>
      </label>
      {error && <p role="alert" className="mt-2 text-pretty text-sm text-rose-700">{error}</p>}
    </div>
  );
}
