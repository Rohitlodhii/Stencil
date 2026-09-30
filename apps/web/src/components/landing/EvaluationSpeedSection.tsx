"use client";

import { BottomVanishBlur } from "@/components/landing/BottomVanishBlur";

/** Below-hero landing section: evaluation speed claim. */
export function EvaluationSpeedSection() {
  return (
    <section className="w-full px-6 py-16 text-center sm:py-24">
      <div className="mx-auto w-full max-w-7xl">
        <h2 className="font-inter-medium mx-auto max-w-3xl text-3xl font-medium tracking-tight text-slate-950 sm:text-4xl lg:text-5xl">
          <span className="block">Checks a sheet under 20s,</span>
          <span className="block">5x faster than manual</span>
        </h2>
        <p className="font-inter-regular mx-auto mt-5 max-w-xl text-base font-normal leading-6 text-muted-foreground">
          Stencil reads every handwritten page, maps it to your marking scheme,
          and drafts question-wise marks — teachers just review and approve.
        </p>
      </div>

      <div className="relative mx-auto mt-0 w-full max-w-5xl overflow-hidden rounded-2xl">
        <img
          src="/5x.png"
          alt="Stencil checking an answer sheet five times faster than manual evaluation"
          loading="lazy"
          className="h-auto w-full object-cover"
        />
        <BottomVanishBlur />
      </div>
    </section>
  );
}

