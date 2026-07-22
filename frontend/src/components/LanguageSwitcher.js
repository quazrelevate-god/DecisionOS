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
          className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-black/[0.04] transition-colors">
          <span className={current === l.code ? "font-semibold" : ""}>{l.label}</span>
          {current === l.code && <Check size={16} weight="bold" className="text-brand-red" />}
        </button>
      ))}
    </div>
  );

  if (variant === "inline") {
    return (
      <div className="flex flex-wrap gap-2" data-testid="language-inline">
        {LANGUAGES.map((l) => (
          <button key={l.code} onClick={() => choose(l.code)} data-testid={`lang-option-${l.code}`}
            className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg border transition-all ${current === l.code ? "bg-brand-ink text-white border-black" : "bg-card border-border hover:bg-black/[0.04]"}`}>
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
        <button data-testid="language-switcher" title={t("common.language")}
          className="w-10 h-10 flex items-center justify-center border border-black hover:bg-brand-ink hover:text-white transition-colors">
          <Globe size={18} weight="bold" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-0 border border-black shadow-brutal">
        <Options />
      </PopoverContent>
    </Popover>
  );
}
