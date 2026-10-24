import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Resume",
};

export default function ResumeTemplatePage() {
  return (
    <main className="h-dvh w-full overflow-hidden bg-white">
      <iframe
        className="block h-full w-full border-0"
        src="/resume-templates/resume.html"
        title="Resume"
      />
    </main>
  );
}
