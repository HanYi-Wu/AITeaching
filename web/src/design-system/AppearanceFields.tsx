import type { CSSProperties } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ACCENT_COLORS } from "./tokens";
import type { Appearance } from "./appearance";

const colors = {
  blue: ["蓝色", "Blue"], purple: ["紫色", "Purple"], pink: ["粉色", "Pink"], red: ["红色", "Red"],
  orange: ["橙色", "Orange"], yellow: ["黄色", "Yellow"], green: ["绿色", "Green"], gray: ["灰色", "Gray"],
  black: ["黑色", "Black"],
};

export function AppearanceFields({ value, onChange }: { value: Appearance; onChange: (value: Appearance) => void }) {
  const { i18n } = useTranslation();
  const en = (i18n.resolvedLanguage || i18n.language || "zh").startsWith("en");
  const modes = [
    { id: "light", label: en ? "Light" : "浅色", Icon: Sun },
    { id: "dark", label: en ? "Dark" : "深色", Icon: Moon },
    { id: "system", label: en ? "System" : "系统", Icon: Monitor },
  ] as const;
  return (
    <div className="or-appearance-fields">
      <fieldset>
        <legend className="mb-2.5 text-sm font-medium">{en ? "Appearance" : "颜色模式"}</legend>
        <div className="or-mode-options" style={{ "--selected-index": modes.findIndex((item) => item.id === value.mode) } as CSSProperties}>
          <span className="or-mode-indicator" aria-hidden="true" />
          {modes.map(({ id, label, Icon }) => (
            <label className="or-mode-option" key={id}>
              <input className="sr-only" type="radio" name="appearance-mode" value={id} aria-label={id === "system" ? (en ? "Follow system" : "跟随系统") : label} checked={value.mode === id} onChange={() => onChange({ ...value, mode: id })} />
              <span className="or-mode-surface"><Icon size={18} /><span>{label}</span><span className="or-mode-balance" aria-hidden="true" /></span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2.5 text-sm font-medium">{en ? "Accent color" : "强调色"}</legend>
        <div className="or-accent-options">
          {Object.entries(ACCENT_COLORS).map(([id, color]) => (
            <label className="or-accent-option" key={id} style={{ "--swatch": color } as CSSProperties}>
              <input className="sr-only" type="radio" name="appearance-accent" value={id} aria-label={colors[id as keyof typeof colors][en ? 1 : 0]} checked={value.accent === id} onChange={() => onChange({ ...value, accent: id as Appearance["accent"] })} />
              <span className="or-accent-swatch"><Check size={18} strokeWidth={2.5} aria-hidden="true" /></span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
