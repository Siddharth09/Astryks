import type { MetadataRoute } from "next";

// Served automatically at /sitemap.xml. Only the public, unauthenticated pages — the logged-in
// app screens require an account and shouldn't be indexed (see robots.ts).
// Bump this whenever one of the routes below meaningfully changes — a fixed date here (rather
// than computing "now" at build time on every deploy) avoids every URL looking freshly updated
// on every single rebuild, which search engines discount as a signal.
const LAST_MODIFIED = new Date("2026-08-14");

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://astryks.com";
  const routes = ["", "/login", "/signup", "/terms", "/privacy", "/prize-rules", "/support"];
  return routes.map((route) => ({
    url: `${base}${route}`,
    lastModified: LAST_MODIFIED,
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : 0.5,
  }));
}
