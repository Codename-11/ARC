import { useState, useCallback } from "react";
import { Copy, Check } from "lucide-react";

const COMMAND = "npm i -g @axiom-labs/arc-cli";

export default function CopyCommand() {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(COMMAND).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  return (
    <button
      onClick={handleCopy}
      className="group inline-flex items-center gap-3 bg-(--color-surface) border border-(--color-border-visible) rounded-lg px-4 py-2.5 hover:border-(--color-text-disabled) transition-colors duration-200 cursor-pointer"
    >
      <span className="text-(--color-accent) font-mono text-sm select-none">$</span>
      <code className="font-mono text-sm text-(--color-text-primary)">
        {COMMAND}
      </code>
      <span className="ml-2 flex items-center gap-1.5">
        {copied ? (
          <>
            <Check size={14} strokeWidth={1.5} className="text-(--color-accent)" />
            <span className="font-mono-label text-[10px] text-(--color-accent)">[COPIED]</span>
          </>
        ) : (
          <Copy size={14} strokeWidth={1.5} className="text-(--color-text-disabled) group-hover:text-(--color-text-secondary) transition-colors duration-200" />
        )}
      </span>
    </button>
  );
}
