"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("BlueFun route error", error); }, [error]);
  return <section className="error-state"><span>Something went wrong</span><h1>This page could not be loaded.</h1><p>Your wallet and funds are unaffected. Try loading the latest data again.</p><button className="button primary" onClick={reset}>Try again</button></section>;
}
