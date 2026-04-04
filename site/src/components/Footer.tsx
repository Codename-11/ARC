export default function Footer() {
  return (
    <footer className="border-t border-(--color-border) py-8">
      <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        {/* Left */}
        <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
          <div className="flex items-center gap-2.5">
            <img src="/logo.svg" alt="ARC" className="h-4 w-4" />
            <span className="font-mono-label text-[11px] text-(--color-text-primary) tracking-widest">
              ARC
            </span>
          </div>
          <span className="text-xs text-(--color-text-disabled)">
            Agent Runtime Control — by Axiom-Labs
          </span>
        </div>

        {/* Right: links */}
        <div className="flex flex-wrap items-center gap-4 md:gap-6">
          <FooterLink href="/docs/">Docs</FooterLink>
          <FooterLink href="/docs/guide/getting-started">Guide</FooterLink>
          <FooterLink href="https://github.com/Codename-11/ARC">GitHub</FooterLink>
          <FooterLink href="https://github.com/Codename-11/ARC/issues">Issues</FooterLink>
        </div>
      </div>

      {/* Bottom */}
      <div className="max-w-6xl mx-auto px-6 mt-6 pt-4 border-t border-(--color-border) flex flex-col md:flex-row items-start md:items-center justify-between gap-2">
        <p className="font-mono-label text-[10px] text-(--color-text-disabled)">
          MIT — {new Date().getFullYear()} AXIOM-LABS
        </p>
        <p className="font-mono-label text-[10px] text-(--color-text-disabled)">
          BUILT WITH NOTHING IN MIND
        </p>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="font-mono-label text-[11px] text-(--color-text-secondary) hover:text-(--color-text-display) transition-colors duration-200"
    >
      {children}
    </a>
  );
}
