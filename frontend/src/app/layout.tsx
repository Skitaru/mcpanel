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
      <body className="min-h-full font-sans text-ink bg-void">
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: "#15161A",
              color: "#EDEEF1",
              border: "1px solid #26292F",
              fontSize: "13px",
              borderRadius: "8px",
            },
            error:   { iconTheme: { primary: "#C2605C", secondary: "#15161A" } },
            success: { iconTheme: { primary: "#4E9B7A", secondary: "#15161A" } },
          }}
        />
        <AuthGuard>{children}</AuthGuard>
      </body>
    </html>
  );
}
