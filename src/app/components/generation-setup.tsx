import { isPdfTemplate, pdfTemplateLabels } from "@/server/pdf/pdf-templates";

// The prompt version and template a job or bid was generated with. Jobs generated before
// these were recorded show a dash.
export function GenerationSetup({
  promptName,
  promptVersion,
  pdfTemplate,
}: {
  promptName: string | null;
  promptVersion: number | null;
  pdfTemplate: string | null;
}) {
  if (!promptName && !pdfTemplate) return <span className="text-slate-400">—</span>;
  return (
    <div className="text-xs">
      <span className="block font-medium text-slate-700">
        {promptName ? `${promptName} · v${promptVersion}` : "Prompt removed"}
      </span>
      {pdfTemplate && (
        <span className="mt-1 block text-slate-500">
          {isPdfTemplate(pdfTemplate) ? pdfTemplateLabels[pdfTemplate] : pdfTemplate}
        </span>
      )}
    </div>
  );
}
