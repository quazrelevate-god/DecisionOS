import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { X, Mic, Search, Bell, Sun, Moon, LogOut, Globe } from "lucide-react";

import { visibleGroups, activeItem } from "../lib/nav";
import { cn } from "../lib/utils";

/* ============================================================================
   App launcher
   ----------------------------------------------------------------------------
   Replaces the mobile hamburger + slide-in sidebar entirely. Swipe up from the
   bottom bar (or tap it) and the whole screen becomes a navigation surface:
   every destination as a labelled tile, grouped by category, reachable with
   one thumb.

   Why a full screen instead of a drawer: a drawer keeps the page visible
   behind it, so the eye still has two competing layouts to parse. A launcher
   replaces the page outright — while you are choosing where to go, that is
   the only thing on screen.

   Dismiss: drag down, tap the scrim, press Escape, or hit the close control.
   ========================================================================== */

export function AppLauncher({
  open,
  onClose,
  user,
  tenant,
  counters = {},
  isDark,
  onToggleTheme,
  onCapture,
  onSearch,
  onLogout,
  onProfile,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const groups = useMemo(() => visibleGroups(user), [user]);
  const current = activeItem(location.pathname);

  // Drag-to-dismiss, matching the sheet gesture used elsewhere in the app.
  const [dragY, setDragY] = useState(0);
  const startY = useRef(null);

  useEffect(() => {
    if (!open) {
      setDragY(0);
      return undefined;
    }
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    // The launcher owns the viewport while open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const go = (to) => {
    onClose();
    requestAnimationFrame(() => navigate(to));
  };

  const onTouchStart = (e) => {
    startY.current = e.touches[0].clientY;
  };
  const onTouchMove = (e) => {
    if (startY.current == null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0) setDragY(dy);
  };
  const onTouchEnd = () => {
    if (dragY > 110) onClose();
    else setDragY(0);
    startY.current = null;
  };

  return (
    <div
      className="fixed inset-0 z-[70] lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation"
      data-testid="app-launcher"
    >
      {/* Scrim — tapping outside the panel closes, like any system sheet. */}
      <button
        aria-label="Close navigation"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-brand-ink/60 backdrop-blur-md animate-fade-in"
        tabIndex={-1}
      />

      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: startY.current == null ? "transform .28s cubic-bezier(0.16,1,0.3,1)" : "none",
        }}
        className={cn(
          "absolute inset-x-0 bottom-0 top-0 flex flex-col",
          // Saturated glass, never fully transparent — the page reads as depth
          // behind the launcher instead of competing with it.
          "bg-background/75 backdrop-blur-2xl backdrop-saturate-150",
          "animate-[launcher-in_.32s_cubic-bezier(0.16,1,0.3,1)_both]"
        )}
      >
        {/* Grab handle — the promise that this drags away. */}
        <div className="flex shrink-0 justify-center pt-3" aria-hidden="true">
          <span className="h-1.5 w-10 rounded-full bg-border-strong" />
        </div>

        {/* Workspace identity + close */}
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-4 pt-4">
          <div className="min-w-0">
            <p className="truncate text-[17px] font-semibold tracking-tight">{tenant?.name}</p>
            <p className="label-mono mt-1 truncate text-muted-foreground">
              {user?.name} · {user?.role}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            data-testid="launcher-close"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/70 bg-card/60 backdrop-blur-xl text-muted-foreground transition-transform duration-200 active:scale-90"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {/* Primary actions — capture is the product's atomic gesture, so it
            leads and is the only gold surface here. */}
        <div className="flex shrink-0 gap-2 px-5 pb-5">
          <button
            onClick={() => {
              onClose();
              requestAnimationFrame(() => onCapture?.());
            }}
            data-testid="launcher-capture"
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-brand-gold px-4 py-3.5 text-sm font-semibold text-brand-ink shadow-sm transition-transform duration-200 active:scale-[0.97]"
          >
            <Mic size={18} strokeWidth={2} /> {t("header.capture", "Capture")}
          </button>
          <button
            onClick={() => {
              onClose();
              requestAnimationFrame(() => onSearch?.());
            }}
            aria-label={t("command.trigger", "Search")}
            data-testid="launcher-search"
            className="inline-flex h-[3.25rem] w-[3.25rem] shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-card/60 backdrop-blur-xl text-muted-foreground transition-transform duration-200 active:scale-[0.94]"
          >
            <Search size={19} strokeWidth={2} />
          </button>
          <button
            onClick={() => go("/notifications")}
            aria-label={t("header.notifications")}
            data-testid="launcher-notifications"
            className="relative inline-flex h-[3.25rem] w-[3.25rem] shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-card/60 backdrop-blur-xl text-muted-foreground transition-transform duration-200 active:scale-[0.94]"
          >
            <Bell size={19} strokeWidth={2} />
            {counters.unread > 0 && (
              <span className="absolute right-2 top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 font-mono text-[9px] font-semibold leading-none text-destructive-foreground">
                {counters.unread > 9 ? "9+" : counters.unread}
              </span>
            )}
          </button>
        </div>

        {/* The grid itself */}
        <nav
          aria-label="All destinations"
          className="min-h-0 flex-1 overflow-y-auto px-5 pb-6"
        >
          {groups.map((g, gi) => (
            <section key={g.id} className={cn(gi > 0 && "mt-7")}>
              <p className="label-mono pb-3 text-muted-foreground/70">{t(g.tkey, g.label)}</p>
              <div className="grid grid-cols-4 gap-2.5">
                {g.items.map((item, i) => {
                  const active = current?.to === item.to;
                  const count = item.badge ? counters[item.badge] : 0;
                  return (
                    <button
                      key={item.to}
                      onClick={() => go(item.to)}
                      data-testid={`launcher-${item.testid}`}
                      aria-current={active ? "page" : undefined}
                      style={{ animationDelay: `${Math.min(gi * 4 + i, 12) * 22}ms` }}
                      className={cn(
                        "es-reveal group relative flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border p-1.5 text-center",
                        "transition-[background-color,border-color,transform] duration-200 active:scale-[0.95]",
                        active
                          ? "border-primary/45 bg-primary-subtle/80 backdrop-blur-xl"
                          : "border-border/70 bg-card/60 backdrop-blur-xl"
                      )}
                    >
                      <item.icon
                        size={21}
                        strokeWidth={1.75}
                        className={active ? "text-primary" : "text-foreground/70"}
                        aria-hidden="true"
                      />
                      <span
                        className={cn(
                          "px-0.5 text-[10px] font-medium leading-tight",
                          active ? "text-primary" : "text-foreground/80"
                        )}
                      >
                        {item.short || t(item.tkey, item.label)}
                      </span>
                      {count > 0 && (
                        <span
                          data-numeric
                          className="absolute right-2 top-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 font-mono text-[9px] font-semibold leading-none text-destructive-foreground"
                        >
                          {count > 99 ? "99+" : count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>

        {/* Account strip */}
        <div className="shrink-0 border-t border-border/70 bg-surface/50 backdrop-blur-xl px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onClose();
                requestAnimationFrame(() => onProfile?.());
              }}
              data-testid="launcher-profile"
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1 py-1.5 text-left"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-xs font-semibold uppercase text-primary">
                {(user?.name || "?").slice(0, 2)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{user?.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{user?.email}</span>
              </span>
            </button>
            <button
              onClick={onToggleTheme}
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              data-testid="launcher-theme"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-card/60 backdrop-blur-xl text-muted-foreground transition-transform duration-200 active:scale-90"
            >
              {isDark ? <Sun size={17} strokeWidth={2} /> : <Moon size={17} strokeWidth={2} />}
            </button>
            <button
              onClick={() => go("/settings")}
              aria-label={t("common.language", "Language")}
              data-testid="launcher-language"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-card/60 backdrop-blur-xl text-muted-foreground transition-transform duration-200 active:scale-90"
            >
              <Globe size={17} strokeWidth={2} />
            </button>
            <button
              onClick={onLogout}
              aria-label={t("header.sign_out")}
              data-testid="launcher-logout"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-destructive/25 bg-destructive-subtle text-destructive transition-transform duration-200 active:scale-90"
            >
              <LogOut size={17} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
