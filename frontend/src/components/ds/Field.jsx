import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Label + control + helper/error wrapper shared by every input in the system.
 *
 * Error styling is deliberately centralised here rather than duplicated per
 * control: red appears as a border and the helper text, and nowhere else. An
 * errored field does not turn its label red, tint its background, or add an
 * alarm icon — red is danger, and a field awaiting correction is a small,
 * local claim.
 *
 * The generated id is threaded to the control and to aria-describedby, so the
 * helper text is announced with the field.
 *
 * @typedef {object} FieldProps
 * @property {string} [label]
 * @property {string} [helper] Guidance shown when there is no error.
 * @property {string} [error] Error message. Presence switches the field to its error state.
 * @property {boolean} [required=false]
 * @property {boolean} [disabled=false]
 * @property {string} [className]
 * @property {(ctl: {id: string, describedBy: string|undefined, invalid: boolean, disabled: boolean}) => React.ReactNode} children
 *
 * @example
 * <Field label="Directive" error={errors.text}>
 *   {(ctl) => <Textarea {...ctl} placeholder="Tell sales to send the revised quote" />}
 * </Field>
 */
export function Field({ label, helper, error, required = false, disabled = false, className, children }) {
  const id = React.useId();
  const messageId = `${id}-message`;
  const message = error || helper;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label
          htmlFor={id}
          className={cn("text-label uppercase", disabled ? "text-text-disabled" : "text-text-secondary")}
        >
          {label}
          {required && <span className="ml-1 text-text-tertiary">*</span>}
        </label>
      )}

      {children({ id, describedBy: message ? messageId : undefined, invalid: Boolean(error), disabled })}

      {message && (
        <p
          id={messageId}
          className={cn("text-small", error ? "text-destructive-text" : "text-text-tertiary")}
          role={error ? "alert" : undefined}
        >
          {message}
        </p>
      )}
    </div>
  );
}

/**
 * Shared control chrome. Every input in the set reads from this so focus,
 * error and disabled are identical across text, textarea and select.
 * Focus is a 2px indigo ring; disabled is a neutral surface, never a pale tint.
 */
export const controlBase = [
  "w-full rounded-md border bg-surface text-body text-text",
  "placeholder:text-text-tertiary",
  "transition-colors",
  "focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ring focus-visible:border-primary",
  "disabled:bg-surface-sunken disabled:text-text-disabled disabled:cursor-not-allowed disabled:border-hairline",
];

/** Border colour by validity — red border is the only chrome an error changes. */
export const controlBorder = (invalid) => (invalid ? "border-destructive-line" : "border-hairline-strong");
