import { useTranslation } from "react-i18next";
import { Globe, Check } from "@phosphor-icons/react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { GLASS_MENU } from "./karma/glass";
import { LANGUAGES, setAppLanguage } from "../i18n";
import { useAuth } from "../context/AuthContext";
import api from "../lib/api";
import { toast } from "sonner";

// Globe language switcher — per user, persisted to their profile + localStorage.
export function LanguageSwitcher({ variant = "icon" }) {
  const { i18n, t } = useTranslation();
  const { refreshMe } = useAuth();
  const current = i18n.language || "en";

  const choose = async (code) => {
    if (code === current) return;
    setAppLanguage(code);
    try {
      await api.patch("/auth/profile", { language: code });
      if (refreshMe) await refreshMe();
      toast.success(t("settings.language_saved"));
    } catch (e) {
      // Language still applies locally even if the save fails.
      console.debug("language save failed (non-blocking)", e);
    }
  };

  const Options = () => (
    <div className="p-1.5" data-testid="language-options">
      {LANGUAGES.map((l) => (
        <button key={l.code} onClick={() => choose(l.code)} data-testid={`lang-option-${l.code}`}
          className="flex min-h-10 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-900/[0.06] hover:text-slate-900 focus-visible:bg-slate-900/[0.06] focus-visible:outline-none">
          <span className={current === l.code ? "font-semibold text-slate-900" : ""}>{l.label}</span>
          {current === l.code && <Check size={16} weight="bold" className="text-slate-900" />}
        </button>
      ))}
    </div>
  );

  if (variant === "inline") {
    return (
      <div className="flex flex-wrap gap-2" data-testid="language-inline">
        {LANGUAGES.map((l) => (
          <button key={l.code} onClick={() => choose(l.code)} data-testid={`lang-option-${l.code}`}
            className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg border transition-all ${current === l.code ? "bg-primary text-primary-foreground border-border" : "bg-card border-border hover:bg-black/[0.04]"}`}>
            <Globe size={15} weight="bold" /> {l.label}
            {current === l.code && <Check size={14} weight="bold" />}
          </button>
        ))}
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* KR-5 — the reference's outlined circle, like its header siblings.
            This icon variant renders only in the desktop top bar; the mobile
            sheet uses variant="inline", untouched. */}
        <button data-testid="language-switcher" title={t("common.language")}
          className="h-10 w-10 rounded-full border border-kr-ink/55 grid place-items-center text-foreground/90 transition-colors hover:bg-white/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline">
          <Globe size={18} weight="regular" />
        </button>
      </PopoverTrigger>
      {/* 2026-09-14, founder — the app's glass list, not the stock popover. */}
      <PopoverContent align="end" className={`${GLASS_MENU} w-44 p-0`}>
        <Options />
      </PopoverContent>
    </Popover>
  );
}
