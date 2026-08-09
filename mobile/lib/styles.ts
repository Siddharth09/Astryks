import { StyleSheet } from "react-native";

export const colors = {
  ink: "#17130F",
  paper: "#F7F1E5",
  line: "#E5E5E3",
  muted: "#8A8A8D",
  brand: "#E85D5D",
  brandDark: "#C94A4A",
  brandLight: "#FFF6F1",
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
};

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.paper,
    padding: 20,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.paper,
    justifyContent: "center",
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.ink,
    marginBottom: 20,
    textAlign: "center",
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    marginBottom: 12,
    backgroundColor: "white",
    color: colors.ink,
  },
  buttonPrimary: {
    backgroundColor: colors.ink,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  buttonPrimaryText: {
    color: "white",
    fontWeight: "600",
    fontSize: 15,
  },
  buttonSecondary: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 16,
    backgroundColor: "white",
  },
  buttonSecondaryText: {
    color: colors.ink,
    fontWeight: "600",
    fontSize: 15,
  },
  link: {
    color: colors.brand,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 20,
    fontSize: 14,
  },
  error: {
    color: "#DC2626",
    fontSize: 13,
    marginBottom: 8,
  },
  muted: {
    color: colors.muted,
    fontSize: 13,
  },
});
