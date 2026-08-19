// Fixed pseudo-account uids used by functions/index.js's sendPrizeBotMessage/sendSupportMessage
// (see PRIZE_BOT_UID/SUPPORT_UID there) — these aren't real Firebase Auth users, so there's no
// photoURL to look up for them the way there is for a real participant. Anywhere the Messages UI
// needs to tell "a real person" apart from "Astryks itself", check against this list.
export const BOT_UIDS = ["astryks-prizes", "astryks-support"];
