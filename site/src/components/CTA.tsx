import CopyCommand from "./CopyCommand";

export default function CTA() {
  return (
    <section className="relative py-20 md:py-24">
      {/* Dot grid background */}
      <div className="absolute inset-0 dot-grid-subtle opacity-15 pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-12 lg:gap-16">
          {/* Left: CTA content */}
          <div className="flex-1 max-w-lg">
            <p className="font-mono-label text-[11px] text-(--color-text-disabled) mb-5">
              OPEN SOURCE — MIT LICENSE
            </p>

            <h2 className="text-4xl md:text-5xl font-bold text-(--color-text-display) mb-4 tracking-[-0.02em]">
              Take control.
            </h2>

            <p className="text-base text-(--color-text-secondary) mb-8" style={{ fontWeight: 300 }}>
              Install ARC in one command. Manage every agent from one place.
            </p>

            {/* Install command with copy */}
            <div className="mb-6">
              <CopyCommand />
            </div>

            {/* Buttons */}
            <div className="flex flex-wrap gap-3">
              <a
                href="/docs/guide/getting-started"
                className="font-mono-label text-xs px-6 py-2.5 rounded-full bg-(--color-text-display) text-(--color-black) hover:opacity-85 transition-opacity duration-200"
              >
                READ THE DOCS
              </a>
              <a
                href="https://github.com/Codename-11/ARC"
                className="font-mono-label text-xs px-6 py-2.5 rounded-full border border-(--color-border-visible) text-(--color-text-primary) hover:border-(--color-text-secondary) transition-colors duration-200"
              >
                STAR ON GITHUB
              </a>
            </div>
          </div>

          {/* Right: dashboard screenshot */}
          <div className="flex-shrink-0 w-full lg:w-[400px] xl:w-[480px]">
            <img
              src="/dash-dark.png"
              alt="ARC web dashboard"
              className="w-full h-auto rounded-lg border border-(--color-border-visible)"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
