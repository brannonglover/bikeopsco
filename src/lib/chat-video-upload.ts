import { put } from "@vercel/blob/client";

type ChatUploadTokenResponse = {
  clientToken: string;
  pathname: string;
  access: "public" | "private";
};

type ChatAttachmentResponse = {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
};

export function isChatVideoFile(file: File): boolean {
  return (
    file.type === "video/mp4" ||
    file.type === "video/quicktime" ||
    /\.(mp4|mov)$/i.test(file.name)
  );
}

export async function uploadChatVideoFile(
  file: File,
  opts?: { credentials?: RequestCredentials }
): Promise<ChatAttachmentResponse> {
  const credentials = opts?.credentials ?? "same-origin";
  const mimeType =
    file.type ||
    (/\.mov$/i.test(file.name) ? "video/quicktime" : "video/mp4");

  const tokenRes = await fetch("/api/chat/upload/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials,
    body: JSON.stringify({
      filename: file.name || "video.mp4",
      mimeType,
      size: file.size,
    }),
  });

  if (!tokenRes.ok) {
    const data = await tokenRes.json().catch(() => ({}));
    throw new Error(
      typeof data.error === "string" ? data.error : "Failed to start video upload"
    );
  }

  const tokenData = (await tokenRes.json()) as ChatUploadTokenResponse;

  const blob = await put(tokenData.pathname, file, {
    access: tokenData.access,
    token: tokenData.clientToken,
    contentType: mimeType,
    multipart: file.size > 4 * 1024 * 1024,
  });

  const completeRes = await fetch("/api/chat/upload/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials,
    body: JSON.stringify({
      url: blob.url,
      pathname: blob.pathname,
      filename: file.name || "video.mp4",
      mimeType,
    }),
  });

  if (!completeRes.ok) {
    const data = await completeRes.json().catch(() => ({}));
    throw new Error(
      typeof data.error === "string" ? data.error : "Failed to save video"
    );
  }

  return completeRes.json();
}
