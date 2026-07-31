"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function RouteFeedback() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);
  const startedAt = useRef(0);
  const safetyTimer = useRef<number | undefined>(undefined);
  const routeKey = `${pathname}?${searchParams.toString()}`;

  useEffect(() => {
    if (!pending) return;
    const elapsed = Date.now() - startedAt.current;
    const timer = window.setTimeout(() => {
      setPending(false);
      document.documentElement.classList.remove("route-pending");
      document.querySelector(".route-loading-overlay")?.classList.remove("active");
      document.querySelector(".route-loading-overlay")?.setAttribute("aria-hidden", "true");
    }, Math.max(0, 180 - elapsed));
    return () => window.clearTimeout(timer);
  }, [pending, routeKey]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest<HTMLAnchorElement>("a");
      if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || anchor.target || anchor.hasAttribute("download")) return;
      const destination = new URL(href, window.location.href);
      if (destination.origin !== window.location.origin || destination.href === window.location.href) return;
      startedAt.current = Date.now();
      setPending(true);
      document.documentElement.classList.add("route-pending");
      document.querySelector(".route-loading-overlay")?.classList.add("active");
      document.querySelector(".route-loading-overlay")?.setAttribute("aria-hidden", "false");
      window.clearTimeout(safetyTimer.current);
      safetyTimer.current = window.setTimeout(() => {
        setPending(false);
        document.documentElement.classList.remove("route-pending");
        document.querySelector(".route-loading-overlay")?.classList.remove("active");
        document.querySelector(".route-loading-overlay")?.setAttribute("aria-hidden", "true");
      }, 10_000);
    }

    function onHistoryNavigation() {
      startedAt.current = Date.now();
      setPending(true);
      document.documentElement.classList.add("route-pending");
      document.querySelector(".route-loading-overlay")?.classList.add("active");
      document.querySelector(".route-loading-overlay")?.setAttribute("aria-hidden", "false");
    }

    window.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onHistoryNavigation);
    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onHistoryNavigation);
      window.clearTimeout(safetyTimer.current);
      document.documentElement.classList.remove("route-pending");
    };
  }, []);

  return <>
    <div className={pending ? "route-progress active" : "route-progress"} aria-hidden="true" />
    <div className={pending ? "route-loading-overlay active" : "route-loading-overlay"} aria-hidden={!pending} aria-live="polite" role="status">
      <div className="route-loading-card">
        <span className="route-loading-spinner" aria-hidden="true" />
        <span><strong>Loading workspace</strong><small>Preparing verified onchain data…</small></span>
      </div>
    </div>
  </>;
}
