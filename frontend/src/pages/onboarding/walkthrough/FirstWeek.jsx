/* "Your first week", played: the new company's own journey through the real
 * app (Player + scenes), as the last screen of signup. */
import { useMemo } from "react";
import { Player } from "./Player";
import { buildScenes } from "./scenes";
import { buildJourney } from "./journey";

export function FirstWeek({ company, founder, bp, pipelines, device = "desktop" }) {
  const scenes = useMemo(() => buildScenes(buildJourney({ company, founder, bp, pipelines }), device),
    [company, founder, bp, pipelines, device]);
  return <Player scenes={scenes} device={device} testid="first-week" />;
}

export default FirstWeek;
