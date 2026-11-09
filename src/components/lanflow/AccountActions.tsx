"use client";

import { BellRing, KeyRound, Menu } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { LogoutButton } from "@/components/lanflow/LogoutButton";
import { ModalShell } from "@/components/shared/ModalShell";
import { authFetch } from "@/lib/auth-fetch";
import { cn } from "@/lib/cn";
import type {
  SelfPasswordChangeRequest,
  SelfPasswordChangeResponse,
} from "@/types";

export function AccountActions({
  online,
  onLogout,
  className,
  compact = false,
  onOpenTelegram,
}: {
  online: boolean;
  onLogout: () => void | Promise<void>;
  className?: string;
  compact?: boolean;
  onOpenTelegram?: () => void;
}) {
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function closeOnOutsidePress(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [menuOpen]);

  function closeMenu() {
    if (!compact) return;
    setMenuOpen(false);
    triggerRef.current?.focus();
  }

  return <>
    <div ref={menuRef} className={className}
      onBlur={(event) => {
        if (menuOpen && !event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !menuOpen) return;
        event.stopPropagation();
        closeMenu();
      }}
    >
      {compact && (
        <button
          ref={triggerRef}
          type="button"
          aria-label="เมนูบัญชี"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={() => setMenuOpen(!menuOpen)}
          className="focus-ring inline-flex size-11 items-center justify-center rounded-lg border border-mint bg-white text-ink shadow-sm hover:bg-mint/35"
        >
          <Menu size={22} aria-hidden="true" />
        </button>
      )}
      <div id={menuId} className={cn(
        compact
          ? "absolute right-0 top-full z-40 mt-2 w-48 flex-col gap-2 rounded-xl border border-mint bg-white p-2 shadow-xl"
          : "flex flex-wrap justify-end gap-2",
        compact && (menuOpen ? "flex" : "hidden"),
      )}>
        <button
          type="button"
          disabled={!online}
          title={online ? "เปลี่ยนรหัสผ่านของฉัน" : "เปลี่ยนรหัสผ่านได้เมื่อออนไลน์เท่านั้น"}
          onClick={() => { closeMenu(); setPasswordOpen(true); }}
          className="focus-ring inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-river/25 bg-white px-3 text-sm font-semibold text-river shadow-sm disabled:cursor-not-allowed disabled:bg-field disabled:text-ink/40 disabled:shadow-none"
        >
          <KeyRound size={16} aria-hidden="true" />
          เปลี่ยนรหัสผ่าน
        </button>
        {onOpenTelegram && (
          <button
            type="button"
            onClick={() => { closeMenu(); onOpenTelegram(); }}
            className="focus-ring flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-telegram px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-telegram/90"
            aria-label="ตั้งค่าการแจ้งเตือน Telegram"
          >
            <BellRing size={16} aria-hidden="true" />
            Telegram
          </button>
        )}
        <LogoutButton online={online} onLogout={onLogout} onConfirmOpen={closeMenu} />
      </div>
    </div>
    {passwordOpen && (
      <ChangePasswordModal onClose={() => setPasswordOpen(false)} />
    )}
  </>;
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const savingRef = useRef(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    setMessage(null);
    if (newPassword.length < 8) {
      setMessage({ kind: "error", text: "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร" });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ kind: "error", text: "รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน" });
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const request: SelfPasswordChangeRequest = {
        currentPassword,
        newPassword,
        confirmPassword,
      };
      const response = await authFetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const data = await response.json().catch(() => ({})) as Partial<SelfPasswordChangeResponse> & { errorMessage?: string };
      if (!response.ok || !data.success) {
        throw new Error(data.errorMessage || "เปลี่ยนรหัสผ่านไม่สำเร็จ");
      }
      window.location.assign("/login");
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "เปลี่ยนรหัสผ่านไม่สำเร็จ",
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return <ModalShell
    title="เปลี่ยนรหัสผ่านของฉัน"
    subtitle="ทุกเบราว์เซอร์ต้องเข้าสู่ระบบใหม่ และขออนุมัติใหม่หากบัญชีเปิดข้อบังคับไว้"
    onClose={onClose}
    closeDisabled={saving}
    closeOnEscape
    nativeModal
    size="compact"
  >
    <form onSubmit={submit} aria-busy={saving} className="space-y-4">
      <label className="grid gap-1 text-sm font-semibold text-ink">
        รหัสผ่านปัจจุบัน
        <input
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          className="focus-ring h-10 rounded-md border border-black/15 px-3"
          required
        />
      </label>
      <label className="grid gap-1 text-sm font-semibold text-ink">
        รหัสผ่านใหม่
        <input
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          className="focus-ring h-10 rounded-md border border-black/15 px-3"
          required
        />
      </label>
      <label className="grid gap-1 text-sm font-semibold text-ink">
        ยืนยันรหัสผ่านใหม่
        <input
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className="focus-ring h-10 rounded-md border border-black/15 px-3"
          required
        />
      </label>
      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={cn(
            "text-pretty rounded-md border p-3 text-sm font-semibold",
            message.kind === "error"
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : "border-leaf/20 bg-leaf/10 text-leaf",
          )}
        >
          {message.text}
        </p>
      )}
      <button
        type="submit"
        disabled={saving}
        className="focus-ring h-10 rounded-md bg-commit px-4 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-50"
      >
        {saving ? "กำลังเปลี่ยน..." : "ยืนยันเปลี่ยนรหัสผ่าน"}
      </button>
    </form>
  </ModalShell>;
}
