// Small hand-drawn SVG icon set used across the nav components.
// Deliberately avoids Unicode symbol/emoji characters (✳ ⌂ ◈ ✉ ○) for the nav —
// several of those render as full-color emoji glyphs on some platforms (e.g. a
// green sparkle), which looked like a distorted "green box" in the header.
// Plain currentColor SVGs render identically everywhere.

export function IconMark({ className }: { className?: string }) {
  // The actual Astryks logo mark (white burst on black).
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo-mark.png" alt="" className={className} />;
}

export function IconHome({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M4 11.5 12 4l8 7.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 10v9a1 1 0 0 0 1 1h3v-5.5a2 2 0 0 1 2-2v0a2 2 0 0 1 2 2V20h3a1 1 0 0 0 1-1v-9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconLearn({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M12 3.5 20.5 12 12 20.5 3.5 12 12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconMessages({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="m4.5 7 7.5 6 7.5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconMe({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <circle cx="12" cy="8.2" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5 19c1-3.2 3.8-5 7-5s6 1.8 7 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
