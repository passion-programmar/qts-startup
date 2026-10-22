"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  createCategoryAction,
  createSubCategoryAction,
  deleteCategoryAction,
  deleteSubCategoryAction,
  updateCategoryAction,
  updateSubCategoryAction,
  type CategoryActionState,
} from "@/app/categories/actions";

const initialState: CategoryActionState = { error: null, success: null };
export type CategoryOption = { id: string; name: string };

export function CreateCategoryForm() {
  const [state, formAction] = useActionState(createCategoryAction, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row">
      <label className="sr-only" htmlFor="new-category-name">New category name</label>
      <input
        autoComplete="off"
        className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        id="new-category-name"
        maxLength={120}
        name="name"
        placeholder="e.g. Engineering"
        required
      />
      <SubmitButton idleText="Add category" pendingText="Adding…" />
      <ActionMessage state={state} />
    </form>
  );
}

export function CreateSubCategoryForm({ categories }: { categories: CategoryOption[] }) {
  const [state, formAction] = useActionState(createSubCategoryAction, initialState);
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]">
      <label className="sr-only" htmlFor="new-subcategory-parent">Parent category</label>
      <select className={inputClass} id="new-subcategory-parent" name="categoryId" required defaultValue="">
        <option disabled value="">Choose a category</option>
        {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
      </select>
      <label className="sr-only" htmlFor="new-subcategory-name">New subcategory name</label>
      <input
        autoComplete="off"
        className={inputClass}
        id="new-subcategory-name"
        maxLength={120}
        name="name"
        placeholder="e.g. Backend Engineer"
        required
      />
      <SubmitButton idleText="Add subcategory" pendingText="Adding…" />
      <ActionMessage state={state} />
    </form>
  );
}

export function EditCategoryForm({ id, name }: { id: string; name: string }) {
  const [state, formAction] = useActionState(updateCategoryAction, initialState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input name="categoryId" type="hidden" value={id} />
      <label className="sr-only" htmlFor={`category-${id}`}>Category name</label>
      <input className={inputClass} defaultValue={name} id={`category-${id}`} maxLength={120} name="name" required />
      <SubmitButton idleText="Save" pendingText="Saving…" />
      <ActionMessage state={state} />
    </form>
  );
}

export function DeleteCategoryForm({ id, name }: { id: string; name: string }) {
  const [state, formAction] = useActionState(deleteCategoryAction, initialState);
  return (
    <form
      action={formAction}
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        if (!window.confirm(`Delete category "${name}"? It must have no subcategories.`)) event.preventDefault();
      }}
    >
      <input name="categoryId" type="hidden" value={id} />
      <SubmitButton destructive idleText="Delete" pendingText="Deleting…" />
      <ActionMessage state={state} />
    </form>
  );
}

export function EditSubCategoryForm({
  id,
  categoryId,
  name,
  categories,
}: {
  id: string;
  categoryId: string;
  name: string;
  categories: CategoryOption[];
}) {
  const [state, formAction] = useActionState(updateSubCategoryAction, initialState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input name="subCategoryId" type="hidden" value={id} />
      <label className="sr-only" htmlFor={`subcategory-parent-${id}`}>Parent category</label>
      <select className={inputClass} defaultValue={categoryId} id={`subcategory-parent-${id}`} name="categoryId" required>
        {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
      </select>
      <label className="sr-only" htmlFor={`subcategory-${id}`}>Subcategory name</label>
      <input className={inputClass} defaultValue={name} id={`subcategory-${id}`} maxLength={120} name="name" required />
      <SubmitButton idleText="Save" pendingText="Saving…" />
      <ActionMessage state={state} />
    </form>
  );
}

export function DeleteSubCategoryForm({ id, name }: { id: string; name: string }) {
  const [state, formAction] = useActionState(deleteSubCategoryAction, initialState);
  return (
    <form
      action={formAction}
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        if (!window.confirm(`Delete subcategory "${name}"? Assigned candidates will become uncategorized.`)) event.preventDefault();
      }}
    >
      <input name="subCategoryId" type="hidden" value={id} />
      <SubmitButton destructive idleText="Delete" pendingText="Deleting…" />
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
      className={`h-9 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition disabled:cursor-wait disabled:opacity-60 ${
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
  return <span className={`self-center text-xs ${state.error ? "text-rose-700" : "text-emerald-700"}`} role="status">{state.error || state.success}</span>;
}

const inputClass = "h-10 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100";
