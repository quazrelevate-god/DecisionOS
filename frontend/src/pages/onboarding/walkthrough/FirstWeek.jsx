/* "See it in DecisionOS": the new company's first week, played inside the
 * app (Player + the scene templates in scenes.jsx), on the device they signed
 * up on — and a switch for the other. Everything in it is filled from their
 * draft at render time: no extra request, so it is ready the moment the draft
 * is. */
import { useMemo, useState } from "react";
import { Desktop, DeviceMobile } from "@phosphor-icons/react";
import { Player } from "./Player";
import { buildScenes } from "./scenes";
import { buildJourney } from "./journey";
import { cn } from "../../../lib/utils";

export function FirstWeek({ company, founder, bp, pipelines, device = "desktop" }) {
  const [dev, setDev] = useState(device);
  const journey = useMemo(() => buildJourney({ company, founder, bp, pipelines }), [company, founder, bp, pipelines]);
  const scenes = useMemo(() => buildScenes(journey, dev), [journey, dev]);
  return (
    <div>
      <div className="mb-4 flex justify-center">
        <div className="flex rounded-full bg-white/70 p-1 ring-1 ring-inset ring-white shadow-[0_8px_20px_-14px_hsl(230_30%_18%/.5)]" role="group" aria-label="Show it on">
          {[["desktop", "Desktop", Desktop], ["phone", "Phone", DeviceMobile]].map(([k, label, Icon]) => (
            <button key={k} type="button" onClick={() => setDev(k)} aria-pressed={dev === k} data-testid={`first-week-device-${k}`}
              className={cn("flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-colors",
                dev === k ? "bg-[hsl(230_15%_12%)] text-white" : "text-slate-600 hover:text-slate-900")}>
              <Icon size={15} weight={dev === k ? "fill" : "regular"} aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
      </div>
      <Player key={dev} scenes={scenes} device={dev} testid="first-week" />
    </div>
  );
}

export default FirstWeek;
