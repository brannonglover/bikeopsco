import { NextRequest, NextResponse } from "next/server";
import { getAppFeatures } from "@/lib/app-settings";
import { requireStaffShop } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Twilio recording media URLs are reachable by anyone holding the URL unless
 * the account opts into basic auth, so the raw recordingUrl never leaves the
 * server. Staff hit this instead and we fetch the audio with account
 * credentials, which also keeps the voicemail behind the same session check as
 * the rest of the call log.
 */
const TWILIO_MEDIA_HOST = "api.twilio.com";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireStaffShop(request);
    if (!auth.ok) return auth.response;

    const features = await getAppFeatures(auth.shopId);
    if (!features.voiceEnabled) {
      return NextResponse.json({ error: "Voice is disabled" }, { status: 404 });
    }

    const { id } = await params;

    // shopId in the where clause, not a post-fetch check — one shop must never
    // be able to pull another shop's voicemail by guessing a call id.
    const call = await prisma.call.findFirst({
      where: { id, shopId: auth.shopId },
      select: { recordingUrl: true },
    });

    if (!call?.recordingUrl) {
      return NextResponse.json({ error: "No recording for this call" }, { status: 404 });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
    if (!accountSid || !authToken) {
      console.error("GET /api/calls/[id]/recording: Twilio credentials not configured");
      return NextResponse.json({ error: "Recording unavailable" }, { status: 503 });
    }

    // The stored URL comes from Twilio's own callback, but it lands in our
    // database — validate the host so a bad row can't turn this into an
    // authenticated fetch of somewhere else.
    let mediaUrl: URL;
    try {
      mediaUrl = new URL(call.recordingUrl);
    } catch {
      console.error("GET /api/calls/[id]/recording: unparseable recordingUrl", id);
      return NextResponse.json({ error: "Recording unavailable" }, { status: 502 });
    }
    if (mediaUrl.protocol !== "https:" || mediaUrl.hostname !== TWILIO_MEDIA_HOST) {
      console.error(
        "GET /api/calls/[id]/recording: refusing non-Twilio recordingUrl",
        mediaUrl.hostname
      );
      return NextResponse.json({ error: "Recording unavailable" }, { status: 502 });
    }
    if (!mediaUrl.pathname.endsWith(".mp3")) {
      mediaUrl.pathname = `${mediaUrl.pathname}.mp3`;
    }

    // Forwarding Range is what makes scrubbing work — without it the player can
    // only play straight through from the start.
    const range = request.headers.get("range");
    const upstream = await fetch(mediaUrl.toString(), {
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        ...(range ? { Range: range } : {}),
      },
      cache: "no-store",
    });

    if (!upstream.ok && upstream.status !== 206) {
      console.error(
        "GET /api/calls/[id]/recording: Twilio media fetch failed",
        upstream.status,
        id
      );
      return NextResponse.json({ error: "Recording unavailable" }, { status: 502 });
    }

    const headers = new Headers({
      "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg",
      "Accept-Ranges": "bytes",
      // Voicemail audio is immutable once recorded, but it's private — private
      // so shared caches never hold another shop's message.
      "Cache-Control": "private, max-age=3600",
    });
    for (const header of ["content-length", "content-range"] as const) {
      const value = upstream.headers.get(header);
      if (value) headers.set(header, value);
    }

    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    console.error("GET /api/calls/[id]/recording error:", error);
    return NextResponse.json({ error: "Failed to fetch recording" }, { status: 500 });
  }
}
