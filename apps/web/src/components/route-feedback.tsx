"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export function RouteFeedback() {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setPending(false);
    document.documentElement.classList.remove("route-pending");
  }, [pathname]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("http") || anchor.target) return;
      setPending(true);
      document.documentElement.classList.add("route-pending");
    }

    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, []);

  return <div className={pending ? "route-progress active" : "route-progress"} aria-hidden="true" />;
}
