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
      <body className="min-h-full font-sans text-slate-300 bg-[#0a0c10]">
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: "#0f1119",
              color: "#cbd5e1",
              border: "1px solid #1a1f2e",
              fontSize: "13px",
              borderRadius: "8px",
            },
            error:   { iconTheme: { primary: "#f87171", secondary: "#0f1119" } },
            success: { iconTheme: { primary: "#34d399", secondary: "#0f1119" } },
          }}
        />
        <AuthGuard>{children}</AuthGuard>
      </body>
    </html>
  );
}
