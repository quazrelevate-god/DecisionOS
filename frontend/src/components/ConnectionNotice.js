/* 2026-10-03 — SAY "OFFLINE" BEFORE THEY PRESS SAVE, NOT AFTER.
 *
 * The connection could drop under an open app with nothing on screen saying
 * so. The first a founder heard of it was a failed save, after the typing was
 * done. B04's CantReachUs covers opening the app with no signal; this covers
 * losing it mid-use.
 *
 * A pill, fixed at the top and out of the layout's flow, so nothing on the
 * page jumps when it appears. It reads the device's own `online` flag, which
 * is the earliest signal there is; when a request goes unanswered while the
 * device still claims to be online (a captive Wi-Fi), the toast that failure
 * raises carries the reason instead (lib/api connectionTrouble).
 *
 * Coming back gets one short "Back online" so the founder knows the pill
 * left because it is fixed, not because they scrolled past it — and react-
 * query's refetchOnReconnect is already refreshing what is on screen.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { WifiSlash } from "@phosphor-icons/react";
import { TopNotice, NoticePill } from "./TopNotice";

const deviceOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

export function ConnectionNotice() {
  const [online, setOnline] = useState(deviceOnline);
  const wasOffline = useRef(!deviceOnline());

  useEffect(() => {
    const goOffline = () => { wasOffline.current = true; setOnline(false); };
    const goOnline = () => {
      setOnline(true);
      if (wasOffline.current) {
        wasOffline.current = false;
        toast.success("Back online", { id: "connection-back", duration: 2500 });
      }
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (online) return null;
  // 2026-10-12 — first in the top-notice stack, so a stale-data pill sits under it rather than on it.
  return (
    <TopNotice order={0}>
      <NoticePill icon={WifiSlash} testid="connection-offline">
        You&rsquo;re offline. Changes won&rsquo;t save until you&rsquo;re back.
      </NoticePill>
    </TopNotice>
  );
}

export default ConnectionNotice;
