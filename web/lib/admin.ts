// Single place for "is this the Astryks team" — used by the nav link (SideNav) so the Admin
// entry point only ever renders for your own account. This is a convenience/visibility check
// ONLY: every actual admin page independently re-checks this same email, and every admin Cloud
// Function independently checks it server-side too (see ADMIN_EMAILS in functions/index.js) —
// so even if someone guessed a /admin URL directly, both the page and the data behind it still
// refuse them. Hiding the link is just about not cluttering everyone else's nav, not security.
export const ADMIN_EMAILS = ["mehta.siddharth09@gmail.com"];

export function isAdmin(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email);
}
