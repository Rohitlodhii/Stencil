"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Landing video player with a skeleton placeholder until the first frames
 *  are buffered.
 *
 *  The wrapper keeps `aspect-video` (both landing videos are 1920x1080), so
 *  the gray skeleton reserves the final box up front — nothing reflows when
 *  the video appears, and the hero/showcase content is never pushed around
 *  by a late-loading <video>. The video itself fades in on `canplay`.
 *
 *  Lazy by default: the <source> is only attached once the wrapper comes
 *  within ~300px of the viewport, so below-the-fold videos cost zero bytes
 *  up front instead of eagerly downloading tens of megabytes on landing.
 */
export function VideoPlayer({ src, className = "" }: { src: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [isNearView, setIsNearView] = useState(false);

  // Attach the source only when the player is about to scroll into view.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // No IntersectionObserver (very old browsers): fall back to eager load.
    if (typeof IntersectionObserver === "undefined") {
      setIsNearView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsNearView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px 0px" },
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // `<source>` is inserted after mount, so kick the media element's load
  // algorithm — autoPlay then starts the fetch + playback.
  useEffect(() => {
    if (isNearView) videoRef.current?.load();
  }, [isNearView]);

  // Cached video can reach `readyState >= HAVE_CURRENT_DATA` before React
  // attaches its handlers (during hydration) — check on mount so the
  // skeleton never gets stuck.
  useEffect(() => {
    const video = videoRef.current;
    if (video && video.readyState >= 2) setIsReady(true);
  }, []);

  const markReady = () => setIsReady(true);

  // `loop` is set on the element, but some embedded webviews / browsers
  // ignore it for streamed mp4s and just stop on the last frame. Rewind on
  // `ended` so playback always cycles.
  const restartVideo = async () => {
    const video = videoRef.current;
    if (!video) return;

    video.currentTime = 0;
    try {
      await video.play();
    } catch {
      // Autoplay can be rejected (e.g. unmounted mid-seek); the next
      // user-initiated play() resumes normally.
    }
  };

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
    <div ref={containerRef} className={`relative aspect-video w-full overflow-hidden ${className}`}>
      {!isReady && (
        <div
          aria-hidden="true"
          className="absolute inset-0 z-10 flex animate-pulse items-center justify-center bg-slate-200"
        >
          <span className="h-10 w-10 animate-spin rounded-full border-4 border-slate-300 border-t-slate-950" />
        </div>
      )}

      <video
        ref={videoRef}
        autoPlay
        loop
        muted
        playsInline
        preload={isNearView ? "auto" : "none"}
        onLoadedData={markReady}
        onCanPlay={markReady}
        onError={markReady}
        onEnded={restartVideo}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        className={`h-full w-full object-cover transition-opacity duration-500 ${
          isReady ? "opacity-100" : "opacity-0"
        }`}
      >
        {isNearView && <source src={src} type="video/mp4" />}
      </video>

      <button
        type="button"
        onClick={toggleVideo}
        aria-label={isPlaying ? "Pause video" : "Play video"}
        className="absolute bottom-4 left-4 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-slate-950/80 text-white backdrop-blur transition-colors hover:bg-slate-950"
      >
        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
    </div>
  );
}
