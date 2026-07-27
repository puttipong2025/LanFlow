export function IconButton({
  label,
  tone,
  onClick,
  disabled = false,
  children
}: {
  label: string;
  tone: "amber" | "clay";
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`focus-ring inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-white ${
        tone === "amber" ? "bg-amber" : "bg-clay"
      } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
    >
      {children}
    </button>
  );
}
