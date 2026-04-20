import type { FeedbackReport, InterviewConfig } from "./types";

export function buildMarkdownReport(
  report: FeedbackReport,
  config: InterviewConfig,
): string {
  const typeLabels: Record<string, string> = {
    technical: "Technical",
    behavioral: "Behavioral",
    "case-study": "Case Study",
    general: "General",
  };
  const styleLabels: Record<string, string> = {
    friendly: "Friendly",
    neutral: "Neutral",
    challenging: "Challenging",
  };

  let md = `# Interview Feedback Report\n\n`;
  md += `**Overall Score: ${(((report.overallScore - 1) / 4) * 10).toFixed(1)}/10**\n\n`;
  md += `**Interview Type:** ${typeLabels[config.interviewType] ?? config.interviewType}\n`;
  md += `**Interviewer Style:** ${styleLabels[config.interviewerStyle] ?? config.interviewerStyle}\n`;
  md += `**Duration:** ${config.durationMinutes} minutes\n\n`;
  md += `---\n\n`;

  // Dimensions
  md += `## Scores\n\n`;
  for (const dim of report.dimensions) {
    md += `### ${dim.name} — ${dim.score}/5\n\n`;
    md += `${dim.feedback}\n\n`;
  }

  // Strengths
  md += `## Top Strengths\n\n`;
  for (const s of report.strengths) {
    md += `- ${s}\n`;
  }
  md += `\n`;

  // Improvements
  md += `## Areas for Improvement\n\n`;
  for (const s of report.improvements) {
    md += `- ${s}\n`;
  }
  md += `\n`;

  // Quotes
  if (report.quotesWithSuggestions.length > 0) {
    md += `## Specific Feedback\n\n`;
    for (const qs of report.quotesWithSuggestions) {
      md += `> "${qs.quote}"\n\n`;
      md += `**Suggestion:** ${qs.suggestion}\n\n`;
    }
  }

  // Config context
  md += `---\n\n`;
  md += `*Job Description (first 200 chars):* ${config.jobDescription.slice(0, 200)}...\n`;
  if (config.focusPrompt) {
    md += `*Focus Area:* ${config.focusPrompt}\n`;
  }
  md += `*Interview Type:* ${typeLabels[config.interviewType] ?? config.interviewType} | *Style:* ${styleLabels[config.interviewerStyle] ?? config.interviewerStyle} | *Duration:* ${config.durationMinutes}min\n`;

  return md;
}

export function exportMarkdown(
  report: FeedbackReport,
  config: InterviewConfig,
): void {
  const md = buildMarkdownReport(report, config);
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `interview-feedback-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
