"use client";
import { useActionState } from "react";
import { X } from "lucide-react";
import { Button } from "@/app/ui/button";
import { alternativesOf, MAX_ALTERNATIVES, MAX_FORM_LENGTH, siteFormsOf } from "@/server/apply/answer-variant-forms";
import type { AnswerVariant } from "@/server/apply/manager-answer-values";
import { manageAnswerForms } from "./answer-form-actions";

/** Under one saved answer: its other forms ("30 days" for "1 month") and what each job site took. */
export function AnswerForms({ id, version, variants }: { id: string; version: string; variants: AnswerVariant[] }) {
  const [state, action, pending] = useActionState(manageAnswerForms, { message: "" });
  const alternatives = alternativesOf(variants);
  const sites = siteFormsOf(variants);
  const hidden = <><input type="hidden" name="id" value={id} /><input type="hidden" name="version" value={version} /></>;
  return <div className="space-y-2 border-t border-slate-100 pt-2 text-xs">
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-medium text-slate-600">Other forms</span>
      {alternatives.map((text) => <form key={text} action={action} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-2 pr-1 text-slate-700">
        {hidden}<input type="hidden" name="text" value={text} />
        <span>{text}</span>
        <button name="action" value="alternative-remove" disabled={pending} aria-label={`Remove ${text}`} title="Remove" className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-rose-600"><X aria-hidden="true" className="size-3" /></button>
      </form>)}
      {alternatives.length < MAX_ALTERNATIVES && <form action={action} className="inline-flex items-center gap-1">
        {hidden}
        <input aria-label="Other form" name="text" required maxLength={MAX_FORM_LENGTH} placeholder="e.g. 30 days" className="h-8 w-36 rounded-lg border border-slate-200 px-2" />
        <Button type="submit" name="action" value="alternative-add" variant="secondary" size="sm" disabled={pending}>Add</Button>
      </form>}
    </div>
    {sites.length > 0 && <div className="space-y-1">
      <span className="font-medium text-slate-600">Per site</span>
      {sites.map((form) => <form key={`${form.site}|${form.kind}|${form.answer}`} action={action} className="flex flex-wrap items-center gap-1.5">
        {hidden}<input type="hidden" name="site" value={form.site} /><input type="hidden" name="kind" value={form.kind} />
        <span className="text-slate-600" title={`${form.site} (${form.kind})`}>{form.site} →</span>
        <input aria-label={`Answer for ${form.site}`} name="text" required maxLength={MAX_FORM_LENGTH} defaultValue={form.answer} className="h-8 min-w-32 flex-1 rounded-lg border border-slate-200 px-2" />
        <Button type="submit" name="action" value="site-edit" variant="secondary" size="sm" disabled={pending}>Save</Button>
        <Button type="submit" name="action" value="site-delete" variant="dangerSoft" size="sm" disabled={pending} formNoValidate>Delete</Button>
      </form>)}
    </div>}
    {state.message && <p role="status" className={`rounded-lg p-2 ${/^(Saved|Removed)/.test(state.message) ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{state.message}</p>}
  </div>;
}
