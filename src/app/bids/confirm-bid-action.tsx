"use client";

import { useActionState } from "react";
import { confirmBidAction } from "@/app/bids/actions";
import { LoadingIcon } from "@/app/components/loading-icon";
import { initialRecordState } from "@/app/record-action-state";

// After checking the screenshot or the job site, the Manager confirms a not-confirmed application.
export function ConfirmBidAction({ id }: { id: string }) {
  const [state, action, pending] = useActionState(confirmBidAction, initialRecordState);
  return (
    <form action={action} className="mt-1">
      <input name="id" type="hidden" value={id} />
      <button
        className="inline-flex h-6 items-center rounded-md border border-amber-200 px-2 text-[10px] font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending && <LoadingIcon className="mr-1 size-3" />}
        Mark confirmed
      </button>
      {state.error && <span className="mt-1 block text-[10px] text-rose-700">{state.error}</span>}
    </form>
  );
}
