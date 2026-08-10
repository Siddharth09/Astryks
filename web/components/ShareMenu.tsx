"use client";

import { useEffect, useRef, useState } from "react";

// A "···" overflow menu for sharing a post: Facebook and WhatsApp have real web share-intent
// URLs, so those go straight out as plain links. Instagram and TikTok don't offer any public
// "share this link" URL you can just open (the only way onto their apps is the OS-level native
// share sheet), so on phones we surface that instead via the Web Share API (navigator.share) —
// that sheet lists Instagram/TikTok/Messages/Mail/whatever's installed automatically, no
// per-app integration needed. Desktop browsers mostly don't implement navigator.share, so there
// "Copy link" (with a nudge to paste it into IG/TikTok directly) is the fallback.
//
// Deliberately just a plain https://astryks.com/post/{id} URL, never a custom app:// scheme —
// that's what makes "someone without the app taps this link" fall through to a normal browser
// tab instead of erroring out on a dead deep link. If the mobile app later adds iOS Universal
// Links / Android App Links for this same domain, tapping it on a phone that HAS the app can
// additionally jump straight into the app — but the plain URL means it always degrades
// gracefully to the browser either way, with no extra work required here.
export default function ShareMenu({ postId, title }: { postId: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const url = `https://astryks.com/post/${postId}`;
  const shareText = title ? `${title} — on Astryks` : "Check this out on Astryks";

  useEffect(() => {
    setCanNativeShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable (very old browser, or blocked by permissions) —
      // fall back to just showing the link so it can still be copied by hand.
      // eslint-disable-next-line no-alert
      alert(url);
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title: shareText, url });
      setOpen(false);
    } catch {
      // User backed out of the OS share sheet, or the browser blocked it — either way, no-op.
    }
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label="Share this post"
        title="Share"
        className="hover:text-ink text-lg leading-none px-1.5 py-0.5 rounded-md hover:bg-paper transition-colors"
      >
        ⋯
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 bottom-full mb-2 w-56 bg-white border border-line/15 rounded-xl shadow-lg overflow-hidden z-20 text-sm text-ink"
        >
          {canNativeShare && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                nativeShare();
              }}
              className="w-full text-left px-4 py-2.5 hover:bg-paper flex items-center gap-2.5"
            >
              <span>📤</span> Share…
            </button>
          )}
          <a
            href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            className="w-full text-left px-4 py-2.5 hover:bg-paper flex items-center gap-2.5"
          >
            <span>📘</span> Facebook
          </a>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${url}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            className="w-full text-left px-4 py-2.5 hover:bg-paper flex items-center gap-2.5"
          >
            <span>💬</span> WhatsApp
          </a>
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              copyLink();
            }}
            className="w-full text-left px-4 py-2.5 hover:bg-paper flex items-center gap-2.5 border-t border-line/10"
          >
            <span>🔗</span> {copied ? "Link copied!" : "Copy link"}
          </button>
          <p className="px-4 py-2 text-[11px] text-ink/40 border-t border-line/10 leading-snug">
            {canNativeShare
              ? "Instagram or TikTok not listed above? Tap \"Share…\" — they'll show up there if installed."
              : "Instagram and TikTok don't support sharing a link directly from a browser — copy the link and paste it into your story, bio, or a DM instead."}
          </p>
        </div>
      )}
    </div>
  );
}
