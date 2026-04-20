"use client";

import { useState } from "react";
import type { InterviewConfig, InterviewType, InterviewerStyle } from "@/lib/types";

const interviewTypes: { value: InterviewType; label: string; subtitle: string }[] = [
  { value: "technical", label: "Technical", subtitle: "Architecture, coding, system design" },
  { value: "behavioral", label: "Behavioral", subtitle: "STAR method, leadership, teamwork" },
  { value: "case-study", label: "Case Study", subtitle: "Business problems, analytical frameworks" },
  { value: "general", label: "General", subtitle: "Motivation, experience, role fit" },
];

const interviewerStyles: { value: InterviewerStyle; label: string }[] = [
  { value: "friendly", label: "Friendly" },
  { value: "neutral", label: "Neutral" },
  { value: "challenging", label: "Challenging" },
];

const durationOptions = [5, 10, 15] as const;

const focusPlaceholders: Record<InterviewType, string> = {
  technical: 'e.g., "system design" or "backend architecture"',
  behavioral: 'e.g., "leadership" or "conflict resolution"',
  "case-study": 'e.g., "market sizing" or "go-to-market strategy"',
  general: 'e.g., "career goals" or "team collaboration"',
};

export function SetupForm({
  onStart,
}: {
  onStart: (config: InterviewConfig) => void;
}) {
  const [jobDescription, setJobDescription] = useState("");
  const [focusPrompt, setFocusPrompt] = useState("");
  const [interviewType, setInterviewType] = useState<InterviewType>("technical");
  const [interviewerStyle, setInterviewerStyle] = useState<InterviewerStyle>("neutral");
  const [durationMinutes, setDurationMinutes] = useState(10);

  const canStart = jobDescription.trim().length > 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 animate-fade-in-up">
      {/* Interview Type */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-text-secondary">
          Interview Type
        </label>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {interviewTypes.map((type) => {
            const selected = interviewType === type.value;
            return (
              <button
                key={type.value}
                type="button"
                onClick={() => setInterviewType(type.value)}
                className={`flex flex-col gap-1 rounded-xl p-4 text-left transition-all ${
                  selected
                    ? "border border-accent bg-accent/10 shadow-[0_0_12px_rgba(0,200,255,0.15)]"
                    : "glass-card border border-border-subtle hover:border-border-default"
                }`}
              >
                <span className={`text-sm font-semibold ${selected ? "text-accent-bright" : "text-text-primary"}`}>
                  {type.label}
                </span>
                <span className="text-xs text-text-muted leading-snug">
                  {type.subtitle}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Interviewer Style */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-text-secondary">
          Interviewer Style
        </label>
        <div className="flex gap-2">
          {interviewerStyles.map((style) => {
            const selected = interviewerStyle === style.value;
            return (
              <button
                key={style.value}
                type="button"
                onClick={() => setInterviewerStyle(style.value)}
                className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                  selected
                    ? "bg-accent text-white shadow-[0_0_12px_rgba(0,200,255,0.2)]"
                    : "border border-border-subtle text-text-secondary hover:border-border-default hover:text-text-primary"
                }`}
              >
                {style.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Duration */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-text-secondary">
          Duration
        </label>
        <div className="flex gap-2">
          {durationOptions.map((mins) => {
            const selected = durationMinutes === mins;
            return (
              <button
                key={mins}
                type="button"
                onClick={() => setDurationMinutes(mins)}
                className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                  selected
                    ? "bg-accent text-white shadow-[0_0_12px_rgba(0,200,255,0.2)]"
                    : "border border-border-subtle text-text-secondary hover:border-border-default hover:text-text-primary"
                }`}
              >
                {mins} min
              </button>
            );
          })}
        </div>
      </div>

      {/* Job Description */}
      <div className="flex flex-col gap-2">
        <label htmlFor="jd" className="text-sm font-medium text-text-secondary">
          Job Description
        </label>
        <textarea
          id="jd"
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          placeholder="Paste the job description here..."
          rows={10}
          className="input-dark w-full rounded-xl p-4 text-sm leading-relaxed resize-none"
        />
      </div>

      {/* Focus Area */}
      <div className="flex flex-col gap-2">
        <label
          htmlFor="focus"
          className="text-sm font-medium text-text-secondary"
        >
          Focus Area{" "}
          <span className="text-text-muted">(optional)</span>
        </label>
        <input
          id="focus"
          type="text"
          value={focusPrompt}
          onChange={(e) => setFocusPrompt(e.target.value)}
          placeholder={focusPlaceholders[interviewType]}
          className="input-dark w-full rounded-xl p-4 text-sm"
        />
      </div>

      <button
        onClick={() => onStart({ jobDescription, focusPrompt, interviewType, interviewerStyle, durationMinutes })}
        disabled={!canStart}
        className="btn-glow rounded-xl px-6 py-3.5 font-semibold text-white"
      >
        Start Interview
      </button>
    </div>
  );
}
