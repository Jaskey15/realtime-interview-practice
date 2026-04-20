"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FeedbackReportView } from "@/components/feedback-report";
import type { InterviewConfig, TranscriptEntry, FeedbackReport } from "@/lib/types";
import { exportMarkdown } from "@/lib/export";

export default function FeedbackPage() {
  const router = useRouter();
  const [report, setReport] = useState<FeedbackReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<InterviewConfig | null>(null);

  useEffect(() => {
    const storedConfig = sessionStorage.getItem("interviewConfig");
    const storedTranscript = sessionStorage.getItem("interviewTranscript");

    if (!storedConfig || !storedTranscript) {
      router.push("/");
      return;
    }

    const parsedConfig: InterviewConfig = JSON.parse(storedConfig);
    const transcript: TranscriptEntry[] = JSON.parse(storedTranscript);
    setConfig(parsedConfig);

    async function fetchGrading() {
      try {
        const res = await fetch("/api/grade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: parsedConfig, transcript }),
        });

        if (!res.ok) throw new Error("Grading request failed");

        const data: FeedbackReport = await res.json();
        setReport(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }

    fetchGrading();
  }, [router]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-center animate-fade-in-up">
          <div className="mx-auto mb-5 h-10 w-10 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          <p className="text-sm text-text-secondary">
            Analyzing your interview...
          </p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-center animate-fade-in-up">
          <p className="text-danger">{error}</p>
          <button
            onClick={() => router.push("/")}
            className="mt-4 text-sm text-accent-bright hover:underline"
          >
            Start over
          </button>
        </div>
      </main>
    );
  }

  if (!report || !config) return null;

  return (
    <main className="min-h-screen p-8 pt-12">
      <div className="hero-glow mb-10 text-center animate-fade-in-up">
        <h1 className="font-display text-3xl font-bold tracking-tight text-text-primary">
          Interview{" "}
          <span
            style={{
              backgroundImage: "linear-gradient(to right, #3d8bfd, #22d3ee)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Feedback
          </span>
        </h1>
      </div>
      <FeedbackReportView
        report={report}
        onExportMarkdown={() => exportMarkdown(report, config)}
        onRetry={() => {
          sessionStorage.removeItem("interviewTranscript");
          router.push("/interview");
        }}
        onNewInterview={() => {
          sessionStorage.removeItem("interviewTranscript");
          sessionStorage.removeItem("interviewConfig");
          router.push("/");
        }}
      />
    </main>
  );
}
