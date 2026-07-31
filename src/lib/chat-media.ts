export const CHAT_ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export const CHAT_ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime",
] as const;

export const CHAT_ALLOWED_MEDIA_TYPES = [
  ...CHAT_ALLOWED_IMAGE_TYPES,
  ...CHAT_ALLOWED_VIDEO_TYPES,
] as const;

/** Multipart uploads through the serverless function (images). */
export const CHAT_MAX_IMAGE_UPLOAD_MB = 5;

/** Direct-to-Blob client uploads (videos). */
export const CHAT_MAX_VIDEO_UPLOAD_MB = 50;

export function isChatImageMime(mimeType: string): boolean {
  return (CHAT_ALLOWED_IMAGE_TYPES as readonly string[]).includes(mimeType);
}

export function isChatVideoMime(mimeType: string): boolean {
  return (
    mimeType.startsWith("video/") ||
    (CHAT_ALLOWED_VIDEO_TYPES as readonly string[]).includes(mimeType)
  );
}

export function attachmentNotificationLabel(
  attachments: { mimeType: string }[] | undefined | null
): string {
  const list = attachments ?? [];
  if (list.length === 0) return "New message";
  const hasVideo = list.some((a) => isChatVideoMime(a.mimeType));
  const hasImage = list.some((a) => a.mimeType.startsWith("image/"));
  if (hasVideo && hasImage) return "Sent media";
  if (hasVideo) return "Sent a video";
  return "Sent a photo";
}

export function extensionForChatMedia(
  filename: string,
  mimeType: string
): string {
  const fromName = filename.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  if (mimeType === "video/quicktime") return "mov";
  if (mimeType === "video/mp4") return "mp4";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/heic") return "heic";
  if (mimeType === "image/heif") return "heif";
  return "jpg";
}
