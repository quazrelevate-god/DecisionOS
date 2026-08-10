import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  MagnifyingGlass,
  Moon,
  Sun,
  SignOut,
  Bell,
  Microphone,
  ArrowRight,
} from "@phosphor-icons/react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "./ui/command";
import { visibleItems } from "../lib/nav";

/**
 * Global command palette (⌘K / Ctrl+K).
 *
 * The app previously had no way to move between screens without reaching for
 * the sidebar. With the nav now grouped four levels deep, a keyboard route to
 * every destination and to the two global actions (capture, brain search)
 * stops the extra structure from costing anyone speed.
 */
export function CommandPalette({ user, isDark, onToggleTheme, onCapture, onLogout }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Let the header button (and anything else) open the palette without prop
  // drilling through every layer of chrome.
  useEffect(() => {
    const openPalette = () => setOpen(true);
    window.addEventListener("decisionos:open-command", openPalette);
    return () => window.removeEventListener("decisionos:open-command", openPalette);
  }, []);

  const items = useMemo(() => visibleItems(user), [user]);

  const run = useCallback((fn) => {
    setOpen(false);
    // Let the dialog finish closing before the app moves under it.
    requestAnimationFrame(fn);
  }, []);

  const groups = useMemo(() => {
    const out = [];
    items.forEach((i) => {
      const g = out.find((x) => x.label === i.group);
      if (g) g.items.push(i);
      else out.push({ label: i.group, items: [i] });
    });
    return out;
  }, [items]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder={t("command.placeholder", "Jump to a page or run a command…")}
        data-testid="command-input"
      />
      <CommandList data-testid="command-list">
        <CommandEmpty>{t("command.empty", "No matches.")}</CommandEmpty>

        <CommandGroup heading={t("command.actions", "Actions")}>
          {onCapture && (
            <CommandItem
              onSelect={() => run(onCapture)}
              data-testid="command-capture"
              value="capture new decision voice note dictate"
            >
              <Microphone size={16} weight="bold" />
              {t("command.capture", "Capture a decision")}
              <CommandShortcut>C</CommandShortcut>
            </CommandItem>
          )}
          <CommandItem
            onSelect={() => run(() => navigate("/brain"))}
            data-testid="command-search-brain"
            value="search company brain ask ai question"
          >
            <MagnifyingGlass size={16} weight="bold" />
            {t("command.search_brain", "Search the Company Brain")}
          </CommandItem>
          <CommandItem
            onSelect={() => run(() => navigate("/notifications"))}
            data-testid="command-notifications"
            value="notifications alerts"
          >
            <Bell size={16} weight="bold" />
            {t("command.notifications", "Notifications")}
          </CommandItem>
          <CommandItem
            onSelect={() => run(onToggleTheme)}
            data-testid="command-theme"
            value="toggle theme dark light mode appearance"
          >
            {isDark ? <Sun size={16} weight="bold" /> : <Moon size={16} weight="bold" />}
            {isDark
              ? t("command.theme_light", "Switch to light mode")
              : t("command.theme_dark", "Switch to dark mode")}
          </CommandItem>
        </CommandGroup>

        {groups.map((g) => (
          <CommandGroup key={g.label} heading={g.label}>
            {g.items.map((i) => (
              <CommandItem
                key={i.to}
                onSelect={() => run(() => navigate(i.to))}
                data-testid={`command-${i.testid}`}
                value={`${i.label} ${g.label}`}
              >
                <i.icon size={16} weight="bold" />
                {t(i.tkey, i.label)}
                <ArrowRight size={13} className="ml-auto opacity-0 aria-selected:opacity-40" />
              </CommandItem>
            ))}
          </CommandGroup>
        ))}

        {onLogout && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t("command.account", "Account")}>
              <CommandItem
                onSelect={() => run(onLogout)}
                data-testid="command-logout"
                value="sign out log out"
              >
                <SignOut size={16} weight="bold" />
                {t("header.sign_out")}
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}

/** Fired by the header button and the mobile FAB. */
export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent("decisionos:open-command"));
}
