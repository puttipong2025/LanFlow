import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { Toaster } from "sonner";
import { QueryProvider } from "@/components/QueryProvider";

export const metadata: Metadata = {
  title: "LanFlow",
  description: "Multi-branch rubber yard operations",
  manifest: "/manifest.json"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2f6b4f"
};

import { requireAuth } from "@/lib/server/auth";
import type { Profile } from "@/types";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const authResult = await requireAuth();
  const initialProfile: Profile | null = authResult.ok ? {
    id: authResult.auth.sub,
    phone: authResult.auth.phone,
    name: authResult.auth.name,
    role: authResult.auth.role,
    locationIds: authResult.auth.locationIds,
    isActive: true,
  } : null;

  return (
    <html lang="th">
      <body suppressHydrationWarning>
        <QueryProvider>
          <AuthProvider initialProfile={initialProfile}>
            {children}
            <Toaster position="top-center" richColors />
          </AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
