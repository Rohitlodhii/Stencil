import { motion } from "motion/react";
import { useRef } from "react";

/** Scattered collage. `x`/`y` are percentages of the card and `width` is a
 *  responsive Tailwind size. The layout is tuned so the centre column stays
 *  clear for the CTA. */
const SCATTER = [
  {
    src: "/reasearch/croppedone.jpg",
    alt: "Research note on traditional exam checking",
    x: "13%",
    y: "30%",
    width: "w-36 sm:w-48 lg:w-60",
  },
  {
    src: "/reasearch/osm.webp",
    alt: "Diagram of an exam evaluation pipeline",
    x: "87%",
    y: "28%",
    width: "w-36 sm:w-48 lg:w-60",
  },
  {
    src: "/reasearch/images.jpg",
    alt: "Photograph of a graded answer sheet",
    x: "10%",
    y: "70%",
    width: "w-24 sm:w-32 lg:w-40",
  },
  {
    src: "/reasearch/new.avif",
    alt: "Screenshot of an evaluation workflow",
    x: "90%",
    y: "68%",
    width: "w-40 sm:w-52 lg:w-64",
  },
  {
    src: "/reasearch/paper.jpg",
    alt: "Published paper referenced by the research",
    x: "24%",
    y: "88%",
    width: "w-28 sm:w-36 lg:w-44",
  },
  {
    src: "/reasearch/tweet2.jpg",
    alt: "Public discussion of marking errors",
    x: "78%",
    y: "86%",
    width: "w-24 sm:w-32 lg:w-40",
  },
  {
    src: "/reasearch/tweet3.jpg",
    alt: "Public discussion of marking errors",
    x: "50%",
    y: "20%",
    width: "w-28 sm:w-32 lg:w-36",
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
      {/* Heading + subline sit outside the panel. */}
      <div className="mx-auto w-full max-w-7xl text-center">
        <h2 className="font-inter-medium mx-auto max-w-3xl text-3xl font-medium tracking-tight text-slate-950 sm:text-4xl lg:text-5xl">
          Why Stencil exists?
        </h2>
        <p className="font-inter-regular mx-auto mt-4 max-w-xl text-base font-normal leading-6 text-muted-foreground">
          We saw the flaws in traditional checking — inconsistent evaluation,
          missed marks, disputed results, and cases of incorrect marking. We
          knew there had to be a better way.
        </p>
      </div>

      <div
        ref={panelRef}
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--color-border) 1px, transparent 1px), linear-gradient(to bottom, var(--color-border) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
        className="relative mx-auto mt-10 min-h-[460px] w-full max-w-6xl overflow-hidden rounded-xl border border-dashed border-border bg-accent px-6 py-12 sm:min-h-[540px] sm:px-10 sm:py-16 lg:min-h-[610px]"
      >
        {/* CTA centred in the panel, independent of the text block above. */}
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <button
            type="button"
            className="pointer-events-auto rounded-xl bg-primary p-1.5 transition-colors hover:bg-primary/90"
          >
            <span className="flex items-center justify-center rounded-lg border border-dashed border-white px-10 py-2.5 text-sm font-semibold text-primary-foreground">
              Our Research
            </span>
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
              className={`h-auto cursor-grab touch-none active:cursor-grabbing ${item.width}`}
            />
          </div>
        ))}
      </div>
    </section>
  );
}