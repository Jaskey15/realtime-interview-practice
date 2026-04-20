import type { InterviewConfig, InterviewType, TranscriptEntry, FeedbackReport } from "./types";

type RubricDimension = {
  name: string;
  description: string;
};

const RUBRICS: Record<InterviewType, RubricDimension[]> = {
  technical: [
    { name: "Technical Depth", description: "Accuracy and depth of domain knowledge, ability to go deeper when probed, understanding of trade-offs" },
    { name: "Problem-Solving Approach", description: "How they break down and work through problems, framework for approaching unknowns" },
    { name: "Communication Clarity", description: "Explaining technical concepts clearly, structured explanations, appropriate detail level" },
    { name: "System Thinking", description: "Considering trade-offs, scale, edge cases, broader implications" },
    { name: "Overall Impression", description: "Would this person move to the next round? Summary assessment" },
  ],
  behavioral: [
    { name: "STAR Structure", description: "Situation, task, action, result clearly articulated in responses" },
    { name: "Self-Awareness", description: "Honest reflection on experiences, lessons learned from failures" },
    { name: "Specificity", description: "Concrete examples with details vs. vague generalities" },
    { name: "Leadership & Collaboration", description: "Evidence of influence, teamwork, conflict resolution" },
    { name: "Overall Impression", description: "Would this person move to the next round? Summary assessment" },
  ],
  "case-study": [
    { name: "Framework & Structure", description: "Organized, structured approach to breaking down the problem" },
    { name: "Analytical Rigor", description: "Use of numbers, reasonable assumptions, logical reasoning" },
    { name: "Creativity", description: "Novel angles, non-obvious insights, thinking beyond the obvious" },
    { name: "Communication Clarity", description: "Walking through thinking clearly, structured delivery" },
    { name: "Overall Impression", description: "Would this person move to the next round? Summary assessment" },
  ],
  general: [
    { name: "Relevance", description: "Answers tie back to the role, company, and requirements" },
    { name: "Communication Clarity", description: "Concise, articulate responses with good structure" },
    { name: "Self-Awareness", description: "Understanding of strengths, weaknesses, and growth areas" },
    { name: "Enthusiasm & Fit", description: "Genuine interest in the role, cultural alignment signals" },
    { name: "Overall Impression", description: "Would this person move to the next round? Summary assessment" },
  ],
};

export function buildGradingPrompt(
  config: InterviewConfig,
  transcript: TranscriptEntry[],
): string {
  const formattedTranscript = transcript
    .map((t) => `**${t.speaker === "user" ? "Candidate" : "Interviewer"}:** ${t.text}`)
    .join("\n\n");

  const dimensions = RUBRICS[config.interviewType];

  const rubricLines = dimensions
    .map((d, i) => `${i + 1}. **${d.name}** — ${d.description}`)
    .join("\n");

  const expectedDimensionNames = dimensions.map((d) => `"${d.name}"`).join(", ");

  let prompt = `You are an expert interview coach grading an interview. Analyze the transcript below and provide structured feedback.

## Job Description
${config.jobDescription}`;

  if (config.focusPrompt.trim()) {
    prompt += `\n\n## Candidate's Focus Area\n${config.focusPrompt.trim()}`;
  }

  prompt += `

## Interview Transcript
${formattedTranscript}

## Grading Rubric

Score each dimension 1-5 with detailed written feedback:

${rubricLines}

## Output Requirements

- Return one dimension entry for each rubric item above, in order, using these exact names: ${expectedDimensionNames}.
- Each score must be an integer from 1 to 5.
- overallScore must be the average of all dimension scores, rounded to 1 decimal.
- Return exactly 3 strengths, 3 improvements, and 3 quotesWithSuggestions.
- Each quote must be an exact verbatim excerpt from the candidate's responses.`;

  return prompt;
}

export const FEEDBACK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "dimensions",
    "overallScore",
    "strengths",
    "improvements",
    "quotesWithSuggestions",
  ],
  properties: {
    dimensions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "score", "feedback"],
        properties: {
          name: { type: "string" },
          score: { type: "integer" },
          feedback: { type: "string" },
        },
      },
    },
    overallScore: { type: "number" },
    strengths: { type: "array", items: { type: "string" } },
    improvements: { type: "array", items: { type: "string" } },
    quotesWithSuggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["quote", "suggestion"],
        properties: {
          quote: { type: "string" },
          suggestion: { type: "string" },
        },
      },
    },
  },
} as const;

export function parseFeedbackResponse(responseText: string): FeedbackReport {
  return JSON.parse(responseText) as FeedbackReport;
}
