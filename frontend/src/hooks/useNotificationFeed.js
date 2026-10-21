/* Epic 12 (2026-10-22) — one side of the notifications, paged.
 *
 * "unread" is New, "read" is History. Each page asks the server for the next
 * slice older than the last row it has (GET /api/notifications?status=&before=),
 * so History reaches back to the very first notification instead of stopping
 * at the newest 100 the plain list returns. The keys sit under ["notifications"],
 * so everything that already refreshes notifications (the pulse, a decision,
 * a task) refreshes these too.
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import api from "../lib/api";

const PAGE = 30;

export function useNotificationFeed(status, { refetchInterval } = {}) {
  return useInfiniteQuery({
    queryKey: ["notifications", status],
    queryFn: ({ pageParam }) => api.get("/notifications", {
      params: { status, limit: PAGE, ...(pageParam ? { before: pageParam } : {}) },
    }).then((r) => r.data),
    initialPageParam: null,
    getNextPageParam: (last) => (last?.has_more && last.notifications?.length
      ? last.notifications[last.notifications.length - 1].created_at : undefined),
    refetchInterval,
  });
}

export const feedItems = (data) => (data?.pages || []).flatMap((p) => p.notifications || []);
