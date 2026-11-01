import { Children, isValidElement, type ReactNode } from "react";
import { HelpMermaidBlock } from "../../components/HelpMermaidBlock";
import { MarkdownHelpFigureImg, MarkdownHelpLink } from "../../lib/markdownTauriUrls";
import "../../ui-redesign/g55/g55.css";

function codeBlockPlainText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(codeBlockPlainText).join("");
  if (children == null) return "";
  return String(children);
}

export const mdComponents = {
  h1: ({ children }: { children?: ReactNode }) => (
    <h1 className="mb-4 mt-8 border-b border-[var(--or-outline)] pb-2.5 text-xl font-bold tracking-tight text-[var(--or-text)] first:mt-0  ">
      {children}
    </h1>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h2 className="mb-3 mt-7 text-lg font-bold tracking-tight text-[var(--or-text)] ">
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h3 className="mb-2 mt-5 text-base font-semibold text-[var(--or-text)] ">
      {children}
    </h3>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className="mb-3.5 text-[15px] leading-relaxed text-[var(--or-muted)] ">
      {children}
    </p>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="mb-3.5 list-disc space-y-1.5 pl-6 text-[15px] text-[var(--or-muted)] ">
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="mb-3.5 list-decimal space-y-1.5 pl-6 text-[15px] text-[var(--or-muted)] ">
      {children}
    </ol>
  ),
  li: ({ children }: { children?: ReactNode }) => <li className="leading-relaxed">{children}</li>,
  a: MarkdownHelpLink,
  img: MarkdownHelpFigureImg,
  code: ({ className, children }: { className?: string; children?: ReactNode }) => {
    const inline = !className;
    if (inline) {
      return (
        <code className="rounded-md bg-[var(--or-block)] px-1.5 py-0.5 font-mono text-[0.88em] text-or-primary ">
          {children}
        </code>
      );
    }
    return <code className={className}>{children}</code>;
  },
  pre: ({ children }: { children?: ReactNode }) => {
    const only = Children.toArray(children)[0];
    if (
      isValidElement(only) &&
      typeof only.props === "object" &&
      only.props !== null &&
      "className" in only.props &&
      typeof (only.props as { className?: string }).className === "string" &&
      (only.props as { className: string }).className.includes("language-mermaid")
    ) {
      const src = codeBlockPlainText((only.props as { children?: ReactNode }).children).replace(/\n$/, "");
      return <HelpMermaidBlock source={src} />;
    }
    return (
      <pre className="mb-4 overflow-x-auto rounded-xl border border-[var(--or-outline)] bg-[var(--or-primary)] p-3.5 text-xs text-[var(--or-on-primary)]  [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">
        {children}
      </pre>
    );
  },
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="mb-4 border-l-4 border-or-primary bg-or-primary-container p-3 italic text-[var(--or-muted)] ">
      {children}
    </blockquote>
  ),
  table: ({ children }: { children?: ReactNode }) => (
    <div className="mb-4 overflow-x-auto rounded-xl border border-[var(--or-outline)] ">
      <table className="min-w-full border-collapse text-left text-sm text-[var(--or-text)] ">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }: { children?: ReactNode }) => (
    <thead className="bg-[color-mix(in_srgb,var(--or-block)_80%,transparent)] font-semibold ">{children}</thead>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className="border-b border-[var(--or-outline)] px-3.5 py-2.5 font-semibold ">{children}</th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className="border-b border-[var(--or-outline)] px-3.5 py-2.5 ">{children}</td>
  ),
  hr: () => <hr className="my-6 border-[var(--or-outline)] " />,
};
