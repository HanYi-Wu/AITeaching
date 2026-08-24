import type { Metadata } from "next";
import { Noto_Serif_SC } from "next/font/google";
import "./globals.css";

const display = Noto_Serif_SC({ variable: "--font-display", subsets: ["latin"], weight: ["600", "700", "900"] });

export const metadata: Metadata = {
  title: "EducationHelper · AI 教学辅助系统",
  description: "连接备课、组卷、作答、批改与学情分析的 AI 教学辅助系统。下载 EducationHelper 稳定版本与 Linux 部署源码。",
  openGraph: { title: "EducationHelper · 把教学工作连成一条线", description: "AI 驱动的 K12 教学与评价平台。下载稳定版本与 Linux 部署源码。", type: "website", images: [{ url: "/og.png", width: 1672, height: 941, alt: "EducationHelper 教学闭环" }] },
  twitter: { card: "summary_large_image", title: "EducationHelper · AI 教学辅助系统", description: "备课、组卷、考试、批改、分析与改进，一个完整教学闭环。", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className={display.variable}>{children}</body></html>;
}
