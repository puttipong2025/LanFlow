"use client";

import { KeyRound } from "lucide-react";
import { useState } from "react";

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
}: {
  online: boolean;
  onLogout: () => void | Promise<void>;
  className?: string;
}) {
  const [passwordOpen, setPasswordOpen] = useState(false);

  return <>
    <div className={cn("flex flex-wrap justify-end gap-2", className)}>
      <button
        type="button"
        disabled={!online}
        title={online ? "เปลี่ยนรหัสผ่านของฉัน" : "เปลี่ยนรหัสผ่านได้เมื่อออนไลน์เท่านั้น"}
        onClick={() => setPasswordOpen(true)}
        className="focus-ring inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-river/25 bg-white px-3 text-sm font-semibold text-river shadow-sm disabled:cursor-not-allowed disabled:bg-field disabled:text-ink/40 disabled:shadow-none"
      >
        <KeyRound size={16} />
        เปลี่ยนรหัสผ่าน
      </button>
      <LogoutButton online={online} onLogout={onLogout} />
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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (newPassword.length < 8) {
      setMessage({ kind: "error", text: "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร" });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ kind: "error", text: "รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน" });
      return;
    }

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
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage({
        kind: "success",
        text: data.readablePasswordAvailable === false
          ? "เปลี่ยนรหัสผ่านแล้ว แต่อาจยังแสดงรหัสผ่านปัจจุบันไม่ได้"
          : "เปลี่ยนรหัสผ่านแล้ว อุปกรณ์นี้ยังใช้งานต่อได้",
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "เปลี่ยนรหัสผ่านไม่สำเร็จ",
      });
    } finally {
      setSaving(false);
    }
  }

  return <ModalShell
    title="เปลี่ยนรหัสผ่านของฉัน"
    subtitle="อุปกรณ์นี้ใช้งานต่อ ส่วนอุปกรณ์อื่นจะออกจากระบบ"
    onClose={onClose}
    closeDisabled={saving}
    closeOnEscape
    nativeModal
    size="compact"
  >
    <form onSubmit={submit} className="space-y-4">
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
