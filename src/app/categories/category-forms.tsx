"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  createCategoryAction,
  deleteCategoryAction,
  updateCategoryAction,
  type CategoryActionState,
} from "@/app/categories/actions";

const initialState: CategoryActionState = { error: null, success: null };

export function CreateCategoryForm() {
  const [state, formAction] = useActionState(createCategoryAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row">
      <label className="sr-only" htmlFor="new-category-name">
        New category name
      </label>
      <input
        autoComplete="off"
        className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        id="new-category-name"
        maxLength={120}
        name="name"
        placeholder="e.g. Software Engineering"
        required
      />
      <SubmitButton idleText="Add category" pendingText="Adding…" />
      <ActionMessage state={state} />
    </form>
  );
}

export function EditCategoryForm({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const [state, formAction] = useActionState(updateCategoryAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2 sm:flex-row">
      <input name="categoryId" type="hidden" value={id} />
      <label className="sr-only" htmlFor={`category-${id}`}>
        Category name
      </label>
      <input
        className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        defaultValue={name}
        id={`category-${id}`}
        maxLength={120}
        name="name"
        required
      />
      <SubmitButton idleText="Save" pendingText="Saving…" />
      <ActionMessage state={state} />
    </form>
  );
}

export function DeleteCategoryForm({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const [state, formAction] = useActionState(deleteCategoryAction, initialState);

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-center gap-3"
      onSubmit={(event) => {
        if (
          !window.confirm(
            `Delete "${name}"? Profiles using this category will become uncategorized.`,
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input name="categoryId" type="hidden" value={id} />
      <SubmitButton idleText="Delete" pendingText="Deleting…" destructive />
      <ActionMessage state={state} />
    </form>
  );
}

function SubmitButton({
  idleText,
  pendingText,
  destructive = false,
}: {
  idleText: string;
  pendingText: string;
  destructive?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className={`h-9 rounded-lg px-3 text-xs font-semibold transition disabled:cursor-wait disabled:opacity-60 ${
        destructive
          ? "border border-rose-200 text-rose-700 hover:bg-rose-50"
          : "bg-indigo-600 text-white hover:bg-indigo-700"
      }`}
      disabled={pending}
      type="submit"
    >
      {pending ? pendingText : idleText}
    </button>
  );
}

function ActionMessage({ state }: { state: CategoryActionState }) {
  if (!state.error && !state.success) return null;
  return (
    <span
      className={`self-center text-xs ${
        state.error ? "text-rose-700" : "text-emerald-700"
      }`}
      role="status"
    >
      {state.error || state.success}
    </span>
  );
}
