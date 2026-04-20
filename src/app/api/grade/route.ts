import { NextResponse } from "next/server";
import {
  buildGradingPrompt,
  parseFeedbackResponse,
  FEEDBACK_SCHEMA,
} from "@/lib/grading";
import type { InterviewConfig, TranscriptEntry } from "@/lib/types";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 },
    );
  }

  const body = await request.json();
  const { config, transcript } = body as {
    config: InterviewConfig;
    transcript: TranscriptEntry[];
  };

  if (!config?.jobDescription || !transcript?.length) {
    return NextResponse.json(
      { error: "config.jobDescription and transcript are required" },
      { status: 400 },
    );
  }

  const prompt = buildGradingPrompt(config, transcript);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.1",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 4096,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "feedback_report",
            strict: true,
            schema: FEEDBACK_SCHEMA,
          },
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("OpenAI grading error:", error);
      return NextResponse.json({ error: "Grading failed" }, { status: 502 });
    }

    const data = await response.json();
    const responseText = data.choices[0]?.message?.content ?? "";
    const report = parseFeedbackResponse(responseText);

    return NextResponse.json(report);
  } catch (err) {
    console.error("Grading error:", err);
    return NextResponse.json(
      { error: "Grading failed" },
      { status: 500 },
    );
  }
}
