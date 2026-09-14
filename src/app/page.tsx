"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { SetupForm } from "@/components/setup-form";
import type { InterviewConfig } from "@/lib/types";

// sessionStorage is client-only, so read it through useSyncExternalStore: the
// server snapshot is empty and the real value arrives right after hydration.
const subscribeToStorage = () => () => {};
const getStoredConfig = () => sessionStorage.getItem("interviewConfig");
const getServerConfig = () => null;

export default function Home() {
  const router = useRouter();
  const stored = useSyncExternalStore(subscribeToStorage, getStoredConfig, getServerConfig);

  const initialConfig = useMemo<InterviewConfig | null>(() => {
    if (!stored) return null;
    try {
      return JSON.parse(stored) as InterviewConfig;
    } catch {
      return null;
    }
  }, [stored]);

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
      {/* keyed so the form picks up the stored config once hydration resolves it */}
      <SetupForm
        key={initialConfig ? "prefilled" : "empty"}
        onStart={handleStart}
        initialConfig={initialConfig}
      />
    </main>
  );
}
