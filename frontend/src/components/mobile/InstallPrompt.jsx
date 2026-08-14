// MPWA-05 · InstallPrompt.
//
// §8: capture `beforeinstallprompt`, show a dismissible bar on the THIRD
// session, never the first. iOS has no such event, so Safari gets a short
// "Add to Home Screen" instruction sheet instead.
//
// Third session, not first, because installing is a decision — asking before
// he has seen the app answer a single question is a dialog in the way. And
// once dismissed it stays dismissed; a prompt that returns is an advert.
import * as React from "react";
import { useTranslation } from "react-i18next";
import { DeviceMobile, Export, Plus, X } from "@phosphor-icons/react";
import { BottomSheet } from "./BottomSheet";
import { sessionCount, installDismissed, dismissInstall } from "@/serviceWorkerRegistration";

const MIN_SESSIONS = 3;

const isIos = () =>
  typeof navigator !== "undefined" &&
  /iphone|ipad|ipod/i.test(navigator.userAgent) &&
  !/crios|fxios/i.test(navigator.userAgent);

const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true);

export function InstallPrompt() {
  const { t } = useTranslation();
  const [visible, setVisible] = React.useState(false);
  const [iosSheet, setIosSheet] = React.useState(false);
  const deferredRef = React.useRef(null);

  React.useEffect(() => {
    // Already installed, already said no, or too early — stay out of the way.
    if (isStandalone() || installDismissed() || sessionCount() < MIN_SESSIONS) return undefined;

    if (isIos()) {
      // No event to wait for on iOS; the bar is the only route in.
      setVisible(true);
      return undefined;
    }

    const onPrompt = (e) => {
      e.preventDefault(); // keep it for our own button
      deferredRef.current = e;
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const close = () => {
    setVisible(false);
    dismissInstall();
  };

  const install = async () => {
    if (isIos()) {
      setIosSheet(true);
      return;
    }
    const evt = deferredRef.current;
    if (!evt) return close();
    setVisible(false);
    try {
      await evt.prompt();
      await evt.userChoice;
    } catch {
      /* user closed the native sheet */
    }
    dismissInstall();
    deferredRef.current = null;
  };

  if (!visible && !iosSheet) return null;

  return (
    <>
      {visible && (
        <div
          data-testid="install-prompt"
          role="region"
          aria-label={t("install.title", "Add DecisionOS to your home screen")}
          className="lg:hidden fixed inset-x-3 z-[10040] mx-auto flex max-w-md items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 shadow-brutal-lg"
          // Sits above the dock, like UndoSnackbar, so it never covers the
          // navigation it is asking him to keep using.
          style={{ bottom: "calc(6rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <DeviceMobile size={24} weight="regular" aria-hidden="true" className="shrink-0 text-primary" />
          <p className="min-w-0 flex-1 text-sm leading-snug">
            {t("install.body", "Keep DecisionOS one tap away on your home screen.")}
          </p>
          <button
            type="button"
            onClick={install}
            data-testid="install-prompt-accept"
            className="shrink-0 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground"
            style={{ minHeight: "var(--control-h-sm)" }}
          >
            {t("install.add", "Add")}
          </button>
          <button
            type="button"
            onClick={close}
            data-testid="install-prompt-dismiss"
            aria-label={t("common.dismiss", "Dismiss")}
            className="grid shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent"
            style={{ minHeight: "var(--control-h-sm)", minWidth: "var(--control-h-sm)" }}
          >
            <X size={20} weight="bold" />
          </button>
        </div>
      )}

      {/* iOS Safari cannot be prompted programmatically — it has to be shown. */}
      <BottomSheet
        open={iosSheet}
        onClose={() => {
          setIosSheet(false);
          close();
        }}
        title={t("install.ios_title", "Add to Home Screen")}
        description={t("install.ios_sub", "Two taps in Safari and DecisionOS opens like an app.")}
        data-testid="install-ios-sheet"
      >
        <ol className="space-y-3">
          <li className="flex items-start gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-pill bg-neutral-100 text-[length:var(--text-label)] font-bold dark:bg-neutral-700">
              1
            </span>
            <span className="flex flex-wrap items-center gap-1.5 text-sm leading-snug">
              {t("install.ios_step1", "Tap the Share button")}
              <Export size={20} weight="regular" aria-hidden="true" className="text-primary" />
              {t("install.ios_step1_tail", "at the bottom of Safari.")}
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-pill bg-neutral-100 text-[length:var(--text-label)] font-bold dark:bg-neutral-700">
              2
            </span>
            <span className="flex flex-wrap items-center gap-1.5 text-sm leading-snug">
              {t("install.ios_step2", "Scroll down and choose")}
              <Plus size={18} weight="bold" aria-hidden="true" className="text-primary" />
              <strong className="font-semibold">{t("install.ios_step2_name", "Add to Home Screen")}</strong>
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-pill bg-neutral-100 text-[length:var(--text-label)] font-bold dark:bg-neutral-700">
              3
            </span>
            <span className="text-sm leading-snug">
              {t("install.ios_step3", "Tap Add. It opens full-screen from then on.")}
            </span>
          </li>
        </ol>
      </BottomSheet>
    </>
  );
}

export default InstallPrompt;
