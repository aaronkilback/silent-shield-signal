import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { Copy, Check } from "lucide-react";
import { formatSignalRef } from "@/lib/signal-ref";

interface CopyableSignalRefProps {
  signal: { id: string; signal_number?: string | null } | null | undefined;
  className?: string;
}

export function CopyableSignalRef({ signal, className }: CopyableSignalRefProps) {
  const [copied, setCopied] = useState(false);
  const ref = formatSignalRef(signal);

  const handleCopy = async (e: ReactMouseEvent) => {
    e.stopPropagation();
    if (!ref || ref === "—") return;
    try {
      await navigator.clipboard?.writeText(ref);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard API blocked — fallback: select the text so the user can copy manually
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? "Copied" : "Copy signal ID — paste into Support Chat or AEGIS"}
      className={
        "inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-0.5 rounded " +
        "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 " +
        "hover:bg-cyan-500/25 hover:border-cyan-400/50 active:bg-cyan-500/35 " +
        "transition-colors cursor-pointer select-all " +
        (className || "")
      }
    >
      <span>{ref}</span>
      {copied ? (
        <Check className="h-3 w-3 text-emerald-400" aria-label="Copied" />
      ) : (
        <Copy className="h-3 w-3 opacity-60" aria-label="Copy" />
      )}
    </button>
  );
}
