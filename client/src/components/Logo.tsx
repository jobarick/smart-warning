interface Props {
  /** Rendered height in px. Width follows the mark's own proportions. */
  size?: number;
  className?: string;
  /**
   * Marks the logo as decorative when a visible wordmark sits beside it —
   * otherwise a screen reader announces the product name twice in a row.
   */
  decorative?: boolean;
}

/**
 * The Smart Warning mark.
 *
 * Inlined rather than loaded from `/logo.svg` so it paints with the first frame:
 * this appears on the boot splash and the entry gate, which are exactly the
 * moments when a second network round trip is most likely to fail or lag. It is
 * also why it inherits `currentColor` — the same element serves the dark and
 * light themes, and the alert states that recolour their own chrome.
 *
 * Geometry is duplicated from `public/logo.svg`; if the mark ever changes, both
 * change together.
 */
export function Logo({ size = 24, className, decorative = false }: Props) {
  return (
    <svg
      className={className}
      height={size}
      width={size * (683 / 1245)}
      viewBox="0 0 683 1245"
      fill="currentColor"
      role={decorative ? 'presentation' : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : 'Smart Warning'}
      focusable="false"
    >
      <path d="M8 495 L180 369.4 L180 651.4 L8 544.6 Z" />
      <path d="M8 582.6 L180 689.4 L180 1119.4 L8 1245 Z" />
      <path d="M245 142.4 L440 0 L440 812.8 L245 691.8 Z" />
      <path d="M255 736 L430 844.6 L405 1050 L280 1050 Z" />
      <path d="M275 1115 L410 1115 L410 1245 L275 1245 Z" />
      <path d="M505 335 L675 210.9 L675 958.8 L505 853.2 Z" />
      <path d="M505 891.2 L675 996.8 L675 1120.9 L505 1245 Z" />
    </svg>
  );
}
