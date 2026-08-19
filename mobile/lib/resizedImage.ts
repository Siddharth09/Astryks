import { useEffect, useState } from "react";
import { ref, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";

// The storage-resize-images extension (installed 2026-08-19) watches /posts uploads and writes a
// max-800x800 WebP copy alongside every new original at "<mediaPath>_800x800.webp" — original is
// never deleted. Two cases fall back to the full-res mediaUrl instead: posts uploaded before the
// extension existed (no resized copy will ever appear for those), and the brief window right
// after a fresh upload before the resize function has finished running.
export function useResizedImageUrl(mediaPath: string | undefined | null, fallbackUrl: string) {
  const [url, setUrl] = useState(fallbackUrl);

  useEffect(() => {
    let cancelled = false;
    setUrl(fallbackUrl);
    if (!mediaPath) return;
    getDownloadURL(ref(storage, `${mediaPath}_800x800.webp`))
      .then((resizedUrl) => {
        if (!cancelled) setUrl(resizedUrl);
      })
      .catch(() => {
        // Not resized (yet, or ever) — fallbackUrl above already covers this.
      });
    return () => {
      cancelled = true;
    };
  }, [mediaPath, fallbackUrl]);

  return url;
}
