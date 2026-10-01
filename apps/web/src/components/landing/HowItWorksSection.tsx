"use client";

import { useEffect } from "react";
import { VideoPlayer } from "@/components/landing/VideoPlayer";
import { Kbd } from "@/components/ui/kbd";

/** How-it-works landing section: coordinator exam creation step. */
export function HowItWorksSection() {
  // Space shortcut. Intentionally a no-op for now — the handler exists so the
  // binding is wired up; it swallows the default page-scroll so the key feels
  // "handled", and leaves focused controls alone so a focused button/video
  // toggle still receives its own Space activation.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;

      // Let focused interactive elements keep their native Space behavior
      // (buttons, links, inputs) instead of hijacking it.
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, a, input, textarea, select, [contenteditable]")) {
        return;
      }

      event.preventDefault();
      // TODO: run the Space-bound action here.
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <section className="w-full px-6 pb-16 text-center sm:pb-24">
      <h2 className="font-inter-medium mx-auto max-w-3xl text-3xl font-medium tracking-tight text-slate-950 sm:text-4xl lg:text-5xl">
        How it works
      </h2>
      <p className="font-inter-regular mx-auto mt-4 max-w-xl text-base font-normal leading-6 text-muted-foreground">
        Four steps from a question paper to graded results — every handoff
        between coordinator, teacher, and reviewer.
      </p>

      <div className="mx-auto mt-10 grid w-full max-w-6xl gap-6 text-left">
        <div className="rounded-2xl bg-accent px-6 py-10 sm:px-10 sm:py-12">
          <span className="font-inter-medium inline-flex rounded-xl bg-background px-4 py-2 text-sm font-medium tracking-tight text-slate-950">
            1. Coordinator creates exam
          </span>
          <p className="font-inter-regular mt-4 max-w-xl text-base font-normal leading-6 text-muted-foreground">
            Coordinator uploads the question paper, assigns teachers, and creates
            an exam.
          </p>

          <VideoPlayer src="/question.mp4" className="mt-8 rounded-xl" />
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <section aria-label="Landing page section two" className="rounded-2xl bg-accent px-6 py-10 sm:px-10 sm:py-12">
            <span className="font-inter-medium inline-flex rounded-xl bg-background px-4 py-2 text-sm font-medium tracking-tight text-slate-950 shadow-none">
              2. Teacher accepts exam
            </span>
            <p className="font-inter-regular mt-4 max-w-xl text-base font-normal leading-6 text-muted-foreground">
              Teacher reviews the exam details and accepts the evaluation
              assignment.
            </p>

            <VideoPlayer src="/teacher.mp4" className="mt-8 rounded-xl" />
          </section>
          <section aria-label="Landing page section three" className="rounded-2xl bg-accent px-6 py-10 sm:px-10 sm:py-12">
            <span className="font-inter-medium inline-flex rounded-xl bg-background px-4 py-2 text-sm font-medium tracking-tight text-slate-950 shadow-none">
              3. Verifies the students list
            </span>
            <p className="font-inter-regular mt-4 max-w-xl text-base font-normal leading-6 text-muted-foreground">
              Confirms the uploaded roster so every answer sheet maps to the
              right student.
            </p>

            <div className="relative mt-8 aspect-video w-full overflow-hidden rounded-xl bg-slate-200">
              <img
                src="/bgmac.jpg"
                alt="Student roster verification screen"
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
              />
              <img
                src="/verify.png"
                alt="Roster marked as verified"
                loading="lazy"
                className="absolute inset-0 h-full w-full translate-y-[12%] rounded-md object-contain object-bottom"
              />
            </div>
          </section>
        </div>

        <section aria-label="Landing page section four" className="rounded-2xl bg-accent px-6 py-10 sm:px-10 sm:py-12">
          <span className="font-inter-medium inline-flex rounded-xl bg-background px-4 py-2 text-sm font-medium tracking-tight text-slate-950 shadow-none">
            4. Checking Exam
          </span>

          <img
            src="/dashboard.png"
            alt="Stencil exam checking dashboard"
            loading="lazy"
            className="mt-8 h-auto w-full rounded-xl"
          />
        </section>

        <p className="font-inter-regular mx-auto mt-12 max-w-xl text-base font-normal leading-6 text-muted-foreground">
          Every button is keyboard shortcut
          <Kbd className="mx-1.5">Space</Kbd>
          to make workflow faster
        </p>
      </div>
    </section>
  );
}

