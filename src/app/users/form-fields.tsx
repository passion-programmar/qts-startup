"use client";

// Text field and message shared by the candidate and staff forms.
import { type CSSProperties } from "react";

export function TextField({
  id,
  label,
  name,
  maxLength,
  required = false,
  autoComplete,
  defaultValue,
  placeholder,
  type = "text",
  pattern,
  inputMode,
  style,
}: {
  id: string;
  label: string;
  name: string;
  maxLength: number;
  required?: boolean;
  autoComplete: string;
  defaultValue?: string;
  placeholder?: string;
  type?: string;
  pattern?: string;
  inputMode?: "numeric";
  style?: CSSProperties;
}) {
  return (
    <div>
      <label
        className="mb-2 block text-xs font-semibold text-slate-700"
        htmlFor={id}
      >
        {label}
      </label>
      <input
        autoComplete={autoComplete}
        className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        defaultValue={defaultValue}
        id={id}
        maxLength={maxLength}
        name={name}
        pattern={pattern}
        inputMode={inputMode}
        style={style}
        placeholder={placeholder}
        required={required}
        type={type}
      />
    </div>
  );
}

export function FormMessage({
  children,
  variant,
}: {
  children: string;
  variant: "error" | "success";
}) {
  return (
    <p
      aria-live="polite"
      className={`rounded-lg border px-3.5 py-3 text-xs ${
        variant === "error"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-700"
      }`}
      role={variant === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}
