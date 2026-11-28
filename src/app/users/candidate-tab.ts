// The candidate Add and Edit pages open in their own tab from the People list (user, 2026-11-28). Leaving them
// (Save, Cancel, Back) closes that tab and tells the list's tab to show the change.

/** The People list listens on this channel and reloads its rows on "saved". */
export const CANDIDATES_CHANNEL = "qts-candidates";

type Router = { push: (href: string) => void };

/**
 * Closes this tab when the browser allows it (a tab the list opened); otherwise goes back to the
 * list in this tab, as before. "saved" also tells other open lists to reload.
 */
export function leaveCandidatePage(router: Router, saved: boolean) {
  if (saved && typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CANDIDATES_CHANNEL);
    channel.postMessage("saved");
    channel.close();
  }
  window.close();
  // Still here: the browser kept the tab open (it was not opened by the list).
  setTimeout(() => router.push("/users"), 250);
}
