import Link from "next/link";

export default function NotFound() {
  return <section className="error-state"><span>404</span><h1>Market not found.</h1><p>The launch may not exist on the selected network or may still be indexing.</p><Link className="button primary" href="/">Explore launches</Link></section>;
}
