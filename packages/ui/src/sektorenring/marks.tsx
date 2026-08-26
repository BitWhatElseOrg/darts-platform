import type { SVGProps } from "react";

/**
 * Drawn marks. Every state that carries colour also carries one of these,
 * so no information in the Sektorenring world depends on hue alone.
 * One family, one weight: solid fills and 1.5px strokes at a 16px box.
 */
type MarkProps = Omit<SVGProps<SVGSVGElement>, "viewBox" | "children">;

function Mark({ size = 14, ...props }: MarkProps & { readonly size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      height={size}
      viewBox="0 0 16 16"
      width={size}
      {...props}
    />
  );
}

/** Free: the board is open. A filled disc, like a scored single. */
export function MarkDisc(props: MarkProps & { readonly size?: number }) {
  return (
    <Mark {...props}>
      <circle cx="8" cy="8" fill="currentColor" r="4.5" />
    </Mark>
  );
}

/** Live: a match is running. The wire bar of an occupied wedge. */
export function MarkBar(props: MarkProps & { readonly size?: number }) {
  return (
    <Mark {...props}>
      <rect fill="currentColor" height="3.5" width="12" x="2" y="6.25" />
    </Mark>
  );
}

/** Finish: the double ring. The board's own sign for "this can end now". */
export function MarkDoubleRing(props: MarkProps & { readonly size?: number }) {
  return (
    <Mark {...props}>
      <circle cx="8" cy="8" fill="none" r="6.25" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="8" fill="currentColor" r="2.5" />
    </Mark>
  );
}

/** Blocked: hatched out, the way a broken board gets taped off. */
export function MarkHatch(props: MarkProps & { readonly size?: number }) {
  return (
    <Mark {...props}>
      <rect fill="none" height="11" stroke="currentColor" strokeWidth="1.5" width="11" x="2.5" y="2.5" />
      <path d="M3 13 13 3" stroke="currentColor" strokeWidth="1.5" />
    </Mark>
  );
}

/** Conflict: two wires crossing where they must not. */
export function MarkCross(props: MarkProps & { readonly size?: number }) {
  return (
    <Mark {...props}>
      <path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" stroke="currentColor" strokeWidth="1.5" />
    </Mark>
  );
}

/** Waiting: the clock hand of an overrunning match. */
export function MarkClock(props: MarkProps & { readonly size?: number }) {
  return (
    <Mark {...props}>
      <circle cx="8" cy="8" fill="none" r="6.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.5V8l2.75 1.75" stroke="currentColor" strokeLinecap="square" strokeWidth="1.5" />
    </Mark>
  );
}

/** Assign: a dart flight, pointing at the board it is going to. */
export function MarkFlight(props: MarkProps & { readonly size?: number }) {
  return (
    <Mark {...props}>
      <path d="M1.5 8h9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 3.5 14.5 8 9 12.5Z" fill="currentColor" />
    </Mark>
  );
}

/** Settled: a group that has finished playing. */
export function MarkCheck(props: MarkProps & { readonly size?: number }) {
  return (
    <Mark {...props}>
      <path
        d="M2.5 8.5 6.25 12 13.5 4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="square"
        strokeWidth="1.5"
      />
    </Mark>
  );
}

/** The wire chevron on a select. */
export function MarkChevron(props: MarkProps & { readonly size?: number }) {
  return (
    <Mark {...props}>
      <path d="M3.5 6 8 10.5 12.5 6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </Mark>
  );
}
