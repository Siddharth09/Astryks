// Fixed pseudo-account uids used by functions/index.js's sendHallOfFameBotMessage/
// sendPrizeBotMessage/sendSupportMessage (see HALL_OF_FAME_BOT_UID/PRIZE_BOT_UID/SUPPORT_UID
// there) — these aren't real Firebase Auth users, so there's no photoURL to look up for them the
// way there is for a real participant. Anywhere the Messages UI needs to tell "a real person"
// apart from "Astryks itself", check against this list. "astryks-prizes" stays here even though
// the Creative Prize is retired — old conversations with that bot still exist in message history.
export const BOT_UIDS = ["astryks-hall-of-fame", "astryks-prizes", "astryks-support"];
