import { toast } from "sonner";

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

function enforceDecimalInput(
  event: React.FocusEvent<HTMLInputElement>,
  onChange?: (value: number) => void
) {
  const inputElement = event.currentTarget;
  const value = inputElement.value.trim();

  if (value === "" || parseFloat(value) === 0) {
    inputElement.value = "0";
    onChange?.(0);
    return;
  }

  if (value.includes(".")) {
    const formattedValue = parseFloat(value).toFixed(2);
    inputElement.value = formattedValue;
    onChange?.(Number(formattedValue));
    return;
  }

  const isThreeOrMoreDigits = /^\d{3,}$/.test(value);
  if (isThreeOrMoreDigits) {
    toast.error("กรุณาระบุ ราคา ให้มีจุดทศนิยม");
    inputElement.focus();
    inputElement.select();
    return;
  }

  const formattedValue = parseFloat(value).toFixed(2);
  inputElement.value = formattedValue;
  onChange?.(Number(formattedValue));
}

export function InlineNumber({
  value,
  onChange,
  readOnly = false,
  decimalOnBlur = false,
  integerOnly = false,
  compact = false,
  ariaLabel,
}: {
  value: number | "";
  onChange?: (value: number) => void;
  readOnly?: boolean;
  decimalOnBlur?: boolean;
  integerOnly?: boolean;
  compact?: boolean;
  ariaLabel?: string;
}) {
  const isReadOnly = readOnly || !onChange;

  return (
    <input
      type="number"
      aria-label={ariaLabel}
      inputMode={integerOnly ? "numeric" : "decimal"}
      min={integerOnly ? 0 : undefined}
      step={integerOnly ? 1 : "any"}
      value={value === "" ? "" : Number.isFinite(value) ? value : 0}
      readOnly={isReadOnly}
      onFocus={(event) => {
        if (!isReadOnly) clearIfZero(event);
      }}
      onBlur={(event) => {
        if (isReadOnly) return;
        if (decimalOnBlur) {
          enforceDecimalInput(event, onChange);
          return;
        }
        restoreZeroIfBlank(event);
        onChange?.(Number(event.currentTarget.value || 0));
      }}
      onChange={(event) => {
        const value = integerOnly
          ? event.currentTarget.value.replace(/\D/g, "")
          : event.currentTarget.value;
        if (integerOnly && value !== event.currentTarget.value) {
          event.currentTarget.value = value;
        }
        onChange?.(Number(value || 0));
      }}
      className={
        compact
          ? "h-9 w-14 bg-transparent px-1 text-right text-base font-bold text-ink outline-none sm:w-16"
          : "focus-ring h-10 w-full rounded-md border border-black/10 bg-white px-2 read-only:bg-slate-100 read-only:text-ink/70"
      }
    />
  );
}
