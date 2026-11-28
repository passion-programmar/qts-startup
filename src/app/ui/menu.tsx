"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ExternalLink } from "lucide-react";
import { cn } from "@/app/ui/cn";

/** Closes the open menu; true puts focus back on its button. */
const MenuCloseContext = createContext<(focusTrigger?: boolean) => void>(() => {});

/**
 * A button that opens a small menu in the app's own colours (instead of the browser's white
 * dropdown). The menu floats above the page, so a table's scroll box never cuts it off; it closes on
 * a click elsewhere, Escape, Tab or scrolling. Arrow keys move between the items.
 */
export function Menu({
  label,
  trigger,
  triggerClassName,
  title,
  disabled = false,
  align = "start",
  children,
}: {
  label: string;
  trigger: ReactNode;
  triggerClassName?: string;
  title?: string;
  disabled?: boolean;
  align?: "start" | "end";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const close = useCallback((focusTrigger = true) => {
    setOpen(false);
    setPosition(null);
    if (focusTrigger) button.current?.focus();
  }, []);

  // Placed under the button, or above it when there is no room below.
  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) return;
    const anchor = button.current.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = menu.current;
    let top = anchor.bottom + 6;
    if (top + height > window.innerHeight - 8) top = Math.max(8, anchor.top - 6 - height);
    const wanted = align === "end" ? anchor.right - width : anchor.left;
    setPosition({ top, left: Math.min(Math.max(8, wanted), window.innerWidth - width - 8) });
  }, [open, align]);

  // Focus starts on the chosen item, else the first one.
  useEffect(() => {
    if (!position || !menu.current) return;
    const items = menu.current;
    (items.querySelector<HTMLElement>('[aria-checked="true"]') ?? items.querySelector<HTMLElement>("[data-menu-item]:not(:disabled)"))?.focus();
  }, [position]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) close(false);
    };
    const onScroll = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) close(false);
    };
    const onResize = () => close(false);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>("[data-menu-item]:not(:disabled)") ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next >= 0) {
      event.preventDefault();
      items[next]?.focus();
    }
  }

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className={triggerClassName}
        disabled={disabled}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        ref={button}
        title={open ? undefined : title}
        type="button"
      >
        {trigger}
      </button>
      {open
        ? createPortal(
          <div
            aria-label={label}
            className="fixed z-50 min-w-44 rounded-xl border border-line bg-card p-1 text-fg shadow-xl shadow-slate-950/20 ring-1 ring-black/5"
            onKeyDown={onMenuKeyDown}
            ref={menu}
            role="menu"
            style={position ? { top: position.top, left: position.left } : { top: 0, left: 0, visibility: "hidden" }}
          >
            <MenuCloseContext.Provider value={close}>{children}</MenuCloseContext.Provider>
          </div>,
          document.body,
        )
        : null}
    </>
  );
}

const itemClass =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none transition-colors " +
  "hover:bg-line-soft focus-visible:bg-line-soft disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";

/**
 * One choice in a Menu: picking it closes the menu, then runs onSelect. "checked" makes it a radio
 * choice with a tick; focusTrigger={false} leaves focus alone (e.g. when onSelect opens a dialog).
 */
export function MenuItem({
  onSelect,
  focusTrigger = true,
  icon,
  hint,
  checked,
  tone = "default",
  disabled = false,
  children,
}: {
  onSelect: () => void;
  focusTrigger?: boolean;
  icon?: ReactNode;
  hint?: ReactNode;
  checked?: boolean;
  tone?: "default" | "danger";
  disabled?: boolean;
  children: ReactNode;
}) {
  const close = useContext(MenuCloseContext);
  return (
    <button
      aria-checked={checked}
      className={cn(itemClass, tone === "danger" ? "text-danger-text hover:bg-danger-soft focus-visible:bg-danger-soft" : "text-fg-soft")}
      data-menu-item=""
      disabled={disabled}
      onClick={() => {
        close(focusTrigger);
        onSelect();
      }}
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      type="button"
    >
      {icon ? <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{children}</span>
        {hint ? <span className="block text-[11px] font-normal text-fg-muted">{hint}</span> : null}
      </span>
      {checked ? <Check aria-hidden="true" className="size-4 shrink-0 text-primary-text" /> : null}
    </button>
  );
}

/** A Menu item that opens a page; newTab opens it in a new browser tab and keeps this one. */
export function MenuLink({ href, icon, newTab = false, children }: { href: string; icon?: ReactNode; newTab?: boolean; children: ReactNode }) {
  const close = useContext(MenuCloseContext);
  return (
    <Link
      className={cn(itemClass, "text-fg-soft")}
      data-menu-item=""
      href={href}
      onClick={() => close(false)}
      rel={newTab ? "noopener" : undefined}
      role="menuitem"
      target={newTab ? "_blank" : undefined}
    >
      {icon ? <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span> : null}
      <span className="min-w-0 flex-1 font-medium">{children}</span>
      {newTab ? <ExternalLink aria-label="opens in a new tab" className="size-3.5 shrink-0 text-fg-faint" /> : null}
    </Link>
  );
}
