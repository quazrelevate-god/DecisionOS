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
      /* KM-50 — iOS CANNOT BE PROMPTED, so Add opens the SHARE SHEET instead.
         There is no beforeinstallprompt on WebKit and no API that adds to the
         home screen — Apple has never shipped one, deliberately. The nearest
         real thing is navigator.share(), which opens the very sheet that holds
         "Add to Home Screen", so the button now lands the user one tap from
         done instead of on a page of instructions. Founder: "when I click the
         button it should route me to add home screen functionality or at least
         a share window should show."
         The instruction sheet stays as the fallback: share() needs a secure
         context and a user gesture, and it rejects if the user cancels — in
         either case the steps are still the honest answer. */
      try {
        if (navigator.share) {
          await navigator.share({
            title: "DecisionOS",
            text: t("install.body", "Keep DecisionOS one tap away on your home screen."),
            url: window.location.origin,
          });
          return;   // they got the sheet; do not stack instructions on top
        }
      } catch {
        /* cancelled or unavailable — fall through to the steps */
      }
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
          /* KM-50 — the toast wore .nm-raised + shadow-brutal-lg, both from
             design systems this app retired two passes ago; it was the last
             brutalist surface still shipping. Now the same frosted pill the
             rest of the phone UI uses. */
          className="lg:hidden fixed inset-x-3 z-[10040] mx-auto flex max-w-md items-center gap-3 kr-frost rounded-pill py-2.5 pl-4 pr-2.5 shadow-[0_10px_30px_-12px_hsl(230_30%_18%/.45)]"
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
            className="kr-pop shrink-0 rounded-pill bg-kr-ink px-4 text-sm font-semibold text-white"
            style={{ minHeight: "var(--control-h-sm)" }}
          >
            {t("install.add", "Add")}
          </button>
          <button
            type="button"
            onClick={close}
            data-testid="install-prompt-dismiss"
            aria-label={t("common.dismiss", "Dismiss")}
            className="grid shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-white/50"
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
