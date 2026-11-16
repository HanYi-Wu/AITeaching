/** The fixed monochrome diagonal background behind the desktop login card. */
export function DesktopLoginBackdrop() {
  return (
    <svg
      className="or-login-desktop-backdrop"
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <polygon points="662,-400 2100,-400 2100,1400 338,1400" fill="#ffffff" />
      <polygon points="-1100,-400 662.8,-400 338.8,1400 -1100,1400" fill="var(--or-login-accent-color, #000000)" />
    </svg>
  );
}
