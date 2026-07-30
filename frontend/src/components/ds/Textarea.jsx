import * as React from "react";
import { cn } from "@/lib/utils";
import { controlBase, controlBorder } from "./Field";

/**
 * Multi-line input. Placeholders are sentence case, written as an example of
 * the thing being asked for rather than an instruction.
 *
 * @typedef {object} TextareaProps
 * @property {string} [id]
 * @property {boolean} [invalid=false]
 * @property {string} [describedBy]
 * @property {number} [rows=4]
 * @property {boolean} [disabled=false]
 * @property {string} [className]
 *
 * @example
 * <Field label="Type a directive" error={err}>
 *   {(ctl) => <Textarea {...ctl} rows={4}
 *     placeholder="Tell sales to send the revised quote to the Delhi retailer by Friday." />}
 * </Field>
 */
export const Textarea = React.forwardRef(
  ({ className, invalid = false, describedBy, rows = 4, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={cn(controlBase, controlBorder(invalid), "px-3 py-2.5 resize-y min-h-24", className)}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";
