import { useState } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, Share, Pressable } from "react-native";
import * as Clipboard from "expo-clipboard";
import { colors } from "@/lib/styles";

// Tapping "···" opens a small sheet with two choices. "Share…" hands off straight to the OS
// share sheet (RN's built-in Share.share) — on both iOS and Android that already lists
// Facebook, WhatsApp, Instagram, TikTok, Messages, Mail, etc. automatically if they're
// installed, so there's no need to hand-build a share intent per app the way a plain website
// has to. "Copy link" is kept as its own explicit option since not every OS share sheet surfaces
// a copy action prominently.
//
// Always shares the plain https://astryks.com/post/{id} URL — never a custom astryks:// scheme.
// That's what makes a link someone received from this app open fine in a normal browser if the
// recipient doesn't have Astryks installed, while still being a completely normal link for
// anyone who does.
//
// Needs `expo-clipboard` — run `npx expo install expo-clipboard` once before rebuilding.
export default function ShareMenu({ postId, title }: { postId: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const url = `https://astryks.com/post/${postId}`;
  const shareText = title ? `${title} — on Astryks` : "Check this out on Astryks";

  async function nativeShare() {
    setOpen(false);
    try {
      // `url` is used on iOS in addition to `message`; Android's Share module ignores it and
      // only ever sends `message`, so the link needs to already be inside that string too.
      await Share.share({ message: `${shareText} ${url}`, url, title: shareText });
    } catch {
      // User backed out of the share sheet — nothing to do.
    }
  }

  async function copyLink() {
    await Clipboard.setStringAsync(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} accessibilityLabel="Share this post" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={{ fontSize: 20, color: colors.muted }}>⋯</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <TouchableOpacity style={s.option} onPress={nativeShare}>
              <Text style={s.optionIcon}>📤</Text>
              <Text style={s.optionText}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.option, s.optionBorder]} onPress={copyLink}>
              <Text style={s.optionIcon}>🔗</Text>
              <Text style={s.optionText}>{copied ? "Link copied!" : "Copy link"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.option, s.optionBorder]} onPress={() => setOpen(false)}>
              <Text style={[s.optionText, { color: colors.muted, marginLeft: 0 }]}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "white", borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 28 },
  option: { flexDirection: "row", alignItems: "center", paddingVertical: 16, paddingHorizontal: 20 },
  optionBorder: { borderTopWidth: 1, borderTopColor: colors.line + "1A" },
  optionIcon: { fontSize: 19, width: 28 },
  optionText: { fontSize: 19, color: colors.ink, marginLeft: 4 },
});
