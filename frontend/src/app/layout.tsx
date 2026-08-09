import type { Metadata } from "next";
import { Outfit, JetBrains_Mono } from "next/font/google";
import { Toaster } from "react-hot-toast";
import AuthGuard from "@/components/AuthGuard";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Obsidian Panel — Minecraft Server Dashboard",
  description: "Lightweight Minecraft server management panel",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans text-[#F8F7FF] bg-[#0B0914]">
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: "#151221",
              color: "#F8F7FF",
              border: "1px solid #28223D",
              fontSize: "13px",
              borderRadius: "8px",
            },
            error:   { iconTheme: { primary: "#F15BB5", secondary: "#151221" } },
            success: { iconTheme: { primary: "#00F5D4", secondary: "#151221" } },
          }}
        />
        <AuthGuard>{children}</AuthGuard>
      </body>
    </html>
  );
}
