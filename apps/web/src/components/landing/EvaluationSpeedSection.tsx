"use client";

import { BottomVanishBlur } from "@/components/landing/BottomVanishBlur";

/** Soft organic blobs that sit behind the sheet and rise above its top edge,
 *  reading as a slow flow of light rather than geometry. Border-radius values
 *  are deliberately irregular so no two silhouettes resemble each other. */
const BLOBS = [
  {
    left: "16%",
    top: "-8%",
    width: "30%",
    height: "46%",
    opacity: 0.42,
    blur: 30,
    radius: "58% 42% 47% 53% / 44% 52% 48% 56%",
    duration: "17s",
    delay: "0s",
  },
  {
    left: "36%",
    top: "-12%",
    width: "27%",
    height: "42%",
    opacity: 0.36,
    blur: 26,
    radius: "44% 56% 61% 39% / 57% 43% 59% 41%",
    duration: "21s",
    delay: "-6s",
  },
  {
    left: "56%",
    top: "-6%",
    width: "29%",
    height: "44%",
    opacity: 0.38,
    blur: 28,
    radius: "52% 48% 39% 61% / 48% 61% 39% 52%",
    duration: "19s",
    delay: "-12s",
  },
  {
    left: "70%",
    top: "-10%",
    width: "24%",
    height: "38%",
    opacity: 0.3,
    blur: 24,
    radius: "61% 39% 55% 45% / 41% 57% 43% 59%",
    duration: "23s",
    delay: "-3s",
  },
];

/** Below-hero landing section: evaluation speed claim. */
export function EvaluationSpeedSection() {
  return (
    <section className="relative w-full overflow-hidden px-6 py-16 text-center sm:py-24">
      {/* Scoped keyframes for the glow pulse + organic blob drift. Kept local
          to this component so globals.css stays untouched. */}
      <style>{`
        @keyframes stencilGlowPulse {
          0%, 100% { opacity: 0.8; transform: translate(-50%, -50%) scale(1); }
          50%      { opacity: 1;   transform: translate(-50%, -50%) scale(1.07); }
        }
        @keyframes stencilDrift {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
          33%      { transform: translate3d(10px, -16px, 0) scale(1.05); }
          66%      { transform: translate3d(-8px, -6px, 0) scale(0.97); }
        }
        .stencil-glow-pulse { animation: stencilGlowPulse 10s ease-in-out infinite; }
        .stencil-blob        { animation: stencilDrift 20s ease-in-out infinite; }

        @media (prefers-reduced-motion: reduce) {
          .stencil-glow-pulse,
          .stencil-blob { animation: none; }
        }
      `}</style>
      <div className="relative z-10 mx-auto w-full max-w-7xl">
        <h2 className="font-inter-medium mx-auto max-w-3xl text-3xl font-medium tracking-tight text-slate-950 sm:text-4xl lg:text-5xl">
          <span className="block">Checks a sheet under 20s,</span>
          <span className="block italic">5x faster than manual</span>
        </h2>
        <p className="font-inter-regular mx-auto mt-5 max-w-xl text-base font-normal leading-6 text-muted-foreground">
          Stencil reads every handwritten page, maps it to your marking scheme,
          and drafts question-wise marks — teachers just review and approve.
        </p>
      </div>

      <div className="relative mx-auto mt-0 w-full max-w-5xl">
        {/* ---- Decorative layer (sits entirely behind the answer sheet) ----
            Anchored to the image's top edge and taller than it, so the flow
            spills out above the sheet; the section clips the overflow. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[130%]"
        >
          {/* Warm core the flow rises out of, sitting behind the sheet. */}
          <div className="stencil-glow-pulse absolute left-1/2 top-[16%] h-[38%] w-[42%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,150,40,0.22),rgba(255,170,60,0.09)_45%,transparent_70%)]" />

          {/* Organic flow: soft irregular blobs anchored to the top edge, so
              the light is visible spilling out above the answer sheet. */}
          {BLOBS.map((blob) => (
            <div
              key={blob.left}
              className="stencil-blob absolute"
              style={{
                left: blob.left,
                top: blob.top,
                width: blob.width,
                height: blob.height,
                opacity: blob.opacity,
                borderRadius: blob.radius,
                background:
                  "radial-gradient(ellipse at 50% 85%, rgba(255,168,64,0.75) 0%, rgba(255,180,90,0.34) 45%, rgba(255,190,120,0.10) 70%, transparent 100%)",
                filter: `blur(${blob.blur}px)`,
                animationDuration: blob.duration,
                animationDelay: blob.delay,
              }}
            />
          ))}

          {/* Edge fade so the effect dissolves into the white page. */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_18%_22%,transparent_40%,rgba(255,255,255,0.5)_70%,rgba(255,255,255,0.9)_88%,white_100%)]" />
        </div>

        {/* ---- Existing answer sheet (unchanged, now on top) ---- */}
        <div className="relative overflow-hidden rounded-2xl">
          <img
            src="/5xnobg.png"
            alt="Stencil checking an answer sheet five times faster than manual evaluation"
            loading="lazy"
            className="h-auto w-full object-cover"
          />
          <BottomVanishBlur />
        </div>
      </div>
    </section>
  );
}

