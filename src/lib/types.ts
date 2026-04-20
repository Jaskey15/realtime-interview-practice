export type InterviewType = "technical" | "behavioral" | "case-study" | "general";

export type InterviewerStyle = "friendly" | "neutral" | "challenging";

export type InterviewConfig = {
  jobDescription: string;
  focusPrompt: string;
  interviewType: InterviewType;
  interviewerStyle: InterviewerStyle;
  durationMinutes: number;
};

export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

export type TranscriptEntry = {
  speaker: "user" | "interviewer";
  text: string;
};

export type GradingDimension = {
  name: string;
  score: number; // 1-5
  feedback: string;
};

export type FeedbackReport = {
  dimensions: GradingDimension[];
  overallScore: number;
  strengths: string[];
  improvements: string[];
  quotesWithSuggestions: {
    quote: string;
    suggestion: string;
  }[];
};
