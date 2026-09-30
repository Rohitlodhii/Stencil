"use client";

import { useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

/** How-it-works landing section: coordinator exam creation step. */
export function HowItWorksSection() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);

  const toggleVideo = async () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      await video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  return (
    <section className="w-full px-6 pb-16 text-center sm:pb-24">
      <h2 className="font-inter-medium mx-auto max-w-3xl text-3xl font-medium tracking-tight text-slate-950 sm:text-4xl lg:text-5xl">
        How it works
      </h2>

      <div className="mx-auto mt-10 grid w-full max-w-6xl gap-6 text-left">
        <div className="rounded-2xl bg-accent px-6 py-10 sm:px-10 sm:py-12">
          <span className="font-inter-medium inline-flex rounded-xl bg-background px-4 py-2 text-sm font-medium tracking-tight text-slate-950">
            1. Coordinator creates exam
          </span>
          <p className="font-inter-regular mt-4 max-w-xl text-base font-normal leading-6 text-muted-foreground">
            Coordinator uploads the question paper, assigns teachers, and creates
            an exam.
          </p>

          <div className="relative mt-8 w-full overflow-hidden rounded-xl">
            <video
              ref={videoRef}
              autoPlay
              loop
              muted
              playsInline
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              className="aspect-video h-auto w-full object-cover"
            >
              <source src="/question.mp4" type="video/mp4" />
            </video>
            <button
              type="button"
              onClick={toggleVideo}
              aria-label={isPlaying ? "Pause video" : "Play video"}
              className="absolute bottom-4 left-4 flex h-9 w-9 items-center justify-center rounded-full bg-slate-950/80 text-white backdrop-blur transition-colors hover:bg-slate-950"
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <section aria-label="Landing page section two" className="h-96 rounded-2xl bg-accent px-6 py-10 sm:px-10 sm:py-12">
            <span className="font-inter-medium inline-flex rounded-xl bg-background px-4 py-2 text-sm font-medium tracking-tight text-slate-950 shadow-none">
              2. Teacher accepts exam
            </span>
            <p className="font-inter-regular mt-4 max-w-xl text-base font-normal leading-6 text-muted-foreground">
              Teacher reviews the exam details and accepts the evaluation
              assignment.
            </p>
          </section>
          <section aria-label="Landing page section three" className="h-96 rounded-2xl bg-accent px-6 py-10 sm:px-10 sm:py-12">
            <span className="font-inter-medium inline-flex rounded-xl bg-background px-4 py-2 text-sm font-medium tracking-tight text-slate-950 shadow-none">
              3. Verifies the students list
            </span>
            <p className="font-inter-regular mt-4 max-w-xl text-base font-normal leading-6 text-muted-foreground">
              Confirms the uploaded roster so every answer sheet maps to the
              right student.
            </p>
          </section>
        </div>
      </div>
    </section>
  );
}

