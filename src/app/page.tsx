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
    return null;
  }

  return <LanFlowApp />;
}
