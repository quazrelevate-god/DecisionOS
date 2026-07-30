import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Company Brain terminal block.
 *
 * DARK IN BOTH THEMES, and the only place monospace appears anywhere in the
 * system — the lint rule allowlists this file by name and nothing else.
 *
 * The darkness and the monospace are doing the same job: marking this as
 * machine output with citations rather than product chrome. Grounded rows are
 * aligned key/value pairs precisely because alignment is what makes numbers
 * comparable at a glance, which is the whole point of showing them.
 *
 * Confidence and citations are stated, not implied. A model answer with no
 * visible provenance is indistinguishable from a guess.
 */

/**
 * @typedef {object} TerminalRow
 * @property {string} key
 * @property {string} value
 * @property {string} [note] Secondary detail, e.g. "due Aug 01" or "negotiable".
 *
 * @typedef {object} TerminalBlockProps
 * @property {string} [label='Company Brain / grounded output']
 * @property {TerminalRow[]} rows
 * @property {number} [confidence] 0–1.
 * @property {number} [sourceCount]
 * @property {React.ReactNode} [footer]
 * @property {boolean} [loading=false]
 *
 * @example
 * <TerminalBlock
 *   rows={[
 *     { key: "cash_position", value: "₹18,42,300" },
 *     { key: "payroll_run", value: "₹12,10,000", note: "due Aug 01" },
 *   ]}
 *   confidence={0.92}
 *   sourceCount={3}
 * />
 */
export const TerminalBlock = React.forwardRef(
  (
    {
      className,
      label = "Company Brain / grounded output",
      rows = [],
      confidence,
      sourceCount,
      footer,
      loading = false,
      ...props
    },
    ref
  ) => {
    const keyWidth = Math.max(0, ...rows.map((r) => r.key.length));

    return (
      <div
        ref={ref}
        className={cn("rounded-lg border border-terminal-hairline bg-terminal p-5", className)}
        {...props}
      >
        <p className="mb-3 text-label uppercase text-terminal-label">{label}</p>

        {loading ? (
          <p className="font-mono text-code text-terminal-fg-dim">Thinking…</p>
        ) : (
          <dl className="font-mono text-code">
            {rows.map((r) => (
              <div key={r.key} className="flex gap-4">
                <dt className="shrink-0 text-terminal-fg-dim" style={{ minWidth: `${keyWidth}ch` }}>
                  {r.key}
                </dt>
                <dd className="min-w-0 text-terminal-fg">
                  {r.value}
                  {r.note && <span className="text-terminal-fg-dim"> · {r.note}</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {(typeof confidence === "number" || typeof sourceCount === "number") && (
          <p className="mt-3 border-t border-terminal-hairline pt-3 font-mono text-code text-terminal-fg-dim">
            <span data-numeric className="tabular-nums">
              {typeof confidence === "number" && `confidence ${confidence.toFixed(2)}`}
              {typeof confidence === "number" && typeof sourceCount === "number" && " · "}
              {typeof sourceCount === "number" &&
                `${sourceCount} cited source${sourceCount === 1 ? "" : "s"}`}
            </span>
          </p>
        )}

        {footer && <div className="mt-3">{footer}</div>}
      </div>
    );
  }
);
TerminalBlock.displayName = "TerminalBlock";
