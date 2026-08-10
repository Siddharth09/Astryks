import type { MetadataRoute } from "next";

// Fixes the recurring 404s for /robots.txt seen in the App Hosting logs — this file convention
// (app/robots.ts) makes Next.js generate and serve it automatically at the real /robots.txt
// path, no manual route needed. Keeps signed-in-only areas out of it since there's nothing for
// a crawler to usefully index there anyway.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/me", "/messages", "/home"],
    },
    sitemap: "https://astryks.com/sitemap.xml",
  };
}
