"use client";

import { useEffect, useRef } from "react";

const NAVIGATION_FALLBACK_MS = 1_200;

/**
 * Keeps internal links usable if an App Router transition is interrupted by a
 * stale RSC request, a restored browser tab or a client-side provider. Normal
 * Next.js navigation remains untouched; only a transition that did not change
 * the URL is retried as a regular browser navigation.
 */
export function NavigationRecovery() {
  const fallbackTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    function clearFallback() {
      window.clearTimeout(fallbackTimer.current);
      fallbackTimer.current = undefined;
    }

    function onClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (anchor.target || anchor.hasAttribute("download")) return;

      const destination = new URL(anchor.href, window.location.href);
      const currentUrl = window.location.href;
      if (destination.origin !== window.location.origin || destination.href === currentUrl) return;

      clearFallback();
      fallbackTimer.current = window.setTimeout(() => {
        if (window.location.href === currentUrl) window.location.assign(destination.href);
      }, NAVIGATION_FALLBACK_MS);
    }

    window.addEventListener("click", onClick, true);
    window.addEventListener("pagehide", clearFallback);
    window.addEventListener("popstate", clearFallback);
    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("pagehide", clearFallback);
      window.removeEventListener("popstate", clearFallback);
      clearFallback();
    };
  }, []);

  return null;
}
