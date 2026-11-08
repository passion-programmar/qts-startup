"use client";

import { RotateCcw, Save, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import {
  layoutChoiceSettings,
  layoutChoiceWarnings,
  layoutColorSettings,
  layoutNumberSettings,
  type LayoutNumberSetting,
} from "@/app/pdf/layout-settings";
import type { PdfTemplate } from "@/server/pdf/pdf-templates";

export type LayoutForm = Record<string, string>;

const stepButtonClass = "flex size-7 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-base font-semibold leading-none text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40";
const fieldClass ="mt-1 min-h-9 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

// The template value a number setting replaces, read from the template's own CSS (the hint shown
// in an empty field). Margins, line height and the fitting floor come from base.css / render.js.
const settingToken: Record<string, string> = {
  nameSize: "--text-name", headlineSize: "--text-headline", contactSize: "--text-contact",
  sectionSize: "--text-section", itemSize: "--text-item", bodySize: "--text-body",
  bulletSize: "--text-bullet", metaSize: "--text-meta", sectionGap: "--space-section",
  itemGap: "--space-item", titleGap: "--space-title", headerGap: "--space-header",
  bulletGap: "--space-bullet", lineHeight: "--leading-body", marginTop: "--page-margin-top",
  marginSide: "--page-margin-inline", marginBottom: "--page-margin-bottom",
};
const fixedDefaults: Record<string, string> = { minTextSize: "10.5", fontScale: "1" };

function readTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  // Only the first :root block: later blocks (compact density etc.) are not the template's normal values.
  const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  for (const match of root.matchAll(/(--[\w-]+)\s*:\s*([\d.]+)(pt|mm)?\s*;/g)) tokens.set(match[1], match[2]);
  return tokens;
}

function useTemplateDefaults(template: PdfTemplate): Record<string, string> {
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/resume-templates/css/base.css").then((response) => response.text()),
      fetch(`/resume-templates/templates/${template}.css`).then((response) => response.text()),
    ]).then(([base, own]) => {
      if (cancelled) return;
      const tokens = new Map([...readTokens(base), ...readTokens(own)]);
      setDefaults(Object.fromEntries(Object.entries(settingToken)
        .map(([key, token]) => [key, tokens.get(token) ?? ""])
        .filter(([, value]) => value)));
    }).catch(() => {
      if (!cancelled) setDefaults({});
    });
    return () => {
      cancelled = true;
    };
  }, [template]);
  return { ...fixedDefaults, ...defaults };
}

// How far one − / + click moves a setting: big enough to see, small enough to fine-tune.
function clickStep(setting: LayoutNumberSetting): number {
  if (setting.key === "lineHeight") return 0.05;
  if (setting.key === "fontScale") return 0.01;
  if (setting.unit === "mm") return 1;
  if (setting.group === "Spacing") return 1;
  return 0.5;
}

function nudged(setting: LayoutNumberSetting, current: string, direction: 1 | -1): string {
  const value = Number(current);
  const start = Number.isFinite(value) ? value : setting.min;
  const next = Math.min(setting.max, Math.max(setting.min, start + direction * clickStep(setting)));
  return String(Math.round(next * 100) / 100);
}

function numberProblem(setting: LayoutNumberSetting, raw: string | undefined): { error?: string; warning?: string } {
  const value = raw?.trim();
  if (!value) return {};
  const number = Number(value);
  if (!Number.isFinite(number) || number < setting.min || number > setting.max) {
    return { error: `Allowed: ${setting.min}–${setting.max}${setting.unit ? ` ${setting.unit}` : ""}. Ignored.` };
  }
  if (setting.warnBelow !== undefined && number < setting.warnBelow) return { warning: setting.warning };
  return {};
}

/**
 * One-time layout settings for the Resume page preview and its download. Nothing here is saved:
 * reloading the page starts from the template's values again, and Generation never reads them.
 */
// The settings that matter (non-empty), for comparing the form with the saved style.
const filled = (form: LayoutForm) => Object.fromEntries(Object.entries(form).filter(([, value]) => value !== "" && value !== undefined).sort());

export function LayoutSettingsPanel({
  form,
  message,
  onChange,
  onSave,
  savedForm,
  saving,
  template,
  templateLabel,
}: {
  form: LayoutForm;
  message: string | null;
  onChange: (next: LayoutForm) => void;
  onSave: (form: LayoutForm) => void;
  savedForm: LayoutForm;
  saving: boolean;
  template: PdfTemplate;
  templateLabel: string;
}) {
  const defaults = useTemplateDefaults(template);
  const changed = Object.keys(filled(form)).length;
  const hasSaved = Object.keys(filled(savedForm)).length > 0;
  const unsaved = JSON.stringify(filled(form)) !== JSON.stringify(filled(savedForm));
  const status = unsaved ? "· unsaved changes" : hasSaved ? "· your saved style" : "· template values";
  const set = (key: string, value: string) => onChange({ ...form, [key]: value });
  const numberGroups = ["Page fitting", "Text sizes", "Spacing", "Page margins"] as const;

  return (
    <details className="rounded-lg border border-slate-200 bg-white">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-sm font-semibold text-slate-800">
        <SlidersHorizontal aria-hidden="true" className="size-4" />
        Layout settings
        <span className={`font-normal ${unsaved ? "text-amber-700" : "text-slate-500"}`}>{status}</span>
      </summary>
      <div className="space-y-4 border-t border-slate-200 p-3">
        <p className="text-xs text-slate-600">
          Changes show in the preview and the download at once. Click <strong>Save as my style</strong> to keep them for {templateLabel}:
          your Generations with this template then use them (the page rule still runs on top). Unsaved changes are lost when you leave or switch template.
          Each setting starts at your saved value, or the template&apos;s (grey). Use − / + or drag the slider; ↺ puts one back.
        </p>
        {numberGroups.map((group) => (
          <fieldset className="space-y-2" key={group}>
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</legend>
            {group === "Page fitting" && (
              <div className="grid grid-cols-2 gap-2">
                {layoutChoiceSettings.filter((setting) => setting.group === "Page fitting").map((setting) => (
                  <label className="block text-xs text-slate-700" key={setting.key}>
                    {setting.label}
                    <select className={fieldClass} onChange={(event) => set(setting.key, event.target.value)} value={form[setting.key] ?? ""}>
                      <option value="">Template (auto)</option>
                      {setting.values.map((value) => (
                        <option key={value} value={value}>
                          {setting.key === "fitPages" ? (value === "auto" ? "Auto: one page fewer" : `${value} page${value === "1" ? "" : "s"}`) : value}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
            <div className="space-y-2.5">
              {layoutNumberSettings.filter((setting) => setting.group === group).map((setting) => {
                const own = form[setting.key] ?? "";
                const problem = numberProblem(setting, own);
                // The slider starts at the template's value; moving it sets this page's value.
                const templateValue = defaults[setting.key] ?? "";
                const shown = own || templateValue || String(setting.min);
                const id = `layout-${setting.key}`;
                return (
                  <div key={setting.key}>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <label className="text-slate-700" htmlFor={id}>{setting.label}</label>
                      <span className="flex items-center gap-1.5">
                        <span className={own ? "font-semibold text-blue-700" : "text-slate-500"}>
                          {shown}{setting.unit ? ` ${setting.unit}` : ""}{own ? "" : " · template"}
                        </span>
                        {own && (
                          <button
                            aria-label={`${setting.label}: back to the template value`}
                            className="rounded px-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                            onClick={() => set(setting.key, "")}
                            title="Back to the template value"
                            type="button"
                          >
                            ↺
                          </button>
                        )}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <button
                        aria-label={`${setting.label}: smaller`}
                        className={stepButtonClass}
                        disabled={Number(shown) <= setting.min}
                        onClick={() => set(setting.key, nudged(setting, shown, -1))}
                        type="button"
                      >
                        −
                      </button>
                      <input
                        aria-valuetext={`${shown}${setting.unit ? ` ${setting.unit}` : ""}`}
                        className={`h-2 min-w-0 flex-1 cursor-pointer ${own ? "accent-blue-600" : "accent-slate-400"}`}
                        id={id}
                        max={setting.max}
                        min={setting.min}
                        onChange={(event) => set(setting.key, event.target.value)}
                        step={setting.step}
                        type="range"
                        value={shown}
                      />
                      <button
                        aria-label={`${setting.label}: larger`}
                        className={stepButtonClass}
                        disabled={Number(shown) >= setting.max}
                        onClick={() => set(setting.key, nudged(setting, shown, 1))}
                        type="button"
                      >
                        +
                      </button>
                    </div>
                    {problem.error && <span className="block text-xs text-rose-700">{problem.error}</span>}
                    {problem.warning && <span className="block text-xs text-amber-700">{problem.warning}</span>}
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">Look</legend>
          <div className="grid grid-cols-2 gap-2">
            {layoutChoiceSettings.filter((setting) => setting.group === "Look").map((setting) => {
              const warning = form[setting.key] ? layoutChoiceWarnings[setting.key]?.[form[setting.key]] : undefined;
              return (
                <label className="block text-xs text-slate-700" key={setting.key}>
                  {setting.label}
                  <select className={fieldClass} onChange={(event) => set(setting.key, event.target.value)} value={form[setting.key] ?? ""}>
                    <option value="">Template</option>
                    {setting.values.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                  {warning && <span className="mt-0.5 block text-amber-700">{warning}</span>}
                </label>
              );
            })}
            {layoutColorSettings.map((setting) => (
              <label className="block text-xs text-slate-700" key={setting.key}>
                {setting.label}
                <span className="mt-1 flex items-center gap-2">
                  <input
                    aria-label={setting.label}
                    className="h-9 w-12 cursor-pointer rounded border border-slate-300 bg-white"
                    onChange={(event) => set(setting.key, event.target.value)}
                    type="color"
                    value={form[setting.key] || "#1f3a5f"}
                  />
                  {form[setting.key]
                    ? <button className="text-xs text-blue-700 underline" onClick={() => set(setting.key, "")} type="button">Template</button>
                    : <span className="text-slate-500">Template</span>}
                </span>
              </label>
            ))}
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                checked={form.showPageNumbers === "yes"}
                onChange={(event) => set("showPageNumbers", event.target.checked ? "yes" : "")}
                type="checkbox"
              />
              Page numbers (&quot;Page 2 of 3&quot;)
            </label>
          </div>
          {form.showPageNumbers === "yes" && (
            <p className="text-xs text-amber-700">Some ATS parsers read &quot;Page 2 of 3&quot; inside the text of the page it is printed on.</p>
          )}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={saving || !unsaved}
            onClick={() => onSave(form)}
            type="button"
          >
            <Save aria-hidden="true" className="size-4" />
            {saving ? "Saving..." : changed || !hasSaved ? `Save as my style for ${templateLabel}` : `Remove my saved style for ${templateLabel}`}
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            disabled={!changed}
            onClick={() => onChange({})}
            type="button"
          >
            <RotateCcw aria-hidden="true" className="size-4" />
            Template values
          </button>
          {hasSaved && unsaved && (
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              onClick={() => onChange(savedForm)}
              type="button"
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              Back to my saved style
            </button>
          )}
        </div>
        {message && <p className="text-xs text-slate-700" role="status">{message}</p>}
      </div>
    </details>
  );
}
