// Uploaded photo/video posts previously went to a storage path with no file extension at all
// (e.g. "posts/{uid}/{postId}/1699999999"), and were uploaded with whatever (often empty)
// content-type the blob happened to carry. That's lenient enough for <Image>/browsers, which
// sniff the actual bytes — but iOS's AVPlayer (used by expo-av's <Video>) is much stricter about
// needing a real extension or Content-Type to know how to demux a stream, and would silently
// fail to play, just sitting on its poster frame forever. This derives both properly from the
// picked asset so the uploaded object actually looks like a real video/image file.
export function guessMediaUploadInfo(asset: {
  uri: string;
  type?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
}): { contentType: string; extension: string } {
  const isVideo = asset.type === "video";
  const contentType = asset.mimeType || (isVideo ? "video/mp4" : "image/jpeg");

  // Prefer the real extension from the picked file's own name — most accurate regardless of the
  // device's actual encoding (HEIC vs JPG, MOV vs MP4, etc.) — falling back to one derived from
  // the content type above.
  const nameSource = asset.fileName || asset.uri;
  const nameMatch = nameSource?.match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/);
  const extension =
    nameMatch?.[1]?.toLowerCase() ||
    contentType.split("/")[1]?.replace("quicktime", "mov") ||
    (isVideo ? "mp4" : "jpg");

  return { contentType, extension };
}
