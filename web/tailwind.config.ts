import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17130F",
        paper: "#F7F1E5",
        line: "#242426",
        accent: "#E8E6E1",
        brand: "#E85D5D",
        brandDark: "#C94A4A",
        brandLight: "#FFF6F1",
        // astryks.com subject accents
        music: "#E85D5D",
        musicLight: "#FBE3DF",
        art: "#8B7FE8",
        artLight: "#EDEAFB",
        finance: "#3FC1B0",
        financeLight: "#DFF5F1",
        highlight: "#EFC13B",
        // astryks.com section background tints
        sectionRose: "#F7DEDB",
        sectionSky: "#DCE6F2",
        sectionLavender: "#E4DEF3",
        sectionMint: "#DEF0E3",
      },
      fontFamily: {
        display: ["var(--font-display)"],
        body: ["var(--font-body)"],
      },
    },
  },
  plugins: [],
};
export default config;
