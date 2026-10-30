// The chalk lettering filter shared by the blackboard screens (home, profiles, new session).

/**
 * The chalk look for the home board's headings: a little displacement for rough edges and a grain
 * mask that leaves gaps, the way chalk skips over a board. Render it once per screen; `.chalk` (styles.css) uses it.
 */
export function ChalkFilter() {
  return (
    <svg className="chalk-defs" aria-hidden="true" focusable="false">
      <filter id="chalk-text" x="-5%" y="-10%" width="110%" height="120%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.8" xChannelSelector="R" yChannelSelector="G" result="rough" />
        <feColorMatrix in="noise" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 4 -0.75" result="grain" />
        <feComposite in="rough" in2="grain" operator="in" />
      </filter>
    </svg>
  );
}
