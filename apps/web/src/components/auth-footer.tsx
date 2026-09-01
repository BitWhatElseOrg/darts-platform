import Image from "next/image";

import { sutterPrecisionInvertedLogo } from "@/assets";

export function AuthFooter() {
  return (
    <footer className="mt-8 flex min-h-11 w-full items-center justify-center gap-3 border-t border-slate-800/80 pt-6 text-sm text-slate-400">
      <span>powered by</span>
      <span className="relative block h-[4.5rem] w-[6.75rem] overflow-hidden">
        <Image
          alt="Sutter Precision"
          className="absolute left-1/2 top-1/2 h-36 w-36 max-w-none -translate-x-1/2 -translate-y-1/2"
          src={sutterPrecisionInvertedLogo}
        />
      </span>
    </footer>
  );
}
