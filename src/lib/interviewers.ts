import type { InterviewType } from "./types";

/**
 * One interviewer per interview type: the HeyGen avatar you see, the name the
 * model introduces itself with, and the OpenAI voice you hear. These live in a
 * single table because they have to agree — a feminine avatar introducing
 * itself with a masculine name in a masculine voice reads as broken.
 *
 * Avatar IDs and names come from the LiveAvatar stock catalogue
 * (GET https://api.liveavatar.com/v1/avatars/{id}).
 */
export type Interviewer = {
  avatarId: string;
  name: string;
  title: string;
  voice: string;
};

export const INTERVIEWERS: Record<InterviewType, Interviewer> = {
  technical: {
    avatarId: "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a", // "Wayne"
    name: "Wayne",
    title: "Senior Engineer",
    voice: "cedar",
  },
  behavioral: {
    avatarId: "7a517e8e-b41f-49e7-b6b3-2cdfb4bbff1e", // "Pedro Sitting"
    name: "Pedro",
    title: "Hiring Manager",
    voice: "cedar",
  },
  "case-study": {
    avatarId: "073b60a9-89a8-45aa-8902-c358f64d2852", // "Katya Sitting"
    name: "Katya",
    title: "Senior Consultant",
    voice: "marin",
  },
  general: {
    avatarId: "40b4f000-f783-4bba-a327-ea58b1a6fdf2", // "Amina Sitting"
    name: "Amina",
    title: "Hiring Manager",
    voice: "marin",
  },
};

const DEFAULT_TYPE: InterviewType = "technical";

/** Narrows an untrusted request field to a known interview type. */
export function toInterviewType(value: unknown): InterviewType {
  return typeof value === "string" && value in INTERVIEWERS
    ? (value as InterviewType)
    : DEFAULT_TYPE;
}

/**
 * Sandbox sessions may only use one avatar. When that's in force the interview
 * type still drives the questions, but the identity — face, name, voice — has
 * to follow the avatar we can actually render, or the lobby introduces Katya
 * and Wayne shows up.
 */
function sandboxLocked(): boolean {
  return (
    process.env.HEYGEN_SANDBOX === "true" && Boolean(process.env.HEYGEN_API_KEY)
  );
}

/**
 * Server-only — reads HeyGen env vars. The single source of truth for who the
 * candidate is about to meet; prompt, voice, and lobby all resolve through it.
 */
export function resolveInterviewer(interviewType: InterviewType): Interviewer {
  return sandboxLocked()
    ? INTERVIEWERS[DEFAULT_TYPE] // only avatar allowed in sandbox
    : INTERVIEWERS[interviewType];
}

/** HEYGEN_AVATAR_ID overrides the per-type avatar (single-avatar mode). */
export function resolveAvatarId(interviewType: InterviewType): string {
  return (
    (sandboxLocked() ? "" : process.env.HEYGEN_AVATAR_ID) ||
    resolveInterviewer(interviewType).avatarId
  );
}
