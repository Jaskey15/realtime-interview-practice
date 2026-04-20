"use client";

import { useEffect, useRef } from "react";
import type { TranscriptEntry } from "@/lib/types";

export function Transcript({ entries }: { entries: TranscriptEntry[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-text-muted">
        <div className="text-center">
          <div className="mx-auto mb-3 h-10 w-10 rounded-full border border-border-subtle flex items-center justify-center">
            <div className="h-2 w-2 rounded-full bg-text-muted animate-pulse" />
          </div>
          <span className="text-sm">Waiting for conversation to begin...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
      {entries.map((entry, i) => (
        <div
          key={i}
          className={`flex flex-col gap-1.5 ${entry.speaker === "user" ? "items-end" : "items-start"}`}
        >
          <span className="text-[11px] font-medium tracking-wide uppercase text-text-muted">
            {entry.speaker === "user" ? "You" : "Interviewer"}
          </span>
          <div
            className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
              entry.speaker === "user"
                ? "bg-accent/15 text-accent-bright border border-accent/20"
                : "glass-card text-text-primary"
            }`}
          >
            {entry.text}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
