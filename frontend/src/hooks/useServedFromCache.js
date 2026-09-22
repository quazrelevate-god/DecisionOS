/* JOURNEY-1 J13 — "are the numbers on this screen the phone's saved copy?"
 *
 * Returns the time the oldest of the screen's answers was saved, when the
 * service worker served them from its cache because the network was slow or
 * gone, and null when everything came from the server. See lib/api.js. */
import { useEffect, useState } from "react";
import { cachedSince, onCacheChange } from "../lib/api";

export function useServedFromCache(prefixes) {
  const key = prefixes.join("|");
  const [at, setAt] = useState(() => cachedSince(prefixes));
  useEffect(() => {
    const list = key.split("|");
    const read = () => setAt(cachedSince(list));
    read();
    return onCacheChange(read);
  }, [key]);
  return at;
}

export default useServedFromCache;
