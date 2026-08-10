import { useTranslation } from "react-i18next";
import { Globe, Check } from "@phosphor-icons/react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
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
    <div className="py-1" data-testid="language-options">
      {LANGUAGES.map((l) => (
        <button key={l.code} onClick={() => choose(l.code)} data-testid={`lang-option-${l.code}`}
          className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors duration-200 hover:bg-accent">
          <span className={current === l.code ? "font-medium" : "text-muted-foreground"}>{l.label}</span>
          {current === l.code && <Check size={16} weight="bold" className="text-primary" />}
        </button>
      ))}
    </div>
  );

  if (variant === "inline") {
    return (
      <div className="flex flex-wrap gap-2" data-testid="language-inline">
        {LANGUAGES.map((l) => (
          <button key={l.code} onClick={() => choose(l.code)} data-testid={`lang-option-${l.code}`}
            className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg border transition-[background-color,border-color,color,transform] duration-200 active:scale-[0.98] ${current === l.code ? "bg-primary-subtle text-primary border-primary/25 font-medium" : "bg-card border-border text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
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
        <button data-testid="language-switcher" title={t("common.language")} aria-label={t("common.language")}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] duration-200 hover:bg-accent hover:text-foreground active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <Globe size={18} weight="bold" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-44 overflow-hidden rounded-xl border border-border p-0 shadow-lg">
        <Options />
      </PopoverContent>
    </Popover>
  );
}
