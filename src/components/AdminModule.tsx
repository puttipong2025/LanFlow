"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

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
  return dialogs.item(dialogs.length - 1) ?? document.body;
}

export function AdminModule({ locations, profile, onAddLocation }: {
  locations: Location[];
  profile: Profile;
  onAddLocation: (request: { name: string; code: string; requestId: string }) => Promise<boolean>;
}) {
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
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
      toast.error(error instanceof Error ? error.message : "โหลดรายชื่อพนักงานไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadUsers(); }, []);

  async function confirmedPatch(userId: string, path: string, body: Record<string, unknown>, title: string) {
    const confirmation = await appSwal.fire({ target: getConfirmationTarget(), title, icon: "warning", showCancelButton: true, confirmButtonText: "ยืนยัน", cancelButtonText: "ยกเลิก" });
    if (!confirmation.isConfirmed) return;
    try {
      const response = await authFetch(`/api/lanflow/admin/users/${userId}/${path}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.errorMessage || data.error || "อัปเดตไม่สำเร็จ");
      toast.success("บันทึกแล้ว");
      await loadUsers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "อัปเดตไม่สำเร็จ");
    }
  }

  async function createUser(value: { name: string; phone: string; password: string; role: "user" | "admin"; locationId: string }) {
    try {
      const response = await authFetch("/api/lanflow/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...value, locationIds: value.locationId ? [value.locationId] : [] }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.errorMessage || data.error || "สร้างบัญชีไม่สำเร็จ");
      toast.success("สร้างบัญชีผู้ใช้แล้ว");
      await loadUsers();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "สร้างบัญชีไม่สำเร็จ");
      return false;
    }
  }

  async function saveProfile(user: Profile, request: AdminUserProfileUpdateRequest) {
    try {
      const response = await authFetch(`/api/lanflow/admin/users/${user.id}/profile`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      const data = await response.json().catch(() => ({})) as Partial<AdminUserProfileUpdateResponse> & { errorMessage?: string };
      if (!response.ok || !data.user) throw new Error(data.errorMessage || "บันทึกข้อมูลพนักงานไม่สำเร็จ");
      setUsers((current) => current.map((item) => item.id === user.id ? data.user! : item));
      toast.success("บันทึกข้อมูลและสาขาแล้ว");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "บันทึกข้อมูลพนักงานไม่สำเร็จ");
      return false;
    }
  }

  async function resetPassword(user: Profile, newPassword: string, confirmPassword: string, requestId: string) {
    if (newPassword.length < 8) { toast.error("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"); return false; }
    if (newPassword !== confirmPassword) { toast.error("ยืนยันรหัสผ่านไม่ตรงกัน"); return false; }
    const confirmation = await appSwal.fire({ target: getConfirmationTarget(), title: "ยืนยันรีเซ็ตรหัสผ่าน?", text: `ผู้ใช้ ${user.name} จะต้องใช้รหัสผ่านใหม่`, icon: "warning", showCancelButton: true, confirmButtonText: "ยืนยันรีเซ็ต", cancelButtonText: "ยกเลิก" });
    if (!confirmation.isConfirmed) return false;
    try {
      const request: AdminPasswordResetRequest = { newPassword, confirmPassword, requestId };
      const response = await authFetch(`/api/lanflow/admin/users/${user.id}/password`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      const data = await response.json().catch(() => ({})) as Partial<AdminPasswordResetResponse> & { errorMessage?: string };
      if (!response.ok || !data.success) throw new Error(data.errorMessage || "รีเซ็ตรหัสผ่านไม่สำเร็จ");
      toast.success(data.auditStatus === "pending" ? "เปลี่ยนรหัสผ่านแล้ว กำลังบันทึกหลักฐาน" : "รีเซ็ตรหัสผ่านแล้ว");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "รีเซ็ตรหัสผ่านไม่สำเร็จ");
      return false;
    }
  }

  async function createLocation(value: { name: string; code: string; requestId: string }) {
    const name = value.name.trim().replace(/\s+/g, " ");
    const code = value.code.trim().toUpperCase();
    if (!name) { toast.error("กรุณากรอกชื่อสาขา"); return false; }
    if (!/^[A-Z0-9]{2,8}$/.test(code)) { toast.error("รหัสสาขาต้องเป็น A–Z หรือ 0–9 จำนวน 2–8 ตัว"); return false; }
    const confirmation = await appSwal.fire({ target: getConfirmationTarget(), title: "ยืนยันเพิ่มสาขา?", text: `${name} · ${code} — รหัสสาขาเปลี่ยนภายหลังไม่ได้`, icon: "warning", showCancelButton: true, confirmButtonText: "ยืนยันเพิ่มสาขา", cancelButtonText: "ยกเลิก" });
    return confirmation.isConfirmed ? onAddLocation({ name, code, requestId: value.requestId }) : false;
  }

  return <AdminContent
    locations={locations} users={users} loading={loading} profile={profile}
    canManageSystem={canManageSystem} canManagePermissions={canManagePermissions}
    onReload={() => void loadUsers()} onCreateUser={createUser} onCreateLocation={createLocation}
    onSaveProfile={saveProfile} onResetPassword={resetPassword}
    onToggleRole={(id, role) => void confirmedPatch(id, "role", { role: role === "admin" ? "user" : "admin" }, "เปลี่ยนบทบาท?")}
    onToggleStatus={(id, active) => void confirmedPatch(id, "status", { isActive: !active }, active ? "ระงับการใช้งาน?" : "กู้คืนการใช้งาน?")}
    onToggleSystemManager={(id, value) => void confirmedPatch(id, "system-manager-access", { canAccessSystemManager: !value }, value ? "ปิดสิทธิ์ผู้จัดการระบบ?" : "เปิดสิทธิ์ผู้จัดการระบบ?")}
    onToggleMoneyTransfer={(id, value) => void confirmedPatch(id, "money-transfer-access", { canAccessMoneyTransfer: !value }, value ? "ปิดสิทธิ์โอนเงิน?" : "เปิดสิทธิ์โอนเงิน?")}
    onToggleTimePayroll={(id, value) => void confirmedPatch(id, "time-payroll-access", { canManageTimePayroll: !value }, value ? "ปิดสิทธิ์เวลาและเงินเดือน?" : "เปิดสิทธิ์เวลาและเงินเดือน?")}
  />;
}
