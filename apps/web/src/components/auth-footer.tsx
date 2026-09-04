import Image from "next/image";

import { sutterPrecisionInvertedLogo } from "@/assets";

export function AuthFooter() {
  return (
    <footer className="mt-8 flex min-h-11 w-full items-center justify-center gap-3 border-t border-slate-800/80 bg-slate-950 pt-6 text-body text-slate-400">
      <span>powered by</span>
      <a
        aria-label="Website von Sutter Precision öffnen (öffnet in neuem Tab)"
        className="block rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
        href="https://www.sutter-precision.ch/"
        rel="noopener noreferrer"
        target="_blank"
      >
        <span className="relative block h-[4.5rem] w-[6.75rem] overflow-hidden">
          <Image
            alt="Sutter Precision"
            className="absolute left-1/2 top-1/2 h-36 w-36 max-w-none -translate-x-1/2 -translate-y-1/2"
            src={sutterPrecisionInvertedLogo}
          />
        </span>
      </a>
    </footer>
  );
}
