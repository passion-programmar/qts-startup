"use client";

// The Super Admin Categories page's controls (2026-11-28 layout): one window for Add and Edit (name,
// colour, preview), and a delete button that asks first.
import { useActionState, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { ConfirmButton } from "@/app/components/confirm-button";
import { LoadingIcon } from "@/app/components/loading-icon";
import { cn } from "@/app/ui/cn";
import {
  createCategoryAction,
  deleteCategoryAction,
  updateCategoryAction,
  type CategoryActionState,
} from "@/app/categories/actions";
import { labelTextColor, managerCategoryColors } from "@/server/users/manager-category-color";

const initialState: CategoryActionState = { error: null, success: null };

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** A soft tint of a colour, readable in both themes. */
function tint(color: string, amount: number): string {
  return `color-mix(in srgb, ${color} ${amount}%, transparent)`;
}

/** The round colour mark in front of a category's name; a dashed ring when it has no colour. */
export function CategoryDot({ color, className }: { color: string | null; className?: string }) {
  return color && HEX_COLOR.test(color) ? (
    <span aria-hidden="true" className={cn("size-3 shrink-0 rounded-full ring-1 ring-black/10", className)} style={{ backgroundColor: color }} />
  ) : (
    <span aria-hidden="true" className={cn("size-3 shrink-0 rounded-full border border-dashed border-slate-400", className)} />
  );
}

/**
 * "+ Add category" or a row's ✎: opens the window with the name, the colour and a preview of a label.
 * On Edit, a new colour shows how many candidates it recolours; Save then resets their label colour.
 */
export function CategoryDialogButton({
  mode,
  id,
  name = "",
  color = null,
  profiles = 0,
}: {
  mode: "add" | "edit";
  id?: string;
  name?: string;
  color?: string | null;
  profiles?: number;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const [draftName, setDraftName] = useState(name);
  const [picked, setPicked] = useState(color ?? "");
  const [state, formAction] = useActionState(async (previous: CategoryActionState, formData: FormData) => {
    const result = await (mode === "add" ? createCategoryAction : updateCategoryAction)(previous, formData);
    if (result.success) {
      dialog.current?.close();
      if (mode === "add") {
        setDraftName("");
        setPicked("");
      }
    }
    return result;
  }, initialState);
  const recolours = mode === "edit" && picked !== "" && picked !== (color ?? "") ? profiles : 0;

  function open() {
    // Each opening starts from what is saved (an edit left by Cancel is dropped).
    setDraftName(name);
    setPicked(color ?? "");
    dialog.current?.showModal();
  }

  return (
    <>
      {mode === "add" ? (
        <button
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-hover"
          onClick={open}
          type="button"
        >
          <Plus aria-hidden="true" className="size-4" />
          Add category
        </button>
      ) : (
        <button
          aria-label={`Edit ${name}`}
          className="inline-flex size-8 items-center justify-center rounded-lg text-fg-muted transition hover:bg-line-soft hover:text-fg"
          onClick={open}
          title="Edit name and colour"
          type="button"
        >
          <Pencil aria-hidden="true" className="size-4" />
        </button>
      )}
      <dialog
        aria-labelledby={titleId}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-card border border-line bg-card p-0 text-left text-fg shadow-2xl backdrop:bg-slate-950/50 backdrop:backdrop-blur-[2px]"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
        ref={dialog}
      >
        <form action={formAction} className="space-y-5 p-6" ref={form}>
          {id ? <input name="categoryId" type="hidden" value={id} /> : null}
          <h2 className="text-lg font-semibold" id={titleId}>{mode === "add" ? "Add category" : "Edit category"}</h2>

          <div>
            <label className="mb-2 block text-xs font-semibold text-fg-soft" htmlFor={`${titleId}-name`}>Name</label>
            <input
              autoComplete="off"
              className="h-10 w-full rounded-lg border border-line bg-card px-3 text-sm text-fg outline-none focus:border-primary-ring focus:ring-4 focus:ring-primary-soft"
              id={`${titleId}-name`}
              maxLength={120}
              name="name"
              onChange={(event) => setDraftName(event.target.value)}
              placeholder="e.g. Engineering"
              required
              value={draftName}
            />
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold text-fg-soft">Colour</p>
            <ColorDots label="Category colour" onChange={setPicked} value={picked} />
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-fg-soft">Preview</span>
            <LabelPreview color={picked} name={draftName.trim() || "Category"} />
          </div>

          {recolours ? (
            <p className="flex items-start gap-2 rounded-lg border border-warning-ring bg-warning-soft px-3 py-2.5 text-sm text-warning-text" role="status">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {recolours} {recolours === 1 ? "candidate" : "candidates"} in {name} will get this colour for their label, for every Manager.
            </p>
          ) : null}

          {state.error ? <p className="text-sm text-danger-text" role="alert">{state.error}</p> : null}

          <div className="flex justify-end gap-2">
            <button
              className="h-10 rounded-lg border border-line px-4 text-sm font-medium text-fg-soft transition hover:bg-line-soft"
              onClick={() => dialog.current?.close()}
              type="button"
            >
              Cancel
            </button>
            <SaveButton label={mode === "add" ? "Add category" : recolours ? "Save and recolour" : "Save"} />
          </div>
        </form>
      </dialog>
    </>
  );
}

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-hover disabled:cursor-wait disabled:opacity-70"
      disabled={pending}
      type="submit"
    >
      {pending ? <LoadingIcon className="size-4" /> : null}
      {pending ? "Saving…" : label}
    </button>
  );
}

/** How a candidate's label looks with this colour (the People list's soft pill). */
function LabelPreview({ color, name }: { color: string; name: string }) {
  const valid = HEX_COLOR.test(color) ? color : null;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2.5 py-0.5 text-xs font-semibold text-fg-soft",
        !valid && "bg-line-soft ring-1 ring-inset ring-line",
      )}
      style={valid ? { backgroundColor: tint(valid, 16), boxShadow: `inset 0 0 0 1px ${tint(valid, 45)}` } : undefined}
    >
      {valid ? <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full ring-1 ring-black/10" style={{ backgroundColor: valid }} /> : null}
      <span className="truncate">{name}</span>
    </span>
  );
}

/** The 14 label colours plus "no colour"; the choice is sent as "color". */
function ColorDots({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <div aria-label={label} className="flex flex-wrap items-center gap-2" role="group">
      <input name="color" type="hidden" value={value} />
      {[{ name: "No colour", value: "" }, ...managerCategoryColors].map((choice) => {
        const selected = choice.value === value;
        return (
          <button
            aria-label={choice.name}
            aria-pressed={selected}
            className={cn(
              "flex size-7 items-center justify-center rounded-full border bg-white transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              selected ? "border-primary ring-2 ring-primary-ring" : "border-slate-300 hover:scale-110",
            )}
            key={choice.value || "none"}
            onClick={() => onChange(choice.value)}
            style={choice.value ? { backgroundColor: choice.value } : undefined}
            title={choice.name}
            type="button"
          >
            {!choice.value && <X aria-hidden="true" className="size-3.5 text-slate-400" />}
            {choice.value && selected ? <Check aria-hidden="true" className="size-4" style={{ color: labelTextColor(choice.value) }} /> : null}
          </button>
        );
      })}
    </div>
  );
}

export function DeleteCategoryForm({ id, name, profiles }: { id: string; name: string; profiles: number }) {
  const [state, formAction, isPending] = useActionState(deleteCategoryAction, initialState);
  return (
    <form action={formAction} className="flex items-center">
      <input name="categoryId" type="hidden" value={id} />
      <ConfirmButton
        ariaLabel={`Delete ${name}`}
        cancelLabel="No"
        className="inline-flex size-8 items-center justify-center rounded-lg text-fg-faint transition hover:bg-danger-soft hover:text-danger-text disabled:opacity-60"
        confirmLabel="Yes, delete"
        description={
          profiles
            ? <>Delete “{name}”? Its {profiles} {profiles === 1 ? "candidate moves" : "candidates move"} to the default category.</>
            : <>Delete “{name}”? No candidates are in it.</>
        }
        disabled={isPending}
        title="Delete this category?"
      >
        {isPending ? <LoadingIcon className="size-4" /> : <Trash2 aria-hidden="true" className="size-4" />}
      </ConfirmButton>
      {state.error ? <span className="ml-2 text-xs text-danger-text" role="alert">{state.error}</span> : null}
    </form>
  );
}
