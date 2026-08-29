import { NextResponse } from "next/server";
import {
  resolveAvatarId,
  resolveInterviewer,
  toInterviewType,
} from "@/lib/interviewers";

/**
 * Who the candidate is about to meet, for the pre-interview green room: the
 * persona plus a still of the avatar the session will actually render.
 * Resolution goes through the same helpers the session route uses, so the
 * lobby can't promise a face the session won't deliver.
 *
 * previewUrl is null when HeyGen isn't configured or the lookup fails — the
 * lobby degrades to a nameplate and the interview runs voice-only.
 */
export async function GET(request: Request) {
  const type = toInterviewType(
    new URL(request.url).searchParams.get("type"),
  );
  const { name, title } = resolveInterviewer(type);

  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ name, title, previewUrl: null });
  }

  let previewUrl: string | null = null;
  try {
    const res = await fetch(
      `https://api.liveavatar.com/v1/avatars/${resolveAvatarId(type)}`,
      { headers: { "X-API-KEY": apiKey }, next: { revalidate: 86400 } },
    );
    if (res.ok) {
      const body = await res.json();
      previewUrl = body?.data?.preview_url ?? null;
    }
  } catch {
    // Preview is decorative — never block the lobby on it.
  }

  return NextResponse.json({ name, title, previewUrl });
}
