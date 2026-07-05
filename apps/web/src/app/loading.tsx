export default function Loading() {
  return (
    <section className="loading-shell" aria-label="Loading">
      <div className="loading-hero" />
      <div className="loading-grid">
        {Array.from({ length: 8 }).map((_, index) => (
          <div className="loading-card" key={index} />
        ))}
      </div>
    </section>
  );
}
