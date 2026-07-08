export function siteUrl(path = "") {
  const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || "https://funblue.xyz";
  const origin = configured.replace(/\/$/, "");
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}
