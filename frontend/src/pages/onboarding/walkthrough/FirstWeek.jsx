/* "See it in DecisionOS": the new company's first week, played inside the
 * app. On the summary it is a poster — a still of the tour itself — and a
 * Play that opens it full screen (2026-10-30, founder: "the actual desktop
 * interface, full screen… so it convinces"). Desktop chapters wear the app's
 * own parts (desktop.jsx); the phone's are the phone app (scenes.jsx). It
 * opens on the device they signed up on, with a switch for the other.
 * Everything in it is filled from their draft at render time — no request of
 * its own, so it is ready the moment the draft is.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Desktop, DeviceMobile, Play } from "@phosphor-icons/react";
import { Player, Still, SCREEN } from "./Player";
import { buildScenes } from "./scenes";
import { desktopScenes } from "./desktop";
import { buildJourney } from "./journey";
import { cn } from "../../../lib/utils";

function DeviceSwitch({ dev, setDev }) {
  return (
    <div className="flex shrink-0 rounded-full bg-white/80 p-1 ring-1 ring-inset ring-white shadow-[0_8px_20px_-14px_hsl(230_30%_18%/.5)]" role="group" aria-label="Show it on">
      {[["desktop", "Desktop", Desktop], ["phone", "Phone", DeviceMobile]].map(([k, label, Icon]) => (
        <button key={k} type="button" onClick={() => setDev(k)} aria-pressed={dev === k} data-testid={`first-week-device-${k}`}
          className={cn("flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-colors",
            dev === k ? "bg-[hsl(230_15%_12%)] text-white" : "text-slate-600 hover:text-slate-900")}>
          <Icon size={15} weight={dev === k ? "fill" : "regular"} aria-hidden="true" /> {label}
        </button>
      ))}
    </div>
  );
}

export function FirstWeek({ company, founder, bp, pipelines, device = "desktop" }) {
  const [dev, setDev] = useState(device);
  const [open, setOpen] = useState(false);
  const journey = useMemo(() => buildJourney({ company, founder, bp, pipelines }), [company, founder, bp, pipelines]);
  const scenes = useMemo(() => (dev === "desktop" ? desktopScenes(journey) : buildScenes(journey, "phone")), [journey, dev]);
  const secs = Math.round(scenes.reduce((k, s) => k + s.ms, 0) / 1000);

  // The poster is the tour's own first chapter, standing still.
  const poster = useRef(null);
  const [pw, setPw] = useState(0);
  useLayoutEffect(() => {
    const el = poster.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setPw(e.contentRect.width));
    ro.observe(el);
    setPw(el.clientWidth);
    return () => ro.disconnect();
  }, [dev]);
  const size = SCREEN[dev];

  const play = () => {
    setOpen(true);
    // Full screen where the browser allows it; the player fills the window either way.
    try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch { /* not offered */ }
  };
  const close = () => {
    setOpen(false);
    try { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); } catch { /* not offered */ }
  };

  return (
    <div>
      <div className="mb-4 flex justify-center"><DeviceSwitch dev={dev} setDev={setDev} /></div>
      <button type="button" onClick={play} data-testid="first-week-poster"
        className={cn("group relative mx-auto block w-full overflow-hidden bg-[hsl(225_8%_92%)] shadow-[0_30px_70px_-34px_hsl(230_30%_10%/.6)] ring-1 ring-inset ring-white",
          dev === "phone" ? "max-w-[20rem] rounded-[2.2rem]" : "max-w-5xl rounded-[1.5rem]")}
        style={{ aspectRatio: `${size.w} / ${size.h}` }} aria-label={`Watch your first week on DecisionOS, about ${secs} seconds`}>
        <span ref={poster} className="absolute inset-0">
          {pw > 0 && <Still scene={scenes[0]} p={0.95} device={dev} fit={pw / size.w} />}
        </span>
        <span className="absolute inset-0 grid place-items-center bg-slate-900/25 transition-colors group-hover:bg-slate-900/15">
          <span className="flex flex-col items-center gap-3">
            <span className="grid h-20 w-20 place-items-center rounded-full bg-white text-slate-900 shadow-[0_18px_40px_-14px_hsl(230_30%_5%/.6)] transition-transform group-hover:scale-105">
              <Play size={30} weight="fill" />
            </span>
            <span className="rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm">
              Watch your first week · {secs < 90 ? `${secs} sec` : `${Math.round(secs / 60)} min`}
            </span>
          </span>
        </span>
      </button>
      {open && (
        <Player key={dev} scenes={scenes} device={dev} testid="first-week" onClose={close}
          toolbar={<DeviceSwitch dev={dev} setDev={setDev} />} />
      )}
    </div>
  );
}

export default FirstWeek;
