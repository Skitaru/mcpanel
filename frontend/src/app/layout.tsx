import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "react-hot-toast";
import AuthGuard from "@/components/AuthGuard";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MCPanel — Minecraft Server Dashboard",
  description: "Lightweight Minecraft server management panel",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans text-gray-300">
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: "rgba(15, 15, 15, 0.95)",
              color: "#d1d5db",
              border: "1px solid rgba(255,255,255,0.06)",
              fontSize: "13px",
              backdropFilter: "blur(12px)",
            },
            error: { iconTheme: { primary: "#f87171", secondary: "#0f0f0f" } },
            success: { iconTheme: { primary: "#34d399", secondary: "#0f0f0f" } },
          }}
        />
        <AuthGuard>{children}</AuthGuard>
      </body>
    </html>
  );
}
