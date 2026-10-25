import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { themeStorageKey } from "@/app/components/theme";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "QTS | Job application workspace",
  description:
    "Manage job applications, candidate profiles, and application documents in one workspace.",
};

// Dark is the default; a saved "light" choice is applied before first paint so the page never flashes.
const themeScript = `try{if(localStorage.getItem(${JSON.stringify(themeStorageKey)})==="light")document.documentElement.classList.remove("dark")}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The theme script may remove "dark" before hydration, so the class can differ from the server's.
    <html lang="en" className={`${inter.variable} dark h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
