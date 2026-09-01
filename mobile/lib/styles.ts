import { StyleSheet } from "react-native";

// Shared color palette and base styles for the mobile app — mirrors the web app's Tailwind
// theme (Astryks-GitHub/web/tailwind.config.ts) so both platforms feel like the same product.
//
// This file was missing entirely from the delivered mobile app (every screen under app/ imports
// `{ styles, colors }` from here, so without it the app cannot bundle at all — this isn't a
// cosmetic gap, it's the reason the app wouldn't build). Values below are reconstructed to match
// the web app's palette exactly, plus a `muted` gray for secondary text (the mobile-only
// equivalent of the web app's `text-ink/50`/`text-ink/60` opacity classes, since React Native
// style objects don't support Tailwind's opacity-suffix color syntax).
export const colors = {
  ink: "#17130F",
  paper: "#F7F1E5",
  line: "#242426",
  accent: "#E8E6E1",
  brand: "#E85D5D",
  brandDark: "#C94A4A",
  brandLight: "#FFF6F1",
  // Subject accents — pastel green for Music, pastel purple for Art (previously brand
  // red/vivid purple, matched to web's Tailwind theme; mobile now diverges deliberately here).
  music: "#6FA184",
  musicLight: "#E1F0E6",
  art: "#9B87C4",
  artLight: "#EEEAF7",
  teal: "#3FC1B0",
  tealLight: "#DFF5F1",
  highlight: "#EFC13B",
  // astryks.com section background tints
  sectionRose: "#F7DEDB",
  sectionSky: "#DCE6F2",
  sectionLavender: "#E4DEF3",
  sectionMint: "#DEF0E3",
  // Secondary/placeholder text — the mobile equivalent of the web app's `text-ink/50` opacity
  // classes, since RN style objects need a concrete color rather than an opacity modifier.
  muted: "#8A8A8D",
  // Learn screen's lesson-timeline palette — a dusty blue/warm-sand pair instead of the brand
  // red/teal combo, so completed vs. up-next vs. not-yet-reached reads as one soft, neutral
  // gradient rather than three unrelated brand colors competing for attention.
  learnWatched: "#5D7A99",
  learnCurrent: "#C9974F",
  learnCurrentText: "#8A6023",
  learnLocked: "#F3ECDD",
  learnLockedBorder: "#E4D3AC",
};

export const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
    backgroundColor: colors.paper,
  },
  title: {
    fontSize: 27,
    fontWeight: "800",
    color: colors.ink,
    textAlign: "center",
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line + "33", // ~20% opacity, matching the web app's border-line/20/30
    backgroundColor: "white",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    color: colors.ink,
    marginBottom: 12,
  },
  error: {
    color: "#DC2626",
    fontSize: 15,
    marginBottom: 12,
    textAlign: "center",
  },
  buttonPrimary: {
    backgroundColor: colors.brand,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  buttonPrimaryText: {
    color: "white",
    fontSize: 18,
    fontWeight: "700",
  },
  link: {
    color: colors.ink,
    opacity: 0.6,
    fontSize: 15,
    textAlign: "center",
  },
});
