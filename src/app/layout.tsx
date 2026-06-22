import type { Metadata, Viewport } from "next";
import { PwaRegister } from "@/components/PwaRegister";
import "./globals.css";

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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body suppressHydrationWarning>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
