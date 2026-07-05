function clearIfZero(event: React.FocusEvent<HTMLInputElement>) {
  if (parseFloat(event.currentTarget.value) === 0) {
    event.currentTarget.value = "";
  }
}

function restoreZeroIfBlank(event: React.FocusEvent<HTMLInputElement>) {
  if (event.currentTarget.value.trim() === "") {
    event.currentTarget.value = "0";
  }
}

export function NumberField({
  label,
  value,
  onChange,
  readOnly = false
}: {
  label: string;
  value: number;
  onChange?: (value: number) => void;
  readOnly?: boolean;
}) {
  const isReadOnly = readOnly || !onChange;

  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-ink/70">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        readOnly={isReadOnly}
        onFocus={(event) => {
          if (!isReadOnly) clearIfZero(event);
        }}
        onBlur={(event) => {
          if (isReadOnly) return;
          restoreZeroIfBlank(event);
          onChange?.(Number(event.currentTarget.value || 0));
        }}
        onChange={(event) => onChange?.(Number(event.target.value || 0))}
        className="focus-ring h-11 w-full rounded-md border border-black/10 bg-white px-3 read-only:bg-slate-100 read-only:text-ink/70"
      />
    </label>
  );
}
