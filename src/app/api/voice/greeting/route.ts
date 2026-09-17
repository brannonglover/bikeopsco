import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { put, del } from "@vercel/blob";
import { requireStaffShop } from "@/lib/api-auth";
import { getAppFeatures } from "@/lib/app-settings";
import { BLOB_ACCESS, blobDisplayUrl, sniffAudioContainer } from "@/lib/blob";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SIZE_MB = 10;

/**
 * The shop's recorded voicemail greeting. Stored in Blob because Twilio's
 * <Play> fetches it directly from its own servers — it can't come through the
 * staff-authed recording proxy the way inbound voicemail does.
 *
 * Upload validates the audio type rather than trusting the client: a greeting
 * Twilio can't decode doesn't fail loudly, it just drops the <Play> and leaves
 * callers with dead air, which is a much worse failure than a rejected upload.
 */

async function currentGreeting(shopId: string): Promise<string | null> {
  const row = await prisma.appSettings.findUnique({
    where: { shopId },
    select: { voicemailGreetingUrl: true },
  });
  return row?.voicemailGreetingUrl ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireStaffShop(request);
    if (!auth.ok) return auth.response;

    // 404 when voice is off, matching /api/calls — the app has no feature-flag
    // plumbing of its own and uses this to decide whether to show the section.
    const features = await getAppFeatures(auth.shopId);
    if (!features.voiceEnabled) {
      return NextResponse.json({ error: "Voice is disabled" }, { status: 404 });
    }

    return NextResponse.json(
      { url: await currentGreeting(auth.shopId) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("GET /api/voice/greeting error:", error);
    return NextResponse.json({ error: "Failed to load greeting" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireStaffShop(request);
    if (!auth.ok) return auth.response;

    const features = await getAppFeatures(auth.shopId);
    if (!features.voiceEnabled) {
      return NextResponse.json({ error: "Voice is disabled" }, { status: 404 });
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        { error: "Greeting upload is not configured (BLOB_READ_WRITE_TOKEN missing)." },
        { status: 503 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return NextResponse.json(
        { error: `Recording too large. Max size is ${MAX_SIZE_MB} MB.` },
        { status: 400 }
      );
    }

    // Judge the bytes, not the client's declared MIME type — that's what Twilio
    // has to decode, and a mislabelled part would otherwise sail through and
    // leave callers with silence.
    const bytes = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffAudioContainer(bytes);
    if (!sniffed.playable) {
      console.warn(
        "Rejected voicemail greeting upload:",
        sniffed.detected,
        `(declared ${file.type || "no type"})`
      );
      return NextResponse.json(
        {
          error: `Twilio can only play WAV or MP3 greetings — this recording is ${sniffed.detected}.`,
        },
        { status: 400 }
      );
    }

    const previous = await currentGreeting(auth.shopId);

    const blob = await put(
      `voicemail-greetings/${auth.shopId}/${randomUUID()}.${sniffed.extension}`,
      bytes,
      { access: BLOB_ACCESS, addRandomSuffix: false, contentType: sniffed.contentType }
    );

    const url = blobDisplayUrl(blob.url, blob.pathname);
    await prisma.appSettings.update({
      where: { shopId: auth.shopId },
      data: { voicemailGreetingUrl: url },
    });

    // Best-effort cleanup of the replaced take. A re-record shouldn't leave the
    // old blob behind, but a failure here must not fail the upload that
    // already succeeded.
    if (previous) void discardBlob(previous);

    return NextResponse.json({ url }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("POST /api/voice/greeting error:", error);
    return NextResponse.json({ error: "Failed to save greeting" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireStaffShop(request);
    if (!auth.ok) return auth.response;

    const previous = await currentGreeting(auth.shopId);
    await prisma.appSettings.update({
      where: { shopId: auth.shopId },
      data: { voicemailGreetingUrl: null },
    });
    if (previous) void discardBlob(previous);

    return NextResponse.json({ url: null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("DELETE /api/voice/greeting error:", error);
    return NextResponse.json({ error: "Failed to remove greeting" }, { status: 500 });
  }
}

/** Delete a stored greeting blob, tolerating the private-proxy URL form. */
async function discardBlob(storedUrl: string): Promise<void> {
  try {
    if (storedUrl.startsWith("/api/blob")) {
      const path = new URL(storedUrl, "https://placeholder.local").searchParams.get("path");
      if (path) await del(path);
      return;
    }
    await del(storedUrl);
  } catch (error) {
    console.warn("Failed to delete previous voicemail greeting blob:", error);
  }
}
