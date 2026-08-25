// Single place for "is this the Astryks team" — used by client-side UI checks (e.g. showing a
// Delete button on someone else's post). This is a convenience/visibility check ONLY: the
// deletePost Cloud Function independently re-checks this same email server-side too (see
// ADMIN_EMAILS in functions/index.js), so this constant existing in two places is deliberate —
// keep them in sync if the admin email ever changes.
export const ADMIN_EMAILS = ["mehta.siddharth09@gmail.com"];

export function isAdmin(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email);
}
