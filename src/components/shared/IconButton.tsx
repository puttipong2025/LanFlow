export function IconButton({
  label,
  visibleLabel,
  tone,
  onClick,
  disabled = false,
  children
}: {
  label: string;
  visibleLabel?: string;
  tone: "amber" | "clay" | "danger" | "actionSecondary";
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
      className={`focus-ring inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md text-sm font-semibold text-white shadow-sm ${
        visibleLabel ? "px-3" : "w-10"
      } ${
        tone === "amber"
          ? "bg-amber hover:bg-amber/90"
          : tone === "danger"
            ? "bg-danger hover:bg-danger/90"
            : tone === "actionSecondary"
              ? "bg-actionSecondary hover:bg-actionSecondary/90"
              : "bg-clay hover:bg-clay/90"
      } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
    >
      {children}
      {visibleLabel && <span>{visibleLabel}</span>}
    </button>
  );
}
