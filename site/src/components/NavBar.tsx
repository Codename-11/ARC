import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";

export default function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-colors duration-200 ${
        scrolled || mobileOpen
          ? "bg-(--color-black) border-b border-(--color-border)"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <a href="/" className="flex items-center gap-3">
          <img src="/logo.svg" alt="ARC" className="h-6 w-6" />
          <span className="font-mono-label text-sm text-(--color-text-display) tracking-widest">
            ARC
          </span>
        </a>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-8">
          <NavLink href="/docs/">DOCS</NavLink>
          <NavLink href="https://github.com/Codename-11/ARC">GITHUB</NavLink>
          <a
            href="/docs/guide/getting-started"
            className="font-mono-label text-xs px-5 py-2.5 rounded-full bg-(--color-text-display) text-(--color-black) hover:opacity-85 transition-opacity duration-200"
          >
            GET STARTED
          </a>
        </div>

        {/* Mobile: CTA + hamburger */}
        <div className="flex md:hidden items-center gap-4">
          <a
            href="/docs/guide/getting-started"
            className="font-mono-label text-[11px] px-4 py-2 rounded-full bg-(--color-text-display) text-(--color-black)"
          >
            GET STARTED
          </a>
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="text-(--color-text-secondary) p-1"
            aria-label="Menu"
          >
            {mobileOpen ? <X size={20} strokeWidth={1.5} /> : <Menu size={20} strokeWidth={1.5} />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="md:hidden border-t border-(--color-border) bg-(--color-black) px-6 py-4 flex flex-col gap-4">
          <MobileLink href="/docs/" onClick={() => setMobileOpen(false)}>DOCS</MobileLink>
          <MobileLink href="https://github.com/Codename-11/ARC" onClick={() => setMobileOpen(false)}>GITHUB</MobileLink>
        </div>
      )}
    </nav>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="font-mono-label text-xs text-(--color-text-secondary) hover:text-(--color-text-display) transition-colors duration-200"
    >
      {children}
    </a>
  );
}

function MobileLink({ href, children, onClick }: { href: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <a
      href={href}
      onClick={onClick}
      className="font-mono-label text-xs text-(--color-text-secondary) hover:text-(--color-text-display) py-2 border-b border-(--color-border)"
    >
      {children}
    </a>
  );
}
