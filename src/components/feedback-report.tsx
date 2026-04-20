"use client";

import type { FeedbackReport } from "@/lib/types";

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <div
            key={n}
            className={`h-1.5 w-8 rounded-full ${
              n <= score ? "score-bar-fill" : "bg-border-subtle"
            }`}
          />
        ))}
      </div>
      <span className="font-mono text-xs text-text-muted">{score}/5</span>
    </div>
  );
}

export function FeedbackReportView({
  report,
  onExportMarkdown,
  onRetry,
  onNewInterview,
}: {
  report: FeedbackReport;
  onExportMarkdown: () => void;
  onRetry: () => void;
  onNewInterview: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 stagger-children">
      {/* Overall Score (converted to /10 scale) */}
      <div className="text-center">
        <div className="inline-flex items-baseline gap-1">
          <span
            className="font-display text-6xl font-bold"
            style={{
              backgroundImage: "linear-gradient(to right, #3d8bfd, #22d3ee)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {(((report.overallScore - 1) / 4) * 10).toFixed(1)}
          </span>
          <span className="text-lg text-text-muted">/10</span>
        </div>
        <div className="mt-2 text-sm tracking-wide uppercase text-text-muted">
          Overall Score
        </div>
      </div>

      {/* Dimensions */}
      <div className="flex flex-col gap-1">
        {report.dimensions.map((dim) => (
          <div
            key={dim.name}
            className="glass-card rounded-xl p-5 flex flex-col gap-2"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display font-semibold text-text-primary">
                {dim.name}
              </h3>
              <ScoreBar score={dim.score} />
            </div>
            <p className="text-sm leading-relaxed text-text-secondary">
              {dim.feedback}
            </p>
          </div>
        ))}
      </div>

      {/* Strengths & Improvements */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="glass-card rounded-xl p-5">
          <h3 className="mb-4 flex items-center gap-2 font-display font-semibold text-success">
            <span className="inline-block h-2 w-2 rounded-full bg-success" />
            Top Strengths
          </h3>
          <ul className="flex flex-col gap-3">
            {report.strengths.map((s, i) => (
              <li
                key={i}
                className="text-sm leading-relaxed text-text-secondary pl-4 border-l border-success/20"
              >
                {s}
              </li>
            ))}
          </ul>
        </div>
        <div className="glass-card rounded-xl p-5">
          <h3 className="mb-4 flex items-center gap-2 font-display font-semibold text-warning">
            <span className="inline-block h-2 w-2 rounded-full bg-warning" />
            Areas for Improvement
          </h3>
          <ul className="flex flex-col gap-3">
            {report.improvements.map((s, i) => (
              <li
                key={i}
                className="text-sm leading-relaxed text-text-secondary pl-4 border-l border-warning/20"
              >
                {s}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Quotes with Suggestions */}
      {report.quotesWithSuggestions.length > 0 && (
        <div className="flex flex-col gap-4">
          <h3 className="font-display font-semibold text-text-primary">
            Specific Feedback on Answers
          </h3>
          {report.quotesWithSuggestions.map((qs, i) => (
            <div key={i} className="glass-card rounded-xl p-5">
              <blockquote className="mb-3 border-l-2 border-accent/30 pl-4 text-sm italic leading-relaxed text-text-muted">
                &ldquo;{qs.quote}&rdquo;
              </blockquote>
              <p className="text-sm leading-relaxed text-text-secondary">
                <span className="font-semibold text-accent-bright">
                  Suggestion:
                </span>{" "}
                {qs.suggestion}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap justify-center gap-3 border-t border-border-subtle pt-8">
        <button
          onClick={onRetry}
          className="rounded-xl border border-accent/40 bg-accent/10 px-6 py-2.5 text-sm font-medium text-accent-bright transition-all hover:border-accent/60 hover:bg-accent/15"
        >
          Retry same interview
        </button>
        <button
          onClick={onNewInterview}
          className="rounded-xl border border-accent/40 bg-accent/10 px-6 py-2.5 text-sm font-medium text-accent-bright transition-all hover:border-accent/60 hover:bg-accent/15"
        >
          New interview
        </button>
        <button
          onClick={onExportMarkdown}
          className="rounded-xl border border-border-default px-6 py-2.5 text-sm font-medium text-text-secondary transition-all hover:border-border-default hover:bg-surface-overlay hover:text-text-primary"
        >
          Export as Markdown
        </button>
      </div>
    </div>
  );
}
