import { NextRequest, NextResponse } from "next/server";
import { getAppFeatures } from "@/lib/app-settings";
import { requireStaffShop } from "@/lib/api-auth";
import { buildStaffIdentity, isVoiceConfigured, mintVoiceAccessToken } from "@/lib/voice";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireStaffShop(request);
    if (!auth.ok) return auth.response;

    const features = await getAppFeatures(auth.shopId);
    if (!features.voiceEnabled) {
      return NextResponse.json({ error: "Voice is disabled" }, { status: 404 });
    }

    const platform = request.nextUrl.searchParams.get("platform");
    if (platform !== "ios" && platform !== "android") {
      return NextResponse.json(
        { error: "platform must be 'ios' or 'android'" },
        { status: 400 }
      );
    }

    if (!isVoiceConfigured()) {
      return NextResponse.json({ error: "Voice is not configured" }, { status: 503 });
    }

    const identity = buildStaffIdentity(auth.shopId, auth.userId);
    const token = mintVoiceAccessToken(identity, platform);

    return NextResponse.json({ token, identity });
  } catch (error) {
    console.error("GET /api/voice/token error:", error);
    return NextResponse.json({ error: "Failed to mint voice token" }, { status: 500 });
  }
}
