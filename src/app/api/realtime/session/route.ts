import { NextResponse } from "next/server";
import { buildInterviewerPrompt } from "@/lib/prompts";
import { resolveInterviewer, toInterviewType } from "@/lib/interviewers";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 },
    );
  }

  const body = await request.json();
  const { jobDescription, focusPrompt, interviewType, interviewerStyle, durationMinutes } = body;
  const type = toInterviewType(interviewType);

  if (!jobDescription || typeof jobDescription !== "string") {
    return NextResponse.json(
      { error: "jobDescription is required" },
      { status: 400 },
    );
  }

  const instructions = buildInterviewerPrompt({
    jobDescription,
    focusPrompt: focusPrompt || "",
    interviewType: type,
    interviewerStyle: interviewerStyle || "neutral",
    durationMinutes: durationMinutes || 10,
  });

  const response = await fetch(
    "https://api.openai.com/v1/realtime/client_secrets",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: "gpt-realtime-1.5",
          instructions,
          audio: {
            input: {
              transcription: {
                model: "gpt-4o-mini-transcribe",
              },
              turn_detection: {
                type: "server_vad",
              },
            },
            output: {
              voice: resolveInterviewer(type).voice,
            },
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    console.error("OpenAI API error:", error);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 502 },
    );
  }

  const data = await response.json();
  return NextResponse.json({ client_secret: data.value });
}
