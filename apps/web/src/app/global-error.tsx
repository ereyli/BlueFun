"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html><body><main className="error-state"><h1>BlueFun needs a refresh.</h1><p>A temporary application error occurred.</p><button onClick={reset}>Reload application</button></main></body></html>;
}
