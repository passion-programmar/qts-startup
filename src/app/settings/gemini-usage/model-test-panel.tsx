"use client";

import { useEffect, useRef, useState } from "react";
import { LoadingIcon } from "@/app/components/loading-icon";
import {
  describeModelTestCell,
  formatPacificTime,
  maxModelTestKeys,
  maxModelTestTextLength,
  modelTestLiteWarningCalls,
  modelTestModels,
  nextModelTestStep,
  parseModelTestSettings,
  summarizeModelTestRun,
  type ModelTestKeyState,
  type ModelTestModelId,
  type ModelTestRun,
  type ModelTestSettings,
} from "@/server/gemini/model-test";
import type { AiProvider } from "@/server/gemini/ai-models";

export type ModelTestKeyOption = { number: number; keyId: string; prefix: string; provider: AiProvider };

const keyName = (key: ModelTestKeyOption) => (key.provider === "groq" ? `Groq ${key.number}` : `Key ${key.number}`);

type Draft = {
  enabled: Record<ModelTestModelId, boolean>;
  maxCalls: Record<ModelTestModelId, string>;
  callsPerMinute: string;
  failures: string;
  testText: string;
};

type Message = { tone: "error" | "info" | "success"; text: string };

const roundErrorsBeforeStopping = 3;
const staggerMs = 150;

function toDraft(settings: ModelTestSettings): Draft {
  const enabled = {} as Draft["enabled"];
  const maxCalls = {} as Draft["maxCalls"];
  for (const { id } of modelTestModels) {
    enabled[id] = settings.models[id].enabled;
    maxCalls[id] = String(settings.models[id].maxCalls);
  }
  return {
    enabled,
    maxCalls,
    callsPerMinute: String(settings.callsPerMinute),
    failures: String(settings.failuresBeforeNextModel),
    testText: settings.testText,
  };
}

function draftToSettings(draft: Draft): ModelTestSettings | null {
  return parseModelTestSettings({
    models: Object.fromEntries(
      modelTestModels.map(({ id }) => [id, { enabled: draft.enabled[id], maxCalls: draft.maxCalls[id] }]),
    ),
    callsPerMinute: draft.callsPerMinute,
    failuresBeforeNextModel: draft.failures,
    testText: draft.testText,
  });
}

class RequestFailed extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message);
  }
}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/admin/gemini-model-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
  if (!response.ok || !data) throw new RequestFailed(data?.error ?? "The test request failed.", data?.code ?? null);
  return data as T;
}

const clock = () => Date.now();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

export function ModelTestPanel({
  enabled,
  keys,
  initialSettings,
  initialRun,
  serverNow,
}: {
  enabled: boolean;
  keys: ModelTestKeyOption[];
  initialSettings: ModelTestSettings;
  initialRun: ModelTestRun | null;
  serverNow: number;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [draft, setDraft] = useState(() => toDraft(initialSettings));
  const [run, setRun] = useState(initialRun);
  const [selected, setSelected] = useState<string[]>(() => {
    const fromRun = keys.filter((key) => initialRun?.selectedKeyIds.includes(key.keyId)).map((key) => key.keyId);
    return fromRun.length ? fromRun : keys.filter((key) => key.provider === "gemini").slice(0, maxModelTestKeys).map((key) => key.keyId);
  });
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(serverNow);
  const [message, setMessage] = useState<Message | null>(null);
  const stopRequested = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      clearInterval(timer);
      stopRequested.current = true;
    };
  }, []);

  const parsedDraft = draftToSettings(draft);
  const unsaved = !parsedDraft || JSON.stringify(parsedDraft) !== JSON.stringify(settings);
  const busy = running || saving;
  const canStart = enabled && !busy && !unsaved && selected.length > 0;
  const liteCalls = Number(draft.maxCalls["gemini-3.5-flash-lite"]);

  function setCap(id: ModelTestModelId, value: string) {
    setDraft((current) => ({ ...current, maxCalls: { ...current.maxCalls, [id]: value } }));
  }

  function toggleModel(id: ModelTestModelId, checked: boolean) {
    setDraft((current) => ({ ...current, enabled: { ...current.enabled, [id]: checked } }));
  }

  function toggleKey(keyId: string, checked: boolean) {
    setSelected((current) => (checked ? [...current, keyId] : current.filter((item) => item !== keyId)));
  }

  const selectedKeys = keys.filter((key) => selected.includes(key.keyId));
  const tickedFor = (provider: AiProvider) => selectedKeys.filter((key) => key.provider === provider).length;

  async function changeSettings(body: Record<string, unknown>, done: string) {
    setSaving(true);
    setMessage(null);
    try {
      const reply = await post<{ settings: ModelTestSettings }>(body);
      setSettings(reply.settings);
      setDraft(toDraft(reply.settings));
      setMessage({ tone: "success", text: done });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The settings could not be saved." });
    } finally {
      setSaving(false);
    }
  }

  async function resetCounts() {
    if (!window.confirm("Clear the saved test counts? Google's own quota does not reset, so a new run today may hit its limits at once.")) return;
    setSaving(true);
    setMessage(null);
    try {
      await post({ action: "reset_counts" });
      setRun(null);
      setMessage({ tone: "success", text: "Test counts were cleared. Google's own quota resets only at midnight Pacific." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The counts could not be cleared." });
    } finally {
      setSaving(false);
    }
  }

  async function start() {
    stopRequested.current = false;
    setRunning(true);
    setMessage({ tone: "info", text: "Test running. Keep this tab open." });
    let roundErrors = 0;
    try {
      const numbersFor = (provider: AiProvider) => selectedKeys.filter((key) => key.provider === provider).map((key) => key.number);
      const started = await post<{ run: ModelTestRun }>({ action: "start", keyNumbers: numbersFor("gemini"), groqKeyNumbers: numbersFor("groq") });
      let current = started.run;
      setRun(current);
      const roundMs = 60_000 / settings.callsPerMinute;

      while (!stopRequested.current) {
        const roundStartedAt = clock();
        const results = await Promise.allSettled(
          shuffled(selectedKeys).map(async (key, index) => {
            await sleep(index * staggerMs);
            return post<{ keyId: string; key: ModelTestKeyState; done: boolean }>({
              action: "call",
              runId: current.runId,
              keyNumber: key.number,
              provider: key.provider,
            });
          }),
        );

        let finished = 0;
        for (const result of results) {
          if (result.status !== "fulfilled") continue;
          current = { ...current, keys: { ...current.keys, [result.value.keyId]: result.value.key } };
          if (result.value.done) finished += 1;
        }
        setRun(current);
        setNow(clock());

        const failed = results.filter((result) => result.status === "rejected");
        const conflict = failed
          .map((result) => (result as PromiseRejectedResult).reason)
          .find((reason) => reason instanceof RequestFailed && reason.code !== null) as RequestFailed | undefined;
        if (conflict) {
          setMessage({ tone: "error", text: conflict.message });
          return;
        }
        roundErrors = failed.length ? roundErrors + 1 : 0;
        if (roundErrors >= roundErrorsBeforeStopping) {
          setMessage({ tone: "error", text: "The test stopped after repeated request errors. The counts are saved, so press Start to continue." });
          return;
        }
        if (finished === selectedKeys.length) {
          setMessage({ tone: "success", text: "Test finished. Every ticked key has finished every ticked model." });
          return;
        }

        const wakeAt = roundStartedAt + roundMs;
        while (!stopRequested.current && clock() < wakeAt) await sleep(Math.min(250, wakeAt - clock()));
      }
      setMessage({ tone: "info", text: "Test stopped. The counts are saved, so press Start to continue." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The test could not start." });
    } finally {
      setRunning(false);
    }
  }

  const runKeys = run ? keys.filter((key) => run.selectedKeyIds.includes(key.keyId)) : [];
  const providerByKeyId = new Map(keys.map((key) => [key.keyId, key.provider]));
  const summary = run
    ? summarizeModelTestRun(run, runKeys.map((key) => key.keyId), settings, (keyId) => providerByKeyId.get(keyId) ?? "gemini")
    : null;

  return (
    <div className="space-y-6">
      {!enabled ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
          This test only runs on the Production deployment, so API keys are never called from a local run.
        </p>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-sm font-semibold text-slate-800">Test settings</h2>
        <p className="mt-1 text-xs text-slate-500">
          These limits are only for this test. Its calls do count toward each key and model&apos;s usage for the day, so a big test leaves less for live work.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {modelTestModels.map((model) => (
            <div className="rounded-xl border border-slate-200 p-3" key={model.id}>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <input
                  checked={draft.enabled[model.id]}
                  className="accent-indigo-600"
                  disabled={busy}
                  onChange={(event) => toggleModel(model.id, event.target.checked)}
                  type="checkbox"
                />
                {model.label}
              </label>
              <label className="mt-3 block text-xs font-semibold text-slate-700" htmlFor={`model-test-cap-${model.id}`}>
                Max calls per key
              </label>
              <input
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm tabular-nums outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                disabled={busy}
                id={`model-test-cap-${model.id}`}
                min={1}
                onChange={(event) => setCap(model.id, event.target.value)}
                type="number"
                value={draft.maxCalls[model.id]}
              />
            </div>
          ))}
        </div>

        {liteCalls > modelTestLiteWarningCalls ? (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="alert">
            Live Get JD and Apply use 3.5 Flash-Lite. A high cap could use up Google&apos;s quota on that key, leaving it unavailable for live work until midnight Pacific.
          </p>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <NumberField
            disabled={busy}
            id="model-test-calls-per-minute"
            label="Calls per minute per key"
            onChange={(value) => setDraft((current) => ({ ...current, callsPerMinute: value }))}
            value={draft.callsPerMinute}
          />
          <NumberField
            disabled={busy}
            id="model-test-failures"
            label="Move to next model after this many failures in a row"
            onChange={(value) => setDraft((current) => ({ ...current, failures: value }))}
            value={draft.failures}
          />
        </div>

        <label className="mt-4 block text-xs font-semibold text-slate-700" htmlFor="model-test-text">
          Test text
        </label>
        <textarea
          className="mt-1 min-h-24 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
          disabled={busy}
          id="model-test-text"
          maxLength={maxModelTestTextLength}
          onChange={(event) => setDraft((current) => ({ ...current, testText: event.target.value }))}
          value={draft.testText}
        />
        <p className="mt-1 text-xs text-slate-500">
          A short text is enough, because limits count calls. It goes to Google and stays saved here, so keep out candidates&apos; personal details.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!enabled || busy || !parsedDraft || !unsaved}
            onClick={() => changeSettings({ action: "save_settings", settings: parsedDraft }, "Test settings were saved.")}
            type="button"
          >
            Save
          </button>
          <button
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!enabled || busy}
            onClick={() => changeSettings({ action: "reset_settings" }, "Test settings are back to the defaults.")}
            type="button"
          >
            Reset to defaults
          </button>
          {!parsedDraft ? (
            <span className="text-xs text-rose-700">Tick a model, use whole numbers in range, and keep the test text.</span>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-sm font-semibold text-slate-800">Run</h2>
        <p className="mt-1 text-xs text-slate-500">
          Tick up to {maxModelTestKeys} Gemini keys and {maxModelTestKeys} Groq keys, then press Start once. Each round calls every ticked key once, in random order. The test stops by itself when every ticked key has finished every ticked model. Keep this tab open.
        </p>

        {keys.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No Gemini or Groq API keys are configured on the server.</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {keys.map((key) => (
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm" key={key.keyId}>
                <input
                  checked={selected.includes(key.keyId)}
                  className="accent-indigo-600"
                  disabled={busy || (!selected.includes(key.keyId) && tickedFor(key.provider) >= maxModelTestKeys)}
                  onChange={(event) => toggleKey(key.keyId, event.target.checked)}
                  type="checkbox"
                />
                <span className="font-semibold">{keyName(key)}</span>
                <span className="font-mono text-xs text-slate-500">{key.prefix}</span>
              </label>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!canStart}
            onClick={start}
            type="button"
          >
            {running ? <LoadingIcon className="size-4" /> : null}
            {running ? "Running..." : "Start"}
          </button>
          <button
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!running}
            onClick={() => {
              stopRequested.current = true;
            }}
            type="button"
          >
            Stop
          </button>
          <button
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!enabled || busy || !run}
            onClick={resetCounts}
            type="button"
          >
            Reset counts
          </button>
          {unsaved && parsedDraft ? <span className="text-xs text-amber-700">Save your settings before starting.</span> : null}
        </div>

        <p className="mt-2 text-xs text-slate-500">
          Reset counts only clears the numbers here. Google&apos;s own quota resets at midnight Pacific.
        </p>

        {message ? (
          <p
            aria-live="polite"
            className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
              message.tone === "error"
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : message.tone === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-indigo-200 bg-indigo-50 text-indigo-700"
            }`}
            role={message.tone === "error" ? "alert" : "status"}
          >
            {message.text}
          </p>
        ) : null}
      </section>

      {run && runKeys.length ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-sm font-semibold text-slate-800">Result</h2>
          <p className="mt-1 text-xs text-slate-500">
            Times are Pacific. Until Google states a limit, &quot;about&quot; numbers come from other developers&apos; reports. Status is from the last test call. Each call also appears on the Google responses tab.
          </p>

          <div className="mt-4 space-y-5">
            {runKeys.map((key) => (
              <KeyResult key={key.keyId} now={now} option={key} settings={settings} state={run.keys[key.keyId]} />
            ))}
          </div>

          {summary ? (
            <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
              Total available per day across these keys: {summary.exact ? "" : "at least "}
              {summary.total.toLocaleString()}
            </p>
          ) : null}

          <Timeline keys={runKeys} run={run} />
        </section>
      ) : null}
    </div>
  );
}

function NumberField({
  disabled,
  id,
  label,
  onChange,
  value,
}: {
  disabled: boolean;
  id: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700" htmlFor={id}>
        {label}
      </label>
      <input
        className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm tabular-nums outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        disabled={disabled}
        id={id}
        min={1}
        onChange={(event) => onChange(event.target.value)}
        type="number"
        value={value}
      />
    </div>
  );
}

function KeyResult({
  now,
  option,
  settings,
  state,
}: {
  now: number;
  option: ModelTestKeyOption;
  settings: ModelTestSettings;
  state: ModelTestKeyState | undefined;
}) {
  if (!state) return null;
  const step = nextModelTestStep(settings, state, now, option.provider);
  const stepLabel =
    step.kind === "done"
      ? "Finished"
      : `${step.kind === "wait" ? "Waiting on" : "Next"}: ${modelTestModels.find((model) => model.id === step.model)?.label}`;
  const rows = modelTestModels.filter((model) => model.provider === option.provider && (settings.models[model.id].enabled || state.models[model.id]));

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold text-slate-800">{keyName(option)}</h3>
        <span className="font-mono text-xs text-slate-500">{option.prefix}</span>
        <span className="text-xs text-slate-500">{stepLabel}</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[56rem] text-left text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              {["Model", "Worked", "Failed", "Limit", "Left", "Status", "Since", "Available again", "Valid JSON", "Last reply"].map((label) => (
                <th className="px-3 py-2 font-semibold" key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((model) => {
              const view = describeModelTestCell(model, state.models[model.id], settings.models[model.id].maxCalls, now);
              return (
                <tr key={model.id}>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold text-slate-800" scope="row">
                    {model.label}
                  </th>
                  <td className="px-3 py-2 tabular-nums">{view.worked}</td>
                  <td className="px-3 py-2 tabular-nums">{view.failed}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{view.limit}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{view.left}</td>
                  <td className="px-3 py-2" title={view.detail ?? undefined}>
                    <span
                      className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 font-medium ${
                        view.status === "Available"
                          ? "bg-emerald-50 text-emerald-700"
                          : view.status === "Not available"
                            ? "bg-rose-50 text-rose-700"
                            : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {view.status}
                    </span>
                    <div className="mt-1 text-slate-500">{view.reason}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{view.since}</td>
                  <td className="px-3 py-2">{view.availableAgain}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{view.validJson}</td>
                  <td className="px-3 py-2 text-slate-500">{view.lastReply}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Timeline({ keys, run }: { keys: ModelTestKeyOption[]; run: ModelTestRun }) {
  const events = keys
    .flatMap((key) => (run.keys[key.keyId]?.timeline ?? []).map((event) => ({ ...event, keyLabel: keyName(key) })))
    .sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div className="mt-5">
      <h3 className="text-sm font-semibold text-slate-800">Timeline</h3>
      <p className="mt-1 text-xs text-slate-500">Only changes are listed.</p>
      {events.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">Nothing has changed yet.</p>
      ) : (
        <ol className="mt-2 max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-3 font-mono text-xs">
          {events.map((event) => (
            <li className={event.available ? "text-emerald-700" : "text-rose-700"} key={`${event.keyLabel}-${event.model}-${event.at}-${event.text}`}>
              {formatPacificTime(event.at, true)} · {event.keyLabel} ·{" "}
              {modelTestModels.find((model) => model.id === event.model)?.label} · {event.available ? event.text : `Not available: ${event.text}`}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
