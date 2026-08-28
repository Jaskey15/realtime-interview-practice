import { NextResponse } from "next/server";

const SANDBOX_AVATAR_ID = "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a"; // "Wayne" — only avatar allowed in sandbox

export async function POST(request: Request) {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "HEYGEN_API_KEY not configured" },
      { status: 500 },
    );
  }

  const sandbox = process.env.HEYGEN_SANDBOX === "true";
  const avatarId = sandbox ? SANDBOX_AVATAR_ID : process.env.HEYGEN_AVATAR_ID;
  if (!avatarId) {
    return NextResponse.json(
      { error: "HEYGEN_AVATAR_ID not configured (or set HEYGEN_SANDBOX=true)" },
      { status: 500 },
    );
  }

  const body = await request.json();
  const requested =
    typeof body?.durationMinutes === "number" ? body.durationMinutes : 10;
  const durationMinutes = Math.min(60, Math.max(1, requested));

  const tokenConfig: Record<string, unknown> = {
    mode: "LITE",
    avatar_id: avatarId,
    is_sandbox: sandbox,
  };
  if (!sandbox) {
    tokenConfig.max_session_duration = (durationMinutes + 2) * 60;
  }

  const response = await fetch("https://api.liveavatar.com/v1/sessions/token", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(tokenConfig),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("LiveAvatar API error:", error);
    return NextResponse.json(
      { error: "Failed to create avatar session" },
      { status: 502 },
    );
  }

  const data = await response.json();
  return NextResponse.json({ sessionToken: data.data.session_token });
}
