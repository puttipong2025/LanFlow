export function InlineRadio({
  name,
  value,
  label,
  defaultChecked,
  checked,
  onChange
}: {
  name: string;
  value: string;
  label: string;
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: () => void;
}) {
  const checkedProps = checked === undefined ? { defaultChecked } : { checked, onChange };

  return (
    <label className="inline-flex cursor-pointer items-center gap-1">
      <input
        type="radio"
        name={name}
        value={value}
        className="h-4 w-4 accent-blue-600"
        {...checkedProps}
      />
      <span>{label}</span>
    </label>
  );
}
