// The banners of the open Space (spec 2.24, audit Threads 1): my unseen Interrupt notifications, read live, raise a banner as they arrive (a reply, a mention, a direct message, an
// approval). Pressing a banner, or its Reply, opens what it is about and marks it seen; a reply thread opens beside its message, with the composer under it.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { LiveQuery } from "../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../generated/types.ts";
import { NotificationBanners } from "./Banners.tsx";
import { BANNER_QUERY, BannerStack, arrivals, bannerTarget } from "./model.ts";
import type { Notification } from "./model.ts";

type ListOut = CapMap["notifications.list"]["out"];

export interface NotificationsHostProps {
  query(cap: string, input: Record<string, unknown>): LiveQuery<ListOut>;
  call(cap: string, input: unknown): Promise<unknown>;
  open(target: { subject?: { type: string; id: string }; place?: string }): void;
}

export function NotificationsHost({ query, call, open }: NotificationsHostProps): ReactElement | null {
  const [stack] = useState(() => new BannerStack());
  const known = useRef<Map<string, number> | null>(null);
  useEffect(() => {
    const q = query("notifications.list", BANNER_QUERY);
    const read = (): void => {
      const s = q.getSnapshot();
      if (s.status !== "ready") return;
      const got = arrivals(known.current, s.data.notifications);
      known.current = got.known;
      for (const n of got.raise) stack.push(n);
    };
    const off = q.subscribe(read);
    read();
    return off;
  }, [query, stack]);
  const settle = (n: Notification): void => {
    void Promise.resolve(call("notifications.mark_seen", { notificationIds: [n.id] })).catch(() => undefined);   // a banner already went; a seen mark that fails only leaves the row unseen
    open(bannerTarget(n));
  };
  return <NotificationBanners stack={stack} onOpen={settle} onAction={(n) => settle(n)} />;
}
