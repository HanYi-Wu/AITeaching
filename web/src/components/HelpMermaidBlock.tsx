import { useEffect, useId, useRef } from "react";
import { initMermaid } from '../lib/mermaidInit';
import "../ui-redesign/g55/g55.css";

/** Renders a Mermaid diagram from fenced ```mermaid source (help manual only). */
export function HelpMermaidBlock({ source }: { source: string }) {
  const uid = useId().replace(/:/g, "");
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const id = `help-mmd-${uid}-${Math.random().toString(36).slice(2, 9)}`;
    let cancelled = false;
    void initMermaid().then(mermaid => mermaid.render(id, source.trim())).then(
      ({ svg }) => {
        if (!cancelled && hostRef.current) {
          hostRef.current.innerHTML = svg;
        }
      },
      () => {
        if (!cancelled && hostRef.current) {
          hostRef.current.innerHTML =
            '<p class="text-sm font-medium text-or-error">流程图无法渲染，请稍后再试。</p>';
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source, uid]);

  return (
    <div
      className="my-5 overflow-x-auto rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] p-5 shadow-sm   [&_svg]:mx-auto [&_svg]:max-w-full"
      ref={hostRef}
      role="img"
      aria-label="流程图"
    />
  );
}
