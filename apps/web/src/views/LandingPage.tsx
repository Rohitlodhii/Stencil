"use client";

import { Link, useNavigate } from "react-router-dom";
import { GradientBackground } from "@/components/ui/gradient-backgrounds";
import { EvaluationSpeedSection } from "@/components/landing/EvaluationSpeedSection";
import { HowItWorksSection } from "@/components/landing/HowItWorksSection";
import { WhyThisExist } from "@/components/landing/WhyThisExist";
import { VideoPlayer } from "@/components/landing/VideoPlayer";

/** Public landing route (/). */
export function LandingPage() {
  const navigate = useNavigate();

  return (
    <main className="font-inter min-h-screen bg-white px-0 pt-0 md:px-32 md:pt-4">
      <GradientBackground className="min-h-screen w-full rounded-none pb-16 md:rounded-2xl">
        <nav className="mx-auto grid w-full max-w-7xl grid-cols-2 items-center px-6 py-6 md:grid-cols-3 md:px-8">
          <Link
            to="/"
            className="flex w-fit items-center gap-2 text-2xl font-semibold tracking-tight"
          >
            <span className="rounded-xl bg-background p-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 256 256"
                fill="none"
                aria-hidden="true"
                className="h-5 w-5"
              >
                <path
                  d="M 144 256 L 27.598 256 L 144 139.598 Z M 256 207.5 L 200 256 L 200 56 L 0 56 L 48 0 L 256 0 Z M 0 204.402 L 0 112 L 92.402 112 Z"
                  fill="var(--primary)"
                />
              </svg>
            </span>
            Stencil
          </Link>

          <div className="hidden items-center justify-center gap-7 text-sm font-medium text-slate-600 md:flex">
            <a href="#why" className="transition-colors hover:text-slate-950">Why it exists</a>
            <a href="#features" className="transition-colors hover:text-slate-950">Features</a>
            <a href="#how-to-use" className="transition-colors hover:text-slate-950">How to use</a>
            <Link to="/results" className="transition-colors hover:text-slate-950">Results</Link>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => navigate("/onboarding")}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Get started
            </button>
          </div>
        </nav>

        <section className="mx-auto flex max-w-5xl flex-col items-center px-6 pt-24 text-center sm:pt-32">
          <h1 className="font-inter-medium max-w-4xl text-3xl font-medium tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
            <span className="block">AI-Powered Exam Evaluation</span>
            <span className="block">From Paper to Result</span>
          </h1>
          <p className="font-inter-regular mt-6 max-w-lg text-base font-normal leading-6 text-muted-foreground">
            Stencil connects question papers, {" "}
            <span className="rounded bg-primary px-1 text-primary-foreground">handwritten answers</span>, {" "}
            teachers, and results through an AI-powered evaluation workflow.
          </p>
          <div className="mt-8 flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate("/onboarding")}
              className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Get started
            </button>
            <button
              type="button"
              className="rounded-lg bg-secondary px-5 py-2.5 text-sm font-semibold text-secondary-foreground transition-colors hover:bg-secondary/80"
            >
              Download
            </button>
          </div>

          <VideoPlayer
            src="/hero.mp4"
            className="mt-12 max-w-7xl rounded-2xl shadow-2xl shadow-orange-950/15"
          />
        </section>
      </GradientBackground>
      <EvaluationSpeedSection />
      <HowItWorksSection />
      <WhyThisExist />
    </main>
  );
}
