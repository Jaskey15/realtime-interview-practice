"use client";

import { useRouter } from "next/navigation";
import { SetupForm } from "@/components/setup-form";
import type { InterviewConfig } from "@/lib/types";

export default function Home() {
  const router = useRouter();

  function handleStart(config: InterviewConfig) {
    sessionStorage.setItem("interviewConfig", JSON.stringify(config));
    router.push("/interview");
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-10 p-8">
      <div className="hero-glow text-center">
        <h1 className="font-display text-4xl font-bold tracking-tight text-text-primary md:text-5xl">
          Interview Practice
          <span
            className="bg-clip-text"
            style={{
              backgroundImage: "linear-gradient(to right, #3d8bfd, #22d3ee)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {" "}Agent
          </span>
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-base text-text-secondary whitespace-nowrap">
          Paste a job description, practice a live interview, get AI feedback.
        </p>
      </div>
      <SetupForm onStart={handleStart} />
    </main>
  );
}
