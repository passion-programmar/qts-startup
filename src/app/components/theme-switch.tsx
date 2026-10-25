"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { themeStorageKey, type Theme } from "@/app/components/theme";

// The <html> "dark" class is the source of truth; watching it keeps every switch in sync.
function subscribeToTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

const currentTheme = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(themeStorageKey, theme);
  } catch {
    // Private browsing can block storage; the theme still applies for this page view.
  }
}

const options = [
  { theme: "light", label: "Light", icon: Sun },
  { theme: "dark", label: "Dark", icon: Moon },
] as const;

// A Light / Dark segmented switch. The collapsed desktop sidebar shows the single
// flip button instead; CSS picks which one is visible, as it does for the rest of the sidebar.
export function ThemeSwitch() {
  // The server renders the default dark theme.
  const theme = useSyncExternalStore(subscribeToTheme, currentTheme, (): Theme => "dark");
  const next: Theme = theme === "dark" ? "light" : "dark";
  const CurrentIcon = theme === "dark" ? Moon : Sun;

  return (
    <div className="workspace-theme">
      <div aria-label="Color theme" className="workspace-theme-switch" role="group">
        {options.map(({ theme: option, label, icon: Icon }) => (
          <button aria-pressed={theme === option} key={option} onClick={() => applyTheme(option)} type="button">
            <Icon aria-hidden="true" size={15} />
            {label}
          </button>
        ))}
      </div>
      <button aria-label={`Switch to ${next} mode`} className="workspace-theme-toggle" onClick={() => applyTheme(next)} title={`Switch to ${next} mode`} type="button">
        <CurrentIcon aria-hidden="true" size={17} />
      </button>
    </div>
  );
}
