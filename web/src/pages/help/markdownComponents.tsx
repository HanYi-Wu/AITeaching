import { Children, isValidElement, type ReactNode } from "react";
import { HelpMermaidBlock } from "../../components/HelpMermaidBlock";
import { MarkdownHelpFigureImg, MarkdownHelpLink } from "../../lib/markdownTauriUrls";

function codeBlockPlainText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(codeBlockPlainText).join("");
  if (children == null) return "";
  return String(children);
}

export const mdComponents = {
  h1: ({ children }: { children?: ReactNode }) => (
    <h1 className="mb-4 mt-8 border-b border-slate-200 pb-2 text-xl font-semibold text-slate-900 first:mt-0">{children}</h1>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h2 className="mb-3 mt-6 text-lg font-semibold text-slate-900">{children}</h2>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h3 className="mb-2 mt-4 text-base font-semibold text-slate-800">{children}</h3>
  ),
  p: ({ children }: { children?: ReactNode }) => <p className="mb-3 leading-relaxed text-slate-700">{children}</p>,
  ul: ({ children }: { children?: ReactNode }) => <ul className="mb-3 list-disc space-y-1 pl-6 text-slate-700">{children}</ul>,
  ol: ({ children }: { children?: ReactNode }) => <ol className="mb-3 list-decimal space-y-1 pl-6 text-slate-700">{children}</ol>,
  li: ({ children }: { children?: ReactNode }) => <li className="leading-relaxed">{children}</li>,
  a: MarkdownHelpLink,
  img: MarkdownHelpFigureImg,
  code: ({ className, children }: { className?: string; children?: ReactNode }) => {
    const inline = !className;
    if (inline) {
      return <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.9em] text-slate-800">{children}</code>;
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
      <pre className="mb-4 overflow-x-auto rounded-lg border border-slate-200 bg-slate-900 p-3 text-sm text-slate-100 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">
        {children}
      </pre>
    );
  },
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="mb-4 border-l-4 border-slate-300 pl-4 italic text-slate-600">{children}</blockquote>
  ),
  table: ({ children }: { children?: ReactNode }) => (
    <div className="mb-4 overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full border-collapse text-left text-sm text-slate-800">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: ReactNode }) => <thead className="bg-slate-100">{children}</thead>,
  th: ({ children }: { children?: ReactNode }) => (
    <th className="border-b border-slate-200 px-3 py-2 font-semibold">{children}</th>
  ),
  td: ({ children }: { children?: ReactNode }) => <td className="border-b border-slate-100 px-3 py-2">{children}</td>,
  hr: () => <hr className="my-6 border-slate-200" />,
};
