import type { MetadataRoute } from "next";

// Next.js serves whatever this returns at /robots.txt automatically — no separate static file
// needed. Blocks the private, logged-in-only app screens (and the admin dashboard) from being
// crawled/indexed, while leaving the public marketing/legal pages open, since those are exactly
// what you'd want to show up in search ahead of the app store launch.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/home", "/learn", "/messages", "/me", "/prizes", "/post", "/user"],
    },
    sitemap: "https://astryks.com/sitemap.xml",
  };
}
