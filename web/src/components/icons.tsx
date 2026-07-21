/**
 * Hand-authored inline SVG icons, single-color via `currentColor`
 * (docs/design-system.md § Iconography — no icon library is on the
 * dependency allowlist). Icons are always neutral (inherit
 * --color-text-primary or --color-text-muted from context); only
 * text/edges/chips carry level color.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 20 20",
    fill: "none",
    "aria-hidden": true,
    focusable: false,
    ...props,
  };
}

export function IconCloudUpload(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M6 15.5a3.5 3.5 0 0 1-.5-6.965A4.5 4.5 0 0 1 14.2 7.06 3.5 3.5 0 0 1 14 15.5H6Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M10 13V8m0 0 2.2 2.2M10 8 7.8 10.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconFile(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M6 2.75h5.5L15.25 6.5V16a1.25 1.25 0 0 1-1.25 1.25h-8A1.25 1.25 0 0 1 4.75 16V4A1.25 1.25 0 0 1 6 2.75Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M11.25 2.75V6.5H15" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export function IconDocker(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M3 10.6c0-.2.15-.35.35-.35h11.6c.35 2.6-1.6 5.1-4.6 5.1H8.4C5.3 15.35 3 13.2 3 10.6Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M5.2 8.6h1.7v1.65H5.2V8.6ZM7.6 8.6h1.7v1.65H7.6V8.6ZM10 8.6h1.7v1.65H10V8.6ZM7.6 6.4h1.7v1.65H7.6V6.4ZM10 6.4h1.7v1.65H10V6.4Z" fill="currentColor" />
      <path d="M15.3 9c1.1-.35 1.9-.15 1.9-.15s.15 1-.85 1.55c-.6.35-1.4.25-1.4.25" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8.75" cy="8.75" r="4.25" stroke="currentColor" strokeWidth="1.4" />
      <path d="m12.2 12.2 3.05 3.05" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 6h11M8.25 6V4.5h3.5V6M6 6l.6 9a1 1 0 0 0 1 .95h4.8a1 1 0 0 0 1-.95l.6-9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.4 8.6v5M11.6 8.6v5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function IconPause(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8.2 7.3v5.4M11.8 7.3v5.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8.4 7.1v5.8l5-2.9-5-2.9Z" fill="currentColor" />
    </svg>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m5.5 8 4.5 4.5L14.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconX(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Circled "i" — spec 003 § Design tokens used ("new hand-authored icon,
 *  added to design-system.md § Iconography"); used only for the Files
 *  section's no-file-target framework note. */
export function IconInfo(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="10" cy="6.7" r="0.95" fill="currentColor" />
      <path d="M10 9.2v4.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function IconArrowDown(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 4v11.2M5.5 11.2 10 15.7l4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Triangle + exclamation — spec 004 § Iconography. Decorative, always
 *  paired with a visible text label/number (per-source error badge, Errors
 *  tab, Errors Only toggle, Latest Error button). */
export function IconWarning(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 3.2 17.3 16H2.7L10 3.2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M10 8.3v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="10" cy="14.3" r="0.95" fill="currentColor" />
    </svg>
  );
}

/** Lightning bolt — spec 004 § Iconography. Used only inside the SPIKING
 *  chip, always paired with the word "SPIKING". */
export function IconBolt(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M11.2 2.5 4.8 11.3h4l-1 6.2 7.4-9.6h-4.2l1.2-5.4Z" fill="currentColor" />
    </svg>
  );
}

/** Four-point sparkle/diamond — spec 004 § Iconography. "Generate AI
 *  Prompt", both entry points (Errors panel card + stream row expanded
 *  panel). */
export function IconSparkle(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M10 2.3c.45 3.35 1.15 5.1 2.2 6.15S14.85 10 18.2 10.45c-3.35.45-5.1 1.15-6.15 2.2S10.45 15.6 10 18.95c-.45-3.35-1.15-5.1-2.2-6.15S5.15 10.9 1.8 10.45c3.35-.45 5.1-1.15 6.15-2.2S9.55 5.65 10 2.3Z"
        fill="currentColor"
      />
    </svg>
  );
}
