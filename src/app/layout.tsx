import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import { AppShell } from "@/app/components/app-shell";
import { themeScript } from "@/app/components/theme";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "QTS | Job application workspace",
  description:
    "Manage job applications, candidate profiles, and application documents in one workspace.",
};


export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The theme script (Light, Dark, or System by default) sets "dark" before the first paint, so the
    // class can differ from the server's.
    <html lang="en" className={`${inter.variable} dark h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">
        {/* The shell needs the signed-in user, so it streams in; until then the page background shows. */}
        <Suspense fallback={<div className="min-h-screen bg-surface" />}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}
