import { NextResponse } from "next/server";

const SANDBOX_AVATAR_ID = "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a"; // "Wayne" — only avatar allowed in sandbox

// Stock avatar per interview type, matching each persona's voice (cedar/marin).
const AVATAR_BY_TYPE: Record<string, string> = {
  technical: "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a", // Alex, Senior Engineer
  behavioral: "7a517e8e-b41f-49e7-b6b3-2cdfb4bbff1e", // Jordan, Hiring Manager
  "case-study": "513fd1b7-7ef9-466d-9af2-344e51eeb833", // Morgan, Senior Consultant
  general: "40b4f000-f783-4bba-a327-ea58b1a6fdf2", // Taylor, Hiring Manager
};

export async function POST(request: Request) {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "HEYGEN_API_KEY not configured" },
      { status: 500 },
    );
  }

  const body = await request.json();

  const sandbox = process.env.HEYGEN_SANDBOX === "true";
  const interviewType =
    typeof body?.interviewType === "string" ? body.interviewType : "";
  // HEYGEN_AVATAR_ID overrides the per-type map when set (single-avatar mode).
  const avatarId = sandbox
    ? SANDBOX_AVATAR_ID
    : process.env.HEYGEN_AVATAR_ID || AVATAR_BY_TYPE[interviewType];
  if (!avatarId) {
    return NextResponse.json(
      { error: `No avatar configured for interview type "${interviewType}"` },
      { status: 400 },
    );
  }
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
