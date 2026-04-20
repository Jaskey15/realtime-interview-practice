import type { InterviewConfig, InterviewType, InterviewerStyle } from "./types";

const TYPE_BLOCKS: Record<InterviewType, string> = {
  technical:
    "Probe architecture decisions and ask the candidate to walk through implementations. Go deep on trade-offs. Cover system design and coding concepts relevant to the role.",
  behavioral:
    "Use the STAR framework. Ask for specific examples from past experience. Probe self-awareness and lessons learned. Explore leadership and collaboration.",
  "case-study":
    "Present a business problem derived from the job description context. Guide the candidate through a structured analytical framework. Push on assumptions and numbers. Test structured thinking.",
  general:
    "Mix motivation and career narrative with experience walkthrough. Include situational questions. Assess role and culture fit.",
};

const STYLE_BLOCKS: Record<InterviewerStyle, string> = {
  friendly:
    "Use an encouraging tone. Offer hints when the candidate is stuck. Affirm good answers. Create a comfortable and supportive atmosphere.",
  neutral:
    "Be professional and balanced. No hand-holding but fair. Give measured reactions. Let the candidate's answers speak for themselves.",
  challenging:
    "Push back on answers. Ask \"are you sure?\" Probe for weaknesses and gaps. Provide less validation. Test how the candidate performs under pressure.",
};

const PERSONA_MAP: Record<InterviewType, { name: string; title: string }> = {
  technical: { name: "Alex", title: "Senior Engineer" },
  behavioral: { name: "Jordan", title: "Hiring Manager" },
  "case-study": { name: "Morgan", title: "Senior Consultant" },
  general: { name: "Taylor", title: "Hiring Manager" },
};

export function buildInterviewerPrompt(config: InterviewConfig): string {
  const {
    jobDescription,
    focusPrompt,
    interviewType,
    interviewerStyle,
    durationMinutes,
  } = config;

  const persona = PERSONA_MAP[interviewType];

  const sections = [
    // Base instructions
    `You are ${persona.name}, a ${persona.title}, conducting a ~${durationMinutes} minute interview.

## Core Rules
- Introduce yourself by name and title at the start.
- Ask one question at a time. Listen actively before moving on.
- Go deep on each topic — probe follow-ups, don't rush to the next question.
- You will receive a system signal when it is time to wrap up. Until then, keep the interview going.
- When you receive the wrap-up signal, acknowledge you're coming up on time, thank the candidate, and invite their questions.`,

    // Interview type
    `## Interview Approach
${TYPE_BLOCKS[interviewType]}`,

    // Interviewer style
    `## Your Style
${STYLE_BLOCKS[interviewerStyle]}`,

    // Job description
    `## Job Description
${jobDescription}`,
  ];

  // Focus area (optional)
  if (focusPrompt.trim()) {
    sections.push(
      `## Focus Area
The candidate has requested focus on: ${focusPrompt.trim()}
Weight your questions toward this area while still covering general competency.`
    );
  }

  return sections.join("\n\n");
}

export function getInterviewerVoice(interviewType: InterviewType): string {
  switch (interviewType) {
    case "technical":
    case "behavioral":
      return "cedar";
    case "case-study":
    case "general":
      return "marin";
  }
}
