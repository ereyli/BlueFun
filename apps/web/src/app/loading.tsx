export default function Loading() {
  return (
    <section className="loading-shell terminal-route-loading" aria-label="Loading application data">
      <div className="terminal-route-loading-mark" aria-hidden="true">B20</div>
      <div className="terminal-route-loading-copy">
        <span>ONCHAIN WORKSPACE</span>
        <strong>Loading verified data</strong>
        <small>Reading the latest indexed state…</small>
      </div>
      <span className="terminal-route-loading-track" aria-hidden="true"><i /></span>
    </section>
  );
}
