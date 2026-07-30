import * as React from "react";
import { Microphone, Stop, CircleNotch } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * Voice capture — the primary action of the capture module, and the only
 * primary in it.
 *
 * The mic is a large indigo circle because capture is what the Decision Desk
 * exists for. It is NOT red while listening: red would mean something is wrong,
 * when in fact the system is doing exactly what was asked. Listening is
 * expressed with motion (a brand-tinted pulse) rather than hue, so the state is
 * unmistakable without spending the danger colour on it.
 *
 * States: idle · listening · processing · disabled, plus focus at every one.
 *
 * @typedef {'idle'|'listening'|'processing'} VoiceState
 */

const SIZES = {
  md: { button: "size-20", icon: 30 },
  lg: { button: "size-24", icon: 38 },
};

/**
 * @typedef {object} VoiceCaptureProps
 * @property {VoiceState} [state='idle']
 * @property {() => void} onStart
 * @property {() => void} onStop
 * @property {boolean} [disabled=false]
 * @property {string} [disabledReason] Explains why, e.g. "Microphone access denied".
 * @property {string} [hint] Line under the button, e.g. a timer or a prompt.
 * @property {'md'|'lg'} [size='lg']
 * @property {React.ReactNode} [languageControl] Rendered beneath — see LanguageToggle.
 *
 * @example
 * <VoiceCapture state={recording ? "listening" : "idle"}
 *   onStart={start} onStop={stop} hint={recording ? mmss : "Speak in any language"}
 *   languageControl={<LanguageToggle value={lang} onValueChange={setLang} />} />
 */
export const VoiceCapture = React.forwardRef(
  (
    {
      className,
      state = "idle",
      onStart,
      onStop,
      disabled = false,
      disabledReason,
      hint,
      size = "lg",
      languageControl,
      ...props
    },
    ref
  ) => {
    const listening = state === "listening";
    const processing = state === "processing";
    const isDisabled = disabled || processing;
    const s = SIZES[size] || SIZES.lg;

    const label = processing
      ? "Processing your recording"
      : listening
        ? "Stop recording and transcribe"
        : "Start recording a decision";

    return (
      <div className={cn("flex flex-col items-center text-center", className)} {...props}>
        <button
          ref={ref}
          type="button"
          aria-label={label}
          aria-pressed={listening}
          title={disabled ? disabledReason : label}
          disabled={isDisabled}
          onClick={listening ? onStop : onStart}
          className={cn(
            "inline-flex items-center justify-center rounded-pill transition-colors",
            "focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background",
            s.button,
            // Processing is non-interactive but KEEPS the primary fill — the same
            // rule as Button's loading state. A mic that turns grey the moment
            // it starts transcribing reads as "this broke", not "this is working".
            disabled
              ? "cursor-not-allowed bg-surface-sunken text-text-disabled"
              : "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active",
            // Motion, not hue: listening is not an error, so it never turns red.
            listening && !isDisabled && "recording-pulse"
          )}
        >
          {processing ? (
            <CircleNotch size={s.icon} weight="bold" className="animate-spin" />
          ) : listening ? (
            <Stop size={s.icon} weight="fill" />
          ) : (
            <Microphone size={s.icon} weight="fill" />
          )}
        </button>

        <p className={cn("mt-4 text-body-strong", disabled ? "text-text-disabled" : "text-text")}>
          {processing ? "Thinking…" : listening ? "Listening…" : "Tap to speak a decision"}
        </p>

        {(hint || (disabled && disabledReason)) && (
          <p className="mt-1 text-small text-text-tertiary">{disabled ? disabledReason : hint}</p>
        )}

        {languageControl && <div className="mt-4">{languageControl}</div>}
      </div>
    );
  }
);
VoiceCapture.displayName = "VoiceCapture";

/**
 * Language toggle for capture: Auto / EN / Tamil / Tanglish.
 *
 * "Auto" leads and is the default, because asking someone to declare their
 * language before they have spoken is a tax on the common case. The others are
 * an escape hatch for when detection gets it wrong.
 *
 * @typedef {object} LanguageToggleProps
 * @property {string} value
 * @property {(next: string) => void} onValueChange
 * @property {Array<{value: string, label: string}>} [options]
 * @property {boolean} [disabled=false]
 *
 * @example
 * <LanguageToggle value={lang} onValueChange={setLang} />
 */
export const CAPTURE_LANGUAGES = [
  { value: "auto", label: "Auto" },
  { value: "en", label: "English" },
  { value: "ta", label: "தமிழ்" },
  { value: "tanglish", label: "Tanglish" },
];

export const LanguageToggle = React.forwardRef(
  ({ className, value = "auto", onValueChange, options = CAPTURE_LANGUAGES, disabled = false, ...props }, ref) => (
    <div
      ref={ref}
      role="group"
      aria-label="Capture language"
      className={cn("inline-flex items-center gap-1 rounded-pill bg-surface-sunken p-1", className)}
      {...props}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onValueChange?.(o.value)}
            className={cn(
              "h-7 rounded-pill px-3 text-small font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ring",
              selected ? "bg-surface text-primary-text shadow-xs" : "text-text-secondary hover:text-text",
              disabled && "pointer-events-none text-text-disabled"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  )
);
LanguageToggle.displayName = "LanguageToggle";
