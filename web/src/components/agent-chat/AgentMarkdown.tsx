import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { MarkdownProseImg, MarkdownProseLink } from "../../lib/markdownTauriUrls";

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];
const components = { img: MarkdownProseImg, a: MarkdownProseLink };

export default function AgentMarkdown({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>{text}</ReactMarkdown>;
}
