import type { Ref } from "react";

type DesktopLoginBackdropProps = {
  svgRef?: Ref<SVGSVGElement>;
};

/** The monochrome diagonal doors and opening wordmark used by the desktop login. */
export function DesktopLoginBackdrop({ svgRef }: DesktopLoginBackdropProps) {
  return (
    <>
      <svg
        ref={svgRef}
        className="or-login-desktop-backdrop"
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient
            id="or-login-black-cast-shadow"
            gradientUnits="userSpaceOnUse"
            x1="500"
            y1="500"
            x2="580.7"
            y2="514.5"
          >
            <stop offset="0%" stopColor="#000000" stopOpacity="0.38" />
            <stop offset="42%" stopColor="#000000" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </linearGradient>
          <linearGradient
            id="or-login-white-cast-shadow"
            gradientUnits="userSpaceOnUse"
            x1="500"
            y1="500"
            x2="425.2"
            y2="486.5"
          >
            <stop offset="0%" stopColor="#000000" stopOpacity="0.28" />
            <stop offset="42%" stopColor="#000000" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </linearGradient>
        </defs>

        <g data-pc-white-shadow>
          <polygon
            data-pc-white-shadow-poly
            points="587.2,-413.5 662,-400 338,1400 263.2,1386.5"
            fill="url(#or-login-white-cast-shadow)"
            opacity="0"
          />
        </g>
        <g data-pc-black-shadow transform="translate(620, 0)">
          <polygon
            data-pc-black-shadow-poly
            points="662,-400 742.7,-385.5 418.7,1414.5 338,1400"
            fill="url(#or-login-black-cast-shadow)"
            opacity="0"
          />
        </g>

        <g data-pc-white-door>
          <polygon points="662,-400 2100,-400 2100,1400 338,1400" fill="#ffffff" />
          <line
            data-pc-white-edge-trim
            x1="662"
            y1="-400"
            x2="338"
            y2="1400"
            stroke="var(--or-login-accent-color, #000000)"
            strokeWidth="2.4"
            vectorEffect="non-scaling-stroke"
            opacity="0"
          />
        </g>

        <g data-pc-black-door transform="translate(620, 0)">
          <polygon points="-1100,-400 662.8,-400 338.8,1400 -1100,1400" fill="var(--or-login-accent-color, #000000)" />
          <line
            data-pc-black-edge-trim
            x1="662.5"
            y1="-400"
            x2="338.5"
            y2="1400"
            stroke="var(--or-login-accent-ink, #ffffff)"
            strokeWidth="1.8"
            vectorEffect="non-scaling-stroke"
            opacity="0"
          />
        </g>

        <line
          data-pc-laser-up
          x1="500"
          y1="500"
          x2="500"
          y2="500"
          stroke="var(--or-login-accent-ink, #ffffff)"
          strokeWidth="2.6"
          vectorEffect="non-scaling-stroke"
          opacity="0"
        />
        <line
          data-pc-laser-down
          x1="500"
          y1="500"
          x2="500"
          y2="500"
          stroke="var(--or-login-accent-color, #000000)"
          strokeWidth="2.6"
          vectorEffect="non-scaling-stroke"
          opacity="0"
        />
      </svg>

      <div className="or-login-desktop-splash" aria-hidden="true">
        <div className="or-login-desktop-splash-title">
          <span className="or-login-desktop-splash-logo">
            <img src="/splash-logo.png" alt="" width="64" height="64" draggable="false" />
          </span>
          <span>源远教学平台</span>
        </div>
      </div>
    </>
  );
}
