import CopyCommand from "./CopyCommand";

export default function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Dot grid background */}
      <div className="absolute inset-0 dot-grid-subtle opacity-30 pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-6 pt-28 pb-16 md:pt-36 md:pb-20 w-full">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-12 lg:gap-16">
          {/* Left: text content */}
          <div className="flex-1 min-w-0 max-w-xl">
            {/* Tertiary: label */}
            <p className="font-mono-label text-[11px] text-(--color-text-disabled) mb-5 animate-fade-up">
              AGENT RUNTIME CONTROL
            </p>

            {/* Primary: hero headline with logo */}
            <div className="flex items-center gap-4 md:gap-6 mb-6 animate-fade-up-delay-1">
              <img src="/logo.svg" alt="" className="h-12 w-12 md:h-16 md:w-16" />
              <h1 className="text-7xl md:text-8xl font-bold leading-[0.95] tracking-[-0.03em] text-(--color-text-display)">
                ARC
              </h1>
            </div>

            {/* Secondary: tagline */}
            <p className="text-lg md:text-xl text-(--color-text-secondary) leading-[1.6] mb-8 animate-fade-up-delay-2" style={{ fontWeight: 300 }}>
              One binary. One config directory.{" "}
              <span className="text-(--color-text-display)">Every AI coding agent</span> —
              profiles, supervision, hooks, memory, tasks, and a web dashboard.
            </p>

            {/* Install command with copy */}
            <div className="mb-6 animate-fade-up-delay-3">
              <CopyCommand />
            </div>

            {/* Buttons + version */}
            <div className="flex flex-wrap items-center gap-3 animate-fade-up-delay-4">
              <a
                href="/docs/guide/getting-started"
                className="font-mono-label text-xs px-6 py-2.5 rounded-full bg-(--color-text-display) text-(--color-black) hover:opacity-85 transition-opacity duration-200"
              >
                GET STARTED
              </a>
              <a
                href="https://github.com/Codename-11/ARC"
                className="font-mono-label text-xs px-6 py-2.5 rounded-full border border-(--color-border-visible) text-(--color-text-primary) hover:border-(--color-text-secondary) transition-colors duration-200"
              >
                VIEW SOURCE
              </a>
              <span className="font-mono-label text-[10px] text-(--color-text-disabled) ml-1 hidden md:inline">
                V{__ARC_VERSION__}
              </span>
            </div>
          </div>

          {/* Right: hero image */}
          <div className="flex-shrink-0 w-full lg:w-[480px] xl:w-[560px] animate-fade-up-delay-3">
            <img
              src="/arc-hero.svg"
              alt="ARC — Agent Runtime Control interface"
              className="w-full h-auto rounded-lg border border-(--color-border-visible)"
            />
          </div>
        </div>
      </div>

      {/* Bottom border */}
      <div className="max-w-6xl mx-auto px-6">
        <div className="border-b border-(--color-border)" />
      </div>
    </section>
  );
}
