"use client";

import { useAuthContext } from "@/components/AuthProvider";
import { LanFlowApp } from "@/components/LanFlowApp";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

export default function Home() {
  const { isAuthenticated, isLoading } = useAuthContext();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        // Prevent hard navigation to /login which causes dinosaur page
        return;
      }
      router.replace("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#2f6b4f"
      }}>
        <Loader2 className="animate-spin" size={40} />
      </div>
    );
  }

  if (!isAuthenticated) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-4 text-center">
          <h1 className="mb-4 text-2xl font-bold text-gray-800">ออฟไลน์และออกจากระบบแล้ว</h1>
          <p className="text-gray-600">กรุณาเชื่อมต่ออินเทอร์เน็ตเพื่อเข้าสู่ระบบใหม่</p>
        </div>
      );
    }
    return null;
  }

  return <LanFlowApp />;
}
