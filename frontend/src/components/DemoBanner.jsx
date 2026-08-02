import { Warning } from "@phosphor-icons/react";

/**
 * The "this is not real" marker for demo builds.
 *
 * A hosted demo runs on the same fixture the design review uses — Preview
 * Industries, ₹18,42,300 of billed revenue, six pending approvals. Shown to
 * investors or prospects, those figures are one screenshot away from being
 * taken for a real customer's business. So the build that enables fake data
 * also states that it is fake, permanently and without being asked.
 *
 * Deliberately not dismissible and deliberately not scrolled away: it sits
 * above the app, in normal flow, so it is present in every screenshot anyone
 * takes. The whole point is defeated by a banner you can close.
 *
 * Caution amber, not danger red — nothing is wrong, something is being
 * disclosed. Red here would be the same misuse this system removed everywhere
 * else.
 */
export function DemoBanner() {
  if (process.env.REACT_APP_DEMO !== "1") return null;
  return (
    <div
      role="status"
      data-testid="demo-banner"
      className="flex items-center justify-center gap-2 bg-status-pending-bg text-status-pending-fg border-b-hairline px-4 py-2 text-small font-semibold"
    >
      <Warning size={15} weight="bold" className="shrink-0" />
      <span>
        Demo data — sample figures for a fictional company. Not a real business.
      </span>
    </div>
  );
}
