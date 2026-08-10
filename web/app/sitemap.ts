import type { MetadataRoute } from "next";

// Fixes the recurring 404 for /sitemap.xml seen in the App Hosting logs — same mechanism as
// robots.ts, Next.js serves this automatically at the real /sitemap.xml path. Only lists pages
// that are actually public and useful for a search engine to index; everything behind login
// (home, me, messages, admin) or user/post-specific (dynamic [userId]/[postId] pages) is left
// out on purpose.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://astryks.com";
  const routes = ["", "/login", "/signup", "/prize-rules", "/prizes", "/terms", "/privacy", "/support"];

  return routes.map((route) => ({
    url: `${base}${route}`,
    lastModified: new Date(),
  }));
}
