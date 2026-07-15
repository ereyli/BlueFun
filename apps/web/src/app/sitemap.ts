import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/launch", "/docs", "/transparency", "/risk", "/terms", "/privacy"].map((path) => ({ url: siteUrl(path), changeFrequency: path === "/" ? "hourly" : "monthly", priority: path === "/" ? 1 : path === "/docs" ? 0.8 : 0.5 }));
}
