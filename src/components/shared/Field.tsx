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

export function Field({
  label,
  name,
  type = "text",
  defaultValue,
  required,
  readOnly = false,
  placeholder
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  readOnly?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-ink/70">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={type === "number" ? defaultValue ?? "0" : defaultValue}
        required={required}
        readOnly={readOnly}
        placeholder={placeholder}
        onFocus={(event) => {
          if (type === "number" && !readOnly) clearIfZero(event);
        }}
        onBlur={(event) => {
          if (type === "number" && !readOnly) restoreZeroIfBlank(event);
        }}
        className="focus-ring h-11 w-full rounded-md border border-black/10 bg-white px-3 read-only:bg-slate-100 read-only:text-ink/75"
      />
    </label>
  );
}
