import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/app/login/login-form";
import { getCurrentUser } from "@/lib/session";

export const instant = false;

export const metadata: Metadata = {
  title: "Sign in | QTS",
};

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f8f9fa] px-4 py-10">
      <section className="w-full max-w-md overflow-hidden rounded border border-[#dee2e6] bg-white shadow-sm">
        <header className="border-b border-[#dee2e6] bg-[#f8f9fa] px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded bg-[#0d6efd] text-base font-bold text-white">
              q
            </span>
            <h1 className="text-lg font-semibold text-[#212529]">
              QTS Job System
            </h1>
          </div>
        </header>
        <div className="p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-[#212529]">Sign in</h2>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
