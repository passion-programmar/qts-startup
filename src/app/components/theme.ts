// Shared by the root layout's pre-paint script and the sidebar switch.
export const themeStorageKey = "qts-theme";

/** What the page shows. */
export type Theme = "light" | "dark";
/** What the person chose: a theme, or "system" to follow the computer's light/dark setting. */
export type ThemePreference = Theme | "system";

/**
 * Runs in <head> before the first paint, so the page never flashes the wrong theme. It applies the
 * saved choice (System when nothing is saved), and re-applies it when the computer switches between
 * light and dark, or when another tab changes the choice.
 */
export const themeScript = `(function(){
  var key = ${JSON.stringify(themeStorageKey)};
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function saved() { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function apply() {
    var choice = saved();
    var dark = choice === "dark" || (choice !== "light" && (!media || media.matches));
    document.documentElement.classList.toggle("dark", dark);
  }
  apply();
  if (media && media.addEventListener) media.addEventListener("change", apply);
  window.addEventListener("storage", function (event) { if (event.key === key) apply(); });
})();`;
