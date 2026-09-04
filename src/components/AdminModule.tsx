"use client";

import { useEffect, useState } from "react";

import { AdminContent } from "@/components/admin/AdminContent";
import { authFetch } from "@/lib/auth-fetch";
import { canManageFeatureAccess, canManageSystemFeatures } from "@/lib/permissions";
import appSwal from "@/lib/swal";
import type {
  AdminPasswordResetRequest,
  AdminPasswordResetResponse,
  AdminUserProfileUpdateRequest,
  AdminUserProfileUpdateResponse,
  Location,
  Profile,
} from "@/types";

function getConfirmationTarget() {
  const dialogs = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
  const dialog = dialogs.item(dialogs.length - 1);
  return dialog?.firstElementChild instanceof HTMLElement
    ? dialog.firstElementChild
    : document.body;
}

function showAdminFeedback(kind: "success" | "error", message: string, target?: HTMLElement) {
  void appSwal.fire({
    target: target ?? getConfirmationTarget(),
    toast: true,
    position: "top-end",
    icon: kind,
    title: message,
    timer: 3000,
    timerProgressBar: true,
    showConfirmButton: false,
  });
}

export function AdminModule({ locations, profile, onAddLocation }: {
  locations: Location[];
  profile: Profile;
  onAddLocation: (request: { name: string; code: string; requestId: string }) => Promise<boolean>;
}) {
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const canManageSystem = canManageSystemFeatures(profile);
  const canManagePermissions = canManageFeatureAccess(profile);

  async function loadUsers() {
    setLoading(true);
    try {
      const response = await authFetch("/api/lanflow/admin/users");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.errorMessage || "โหลดรายชื่อพนักงานไม่สำเร็จ");
      setUsers(data.users ?? []);
    } catch (error) {
      showAdminFeedback("error", error instanceof Error ? error.message : "โหลดรายชื่อพนักงานไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadUsers(); }, []);

  async function confirmedPatch(
    userId: string,
    path: string,
    body: Record<string, unknown>,
    title: string,
    getProfilePatch: (data: Record<string, unknown>) => Partial<Profile>,
  ) {
    const confirmation = await appSwal.fire({ target: getConfirmationTarget(), title, icon: "warning", showCancelButton: true, confirmButtonText: "ยืนยัน", cancelButtonText: "ยกเลิก" });
    if (!confirmation.isConfirmed) return;
    setUpdatingUserId(userId);
    try {
      const response = await authFetch(`/api/lanflow/admin/users/${userId}/${path}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) {
        const message = typeof data.errorMessage === "string"
          ? data.errorMessage
          : typeof data.error === "string" ? data.error : "อัปเดตไม่สำเร็จ";
        throw new Error(message);
      }
      const profilePatch = getProfilePatch(data);
      setUsers((current) => current.map((user) => user.id === userId ? { ...user, ...profilePatch } : user));
      showAdminFeedback("success", "บันทึกแล้ว");
    } catch (error) {
      showAdminFeedback("error", error instanceof Error ? error.message : "อัปเดตไม่สำเร็จ");
    } finally {
      setUpdatingUserId((current) => current === userId ? null : current);
    }
  }

  async function createUser(value: { name: string; phone: string; password: string; role: "user" | "admin"; locationId: string }) {
    try {
      const response = await authFetch("/api/lanflow/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...value, locationIds: value.locationId ? [value.locationId] : [] }) });
      const data = await response.json().catch(() => ({})) as { user?: Profile; errorMessage?: string; error?: string };
      if (!response.ok || !data.user) throw new Error(data.errorMessage || data.error || "สร้างบัญชีไม่สำเร็จ");
      setUsers((current) => current.some((user) => user.id === data.user!.id)
        ? current.map((user) => user.id === data.user!.id ? data.user! : user)
        : [...current, data.user!]);
      showAdminFeedback("success", "สร้างบัญชีผู้ใช้แล้ว", document.body);
      return true;
    } catch (error) {
      showAdminFeedback("error", error instanceof Error ? error.message : "สร้างบัญชีไม่สำเร็จ");
      return false;
    }
  }

  async function saveProfile(user: Profile, request: AdminUserProfileUpdateRequest) {
    try {
      const response = await authFetch(`/api/lanflow/admin/users/${user.id}/profile`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      const data = await response.json().catch(() => ({})) as Partial<AdminUserProfileUpdateResponse> & { errorMessage?: string };
      if (!response.ok || !data.user) throw new Error(data.errorMessage || "บันทึกข้อมูลพนักงานไม่สำเร็จ");
      setUsers((current) => current.map((item) => item.id === user.id ? data.user! : item));
      showAdminFeedback("success", "บันทึกข้อมูลและสาขาแล้ว");
      return true;
    } catch (error) {
      showAdminFeedback("error", error instanceof Error ? error.message : "บันทึกข้อมูลพนักงานไม่สำเร็จ");
      return false;
    }
  }

  async function resetPassword(user: Profile, newPassword: string, confirmPassword: string, requestId: string) {
    if (newPassword.length < 8) { showAdminFeedback("error", "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"); return false; }
    if (newPassword !== confirmPassword) { showAdminFeedback("error", "ยืนยันรหัสผ่านไม่ตรงกัน"); return false; }
    const confirmation = await appSwal.fire({ target: getConfirmationTarget(), title: "ยืนยันรีเซ็ตรหัสผ่าน?", text: `ผู้ใช้ ${user.name} จะต้องใช้รหัสผ่านใหม่`, icon: "warning", showCancelButton: true, confirmButtonText: "ยืนยันรีเซ็ต", cancelButtonText: "ยกเลิก" });
    if (!confirmation.isConfirmed) return false;
    try {
      const request: AdminPasswordResetRequest = { newPassword, confirmPassword, requestId };
      const response = await authFetch(`/api/lanflow/admin/users/${user.id}/password`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      const data = await response.json().catch(() => ({})) as Partial<AdminPasswordResetResponse> & { errorMessage?: string };
      if (!response.ok || !data.success) throw new Error(data.errorMessage || "รีเซ็ตรหัสผ่านไม่สำเร็จ");
      const message = data.readablePasswordAvailable === false
        ? "รีเซ็ตรหัสผ่านแล้ว แต่ข้อมูลเปิดดูยังไม่พร้อม"
        : data.auditStatus === "pending"
          ? "เปลี่ยนรหัสผ่านแล้ว กำลังบันทึกหลักฐาน"
          : "รีเซ็ตรหัสผ่านแล้ว";
      showAdminFeedback("success", message);
      return true;
    } catch (error) {
      showAdminFeedback("error", error instanceof Error ? error.message : "รีเซ็ตรหัสผ่านไม่สำเร็จ");
      return false;
    }
  }

  async function createLocation(value: { name: string; code: string; requestId: string }) {
    const name = value.name.trim().replace(/\s+/g, " ");
    const code = value.code.trim().toUpperCase();
    if (!name) { showAdminFeedback("error", "กรุณากรอกชื่อสาขา"); return false; }
    if (!/^[A-Z0-9]{2,8}$/.test(code)) { showAdminFeedback("error", "รหัสสาขาต้องเป็น A–Z หรือ 0–9 จำนวน 2–8 ตัว"); return false; }
    const confirmation = await appSwal.fire({ target: getConfirmationTarget(), title: "ยืนยันเพิ่มสาขา?", text: `${name} · ${code} — รหัสสาขาเปลี่ยนภายหลังไม่ได้`, icon: "warning", showCancelButton: true, confirmButtonText: "ยืนยันเพิ่มสาขา", cancelButtonText: "ยกเลิก" });
    if (!confirmation.isConfirmed) return false;
    const created = await onAddLocation({ name, code, requestId: value.requestId });
    showAdminFeedback(created ? "success" : "error", created
      ? "เพิ่มสาขาแล้ว · ตั้งค่าเกณฑ์ผ่านปุ่ม Telegram เพื่อเริ่ม Dashboard alert"
      : "เพิ่มสาขาไม่สำเร็จ", created ? document.body : undefined);
    return created;
  }

  async function loadCurrentPassword(userId: string) {
    const response = await authFetch(`/api/lanflow/admin/users/${userId}/password`, {
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({})) as {
      available?: boolean;
      password?: string;
      errorMessage?: string;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(data.errorMessage || data.error || "โหลดรหัสผ่านปัจจุบันไม่สำเร็จ");
    }
    return data.available === true && typeof data.password === "string"
      ? { available: true as const, password: data.password }
      : { available: false as const };
  }

  return <AdminContent
    locations={locations} users={users} loading={loading} updatingUserId={updatingUserId} profile={profile}
    canManageSystem={canManageSystem} canManagePermissions={canManagePermissions}
    onCreateUser={createUser} onCreateLocation={createLocation}
    onSaveProfile={saveProfile} onResetPassword={resetPassword} onLoadCurrentPassword={loadCurrentPassword}
    onToggleRole={(id, role) => {
      const nextRole = role === "admin" ? "user" : "admin";
      void confirmedPatch(id, "role", { role: nextRole }, "เปลี่ยนบทบาท?", () => nextRole === "user"
        ? { role: nextRole, canAccessSystemManager: false, canAccessMoneyTransfer: false, canManageTimePayroll: false }
        : { role: nextRole });
    }}
    onToggleStatus={(id, active) => void confirmedPatch(id, "status", { isActive: !active }, active ? "ระงับการใช้งาน?" : "กู้คืนการใช้งาน?", () => ({ isActive: !active }))}
    onToggleSystemManager={(id, value) => void confirmedPatch(id, "system-manager-access", { canAccessSystemManager: !value }, value ? "ปิดสิทธิ์ผู้จัดการระบบ?" : "เปิดสิทธิ์ผู้จัดการระบบ?", (data) => ({
      canAccessSystemManager: data.canAccessSystemManager === true,
      canAccessMoneyTransfer: data.canAccessMoneyTransfer === true,
      canManageTimePayroll: data.canManageTimePayroll === true,
    }))}
    onToggleMoneyTransfer={(id, value) => void confirmedPatch(id, "money-transfer-access", { canAccessMoneyTransfer: !value }, value ? "ปิดสิทธิ์โอนเงิน?" : "เปิดสิทธิ์โอนเงิน?", () => ({ canAccessMoneyTransfer: !value }))}
    onToggleTimePayroll={(id, value) => void confirmedPatch(id, "time-payroll-access", { canManageTimePayroll: !value }, value ? "ปิดสิทธิ์เวลาและเงินเดือน?" : "เปิดสิทธิ์เวลาและเงินเดือน?", () => ({ canManageTimePayroll: !value }))}
  />;
}
