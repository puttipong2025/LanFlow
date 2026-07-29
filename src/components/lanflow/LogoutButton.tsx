"use client";

import { LogOut, WifiOff } from "lucide-react";
import { appSwal } from "@/lib/swal";

const OFFLINE_LOGOUT_MESSAGE = "ออกจากระบบได้เมื่อออนไลน์เท่านั้น";

export function LogoutButton({
  online,
  onLogout,
  className = "",
}: {
  online: boolean;
  onLogout: () => void | Promise<void>;
  className?: string;
}) {
  async function handleLogout() {
    if (!online) return;

    const result = await appSwal.fire({
      title: "ยืนยันออกจากระบบ?",
      text: "คุณต้องการออกจากบัญชีนี้หรือไม่",
      icon: "warning",
      showCancelButton: true,
      focusCancel: true,
      confirmButtonText: "ออกจากระบบ",
      cancelButtonText: "ยกเลิก",
      customClass: {
        confirmButton: "bg-danger text-white px-4 py-2 rounded-md font-bold mx-2",
        cancelButton: "bg-gray-200 text-ink px-4 py-2 rounded-md font-bold mx-2",
      },
    });

    if (!result.isConfirmed) return;
    if (!navigator.onLine) {
      await appSwal.fire({
        title: OFFLINE_LOGOUT_MESSAGE,
        icon: "warning",
        confirmButtonText: "ตกลง",
      });
      return;
    }

    try {
      await onLogout();
    } catch (error) {
      console.error("LanFlow logout failed", error);
      await appSwal.fire({
        title: "ออกจากระบบไม่สำเร็จ",
        text: "กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่",
        icon: "error",
        confirmButtonText: "ตกลง",
      });
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleLogout()}
      disabled={!online}
      title={online ? "ออกจากระบบ" : OFFLINE_LOGOUT_MESSAGE}
      aria-label={online ? "ออกจากระบบ" : OFFLINE_LOGOUT_MESSAGE}
      className={`focus-ring flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold shadow-sm transition-colors ${
        online
          ? "bg-danger text-white hover:bg-danger/90"
          : "cursor-not-allowed border border-black/5 bg-field text-ink/40 shadow-none"
      } ${className}`}
    >
      <LogOut size={16} />
      <span>ออกจากระบบ</span>
      {!online && <WifiOff size={13} />}
    </button>
  );
}
