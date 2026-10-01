import { motion } from "motion/react";
import { useRef } from "react";

/** Scattered collage. `x`/`y` are percentages of the card, `width` is a
 *  responsive Tailwind size, and `rotate` is the resting tilt. The layout is
 *  tuned so the centre column stays clear for the title, subline and CTA. */
const SCATTER = [
  {
    src: "/reasearch/croppedone.jpg",
    alt: "Research note on traditional exam checking",
    x: "14%",
    y: "26%",
    width: "w-28 sm:w-36 lg:w-44",
    rotate: 8,
  },
  {
    src: "/reasearch/osm.webp",
    alt: "Diagram of an exam evaluation pipeline",
    x: "86%",
    y: "24%",
    width: "w-28 sm:w-36 lg:w-44",
    rotate: -10,
  },
  {
    src: "/reasearch/images.jpg",
    alt: "Photograph of a graded answer sheet",
    x: "10%",
    y: "54%",
    width: "w-20 sm:w-24 lg:w-28",
    rotate: -6,
  },
  {
    src: "/reasearch/new.avif",
    alt: "Screenshot of an evaluation workflow",
    x: "90%",
    y: "52%",
    width: "w-32 sm:w-40 lg:w-48",
    rotate: 12,
  },
  {
    src: "/reasearch/paper.jpg",
    alt: "Published paper referenced by the research",
    x: "21%",
    y: "81%",
    width: "w-24 sm:w-28 lg:w-32",
    rotate: 5,
  },
  {
    src: "/reasearch/tweet2.jpg",
    alt: "Public discussion of marking errors",
    x: "81%",
    y: "79%",
    width: "w-20 sm:w-24 lg:w-28",
    rotate: -4,
  },
];

/** Landing section: the problem Stencil is built to solve, framed by the
 *  research that motivated it. The cards are draggable within the panel. */
export function WhyThisExist() {
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <section
      id="why"
      className="w-full scroll-mt-8 px-6 py-12 sm:py-16"
    >
      <div
        ref={panelRef}
        className="relative mx-auto min-h-[660px] w-full max-w-7xl overflow-hidden rounded-xl border border-dashed border-border px-6 py-12 sm:min-h-[780px] sm:px-10 sm:py-16 lg:min-h-[880px]"
      >
        <div className="relative z-20 text-center">
          <h2 className="font-inter-medium mx-auto max-w-3xl text-3xl font-medium tracking-tight text-slate-950 sm:text-4xl lg:text-5xl">
            Why Stencil exists?
          </h2>
          <p className="font-inter-regular mx-auto mt-4 max-w-xl text-base font-normal leading-6 text-muted-foreground">
            We saw the flaws in traditional checking — inconsistent evaluation,
            missed marks, disputed results, and cases of incorrect marking. We
            knew there had to be a better way.
          </p>

          <button
            type="button"
            className="mt-8 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Our Research
          </button>
        </div>

        {SCATTER.map((item) => (
          <div
            key={item.src}
            className="absolute"
            style={{ left: item.x, top: item.y, transform: "translate(-50%, -50%)" }}
          >
            <motion.img
              src={item.src}
              alt={item.alt}
              drag
              dragConstraints={panelRef}
              dragMomentum={false}
              dragElastic={0}
              whileDrag={{ scale: 1.08, zIndex: 30 }}
              style={{ rotate: item.rotate }}
              className={`h-auto cursor-grab touch-none rounded-lg border border-border bg-muted object-cover shadow-lg active:cursor-grabbing ${item.width}`}
            />
          </div>
        ))}
      </div>
    </section>
  );
}