"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { themeStorageKey, type ThemePreference } from "@/app/components/theme";

// The saved choice is the source of truth for the switch; the <head> script (theme.ts) turns it into
// the <html> "dark" class and follows the computer's setting when the choice is System.
const changeEvent = "qts-theme-change";

function subscribe(onChange: () => void) {
  window.addEventListener(changeEvent, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(changeEvent, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function savedPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(themeStorageKey);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function choose(preference: ThemePreference) {
  try {
    if (preference === "system") localStorage.removeItem(themeStorageKey);
    else localStorage.setItem(themeStorageKey, preference);
  } catch {
    // Private browsing can block storage; the theme still applies for this page view.
  }
  const followsDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
  const dark = preference === "dark" || (preference === "system" && followsDark);
  // Colours fade over a moment rather than jumping (see .theme-changing in globals.css).
  const root = document.documentElement;
  root.classList.add("theme-changing");
  root.classList.toggle("dark", dark);
  window.setTimeout(() => root.classList.remove("theme-changing"), 250);
  window.dispatchEvent(new Event(changeEvent));
}

const options = [
  { preference: "light", label: "Light", icon: Sun },
  { preference: "dark", label: "Dark", icon: Moon },
  { preference: "system", label: "System", icon: Monitor },
] as const;

// Light / Dark / System. The collapsed desktop sidebar shows one button that steps through them;
// CSS picks which one is visible, as it does for the rest of the sidebar.
export function ThemeSwitch() {
  const preference = useSyncExternalStore(subscribe, savedPreference, (): ThemePreference => "system");
  const index = options.findIndex((option) => option.preference === preference);
  const current = options[index];
  const next = options[(index + 1) % options.length];

  return (
    <div className="workspace-theme">
      <div aria-label="Color theme" className="workspace-theme-switch" role="group">
        {options.map(({ preference: option, label, icon: Icon }) => (
          <button
            aria-pressed={preference === option}
            key={option}
            onClick={() => choose(option)}
            title={option === "system" ? "Follow your computer's light or dark setting" : `${label} mode`}
            type="button"
          >
            <Icon aria-hidden="true" size={14} />
            {label}
          </button>
        ))}
      </div>
      <button
        aria-label={`Theme: ${current.label}. Switch to ${next.label}`}
        className="workspace-theme-toggle"
        onClick={() => choose(next.preference)}
        title={`Theme: ${current.label} (click for ${next.label})`}
        type="button"
      >
        <current.icon aria-hidden="true" size={17} />
      </button>
    </div>
  );
}
