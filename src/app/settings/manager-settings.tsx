"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import { LoadingIcon } from "@/app/components/loading-icon";
import {
  updateManagerApplyAction,
  updateManagerChatGptUrlAction,
  updateManagerGeminiMatchingAction,
  updateManagerJobDetectionUrlAccessAction,
  updateManagerPageExclusionAccessAction,
  updateManagerTextHighlightAccessAction,
  type PromptActionState,
} from "@/app/settings/actions";
import { MANAGER_SETTINGS, type ManagerSettingKey } from "@/app/settings/manager-settings-meanings";
import { ActionFeedback } from "@/app/settings/prompt-forms";

const initialState: PromptActionState = { error: null, success: null };

type SwitchSetting = Exclude<ManagerSettingKey, "chatGptUrl">;

// The server action behind each switch and the form value that means each state.
const CONTROLS: Record<SwitchSetting, {
  action: typeof updateManagerApplyAction;
  field: string;
  onValue: string;
  offValue: string;
}> = {
  apply: { action: updateManagerApplyAction, field: "enabled", onValue: "true", offValue: "false" },
  autoApplyApi: { action: updateManagerApplyAction, field: "autoApplyApi", onValue: "true", offValue: "false" },
  aiMode: { action: updateManagerApplyAction, field: "aiMode", onValue: "gemini", offValue: "chatgpt" },
  reviewMode: { action: updateManagerApplyAction, field: "reviewMode", onValue: "before_submit", offValue: "every_step" },
  autoSubmit: { action: updateManagerApplyAction, field: "autoSubmit", onValue: "true", offValue: "false" },
  geminiMatching: { action: updateManagerGeminiMatchingAction, field: "enabled", onValue: "true", offValue: "false" },
  textHighlights: { action: updateManagerTextHighlightAccessAction, field: "enabled", onValue: "true", offValue: "false" },
  pageExclusions: { action: updateManagerPageExclusionAccessAction, field: "enabled", onValue: "true", offValue: "false" },
  jobDetectionUrls: { action: updateManagerJobDetectionUrlAccessAction, field: "enabled", onValue: "true", offValue: "false" },
};

// One setting of one Manager: it saves as soon as it is switched, and only a failure adds text,
// so every row stays one line tall.
export function ManagerSettingSwitch({
  setting,
  managerId,
  managerName,
  on,
  disabledReason,
}: {
  setting: SwitchSetting;
  managerId: string;
  managerName: string;
  on: boolean;
  disabledReason?: string;
}) {
  const { action, field, onValue, offValue } = CONTROLS[setting];
  const words = MANAGER_SETTINGS[setting];
  const [state, formAction, isPending] = useActionState(action, initialState);
  const current = on ? words.on : words.off;

  return (
    <div className="min-w-0 space-y-2">
      <form action={formAction} className="flex items-center gap-2">
        <input name="managerId" type="hidden" value={managerId} />
        <input name={field} type="hidden" value={on ? offValue : onValue} />
        <button
          aria-checked={on}
          aria-label={`${words.column} for ${managerName}: ${current}`}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 disabled:opacity-40 ${on ? "bg-linear-to-r from-indigo-600 to-violet-500 shadow-sm shadow-indigo-500/30" : "bg-slate-200 enabled:hover:bg-slate-300"}`}
          disabled={isPending || Boolean(disabledReason)}
          role="switch"
          title={disabledReason ?? `Change to ${on ? words.off : words.on}`}
          type="submit"
        >
          <span className={`flex size-4 items-center justify-center rounded-full bg-white text-indigo-600 shadow transition-transform duration-200 ${on ? "translate-x-[18px]" : "translate-x-0.5"}`}>
            {isPending && <LoadingIcon className="size-3" />}
          </span>
        </button>
        <span className={`whitespace-nowrap text-xs font-medium ${disabledReason ? "text-slate-400" : on ? "text-slate-800" : "text-slate-500"}`}>
          {isPending ? "Saving..." : current}
        </span>
      </form>
      {state.error && <ActionFeedback state={state} />}
    </div>
  );
}

// A link has no visible change when it saves, so this cell also says when it was saved.
export function ManagerChatGptUrlCell({
  managerId,
  managerName,
  chatGptUrl,
}: {
  managerId: string;
  managerName: string;
  chatGptUrl: string;
}) {
  const [state, formAction, isPending] = useActionState(updateManagerChatGptUrlAction, initialState);

  return (
    <form action={formAction} className="min-w-52 space-y-2">
      <input name="managerId" type="hidden" value={managerId} />
      <div className="flex items-center gap-1.5">
        <input
          aria-label={`${MANAGER_SETTINGS.chatGptUrl.column} for ${managerName}`}
          className="h-8 w-[7.5rem] min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 text-[11px] outline-none transition-colors focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
          defaultValue={chatGptUrl}
          maxLength={2048}
          name="chatGptUrl"
          placeholder="https://chatgpt.com/g/g-p-..."
          title={chatGptUrl}
          type="url"
        />
        <button
          aria-label={`Save ${MANAGER_SETTINGS.chatGptUrl.column} for ${managerName}`}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-60"
          disabled={isPending}
          title="Save link"
          type="submit"
        >
          {isPending ? <LoadingIcon className="size-3.5" /> : <Save aria-hidden="true" className="size-3.5" />}
        </button>
      </div>
      <ActionFeedback state={state} />
    </form>
  );
}
