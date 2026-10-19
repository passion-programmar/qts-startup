import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QTS | Job application workspace",
  description:
    "Manage job applications, candidate profiles, and application documents in one workspace.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
