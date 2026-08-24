import DownloadCommand from "./download-command";

const capabilities = [
  ["01", "教学内容", "统一题库、知识图谱与文件资料，内容保存后立即进入组卷工作流。"],
  ["02", "考试闭环", "覆盖发布、学生作答、图片答案、人工批改、成绩发布与逐题复盘。"],
  ["03", "学情洞察", "从班级到学生、从试卷到知识点，按时间范围呈现真实学习状态。"],
  ["04", "教师 AI", "让教师用自然语言调用教学工具；高风险操作保留确认和人工决策。"],
];

const versions = [
  { version: "1.5.1", date: "2026-08-25", label: "当前稳定版", notes: ["修复管理员平台 AI 配置保存与真实连接测试", "重排管理员工作台并完善跨平台扩展安装引导", "新增校验、健康检查和失败回滚的一键 Linux 升级"] },
  { version: "1.5.0", date: "2026-08-24", label: "体验优化", notes: ["新增各角色首次使用引导与清晰的下一步入口", "完善交卷确认、批改统计和成绩发布后的逐题复盘", "题目与模板默认使用简单模式，AI 助手状态更清楚"] },
  { version: "1.4.8", date: "2026-08", label: "工作流整合", notes: ["升级 EducationHelper 品牌并兼容旧数据", "贯通作答、图片答案、逐题批改与学生错题分析", "统一教师题库并补充个性化设置"] },
  { version: "1.4.7", date: "2026-08", label: "线上线下统一", notes: ["统一线上与线下历史考试入口", "线下答卷支持按学生上传多张照片", "新增学生详细画像与对应 AI 工具"] },
  { version: "1.4.6", date: "2026-08", label: "答题与批改", notes: ["完善断线恢复、限时自动提交与考试行为事件", "教师可按学生查看答卷并进行人工或 AI 预批改"] },
  { version: "1.4.5", date: "2026-08", label: "中文体验", notes: ["默认界面语言调整为中文", "修复 PDF 预览与图片答卷定位", "历史考试开始统一展示线上、线下记录"] },
  { version: "1.4.4", date: "2026-08", label: "专项复习", notes: ["组卷发布页新增专项复习试卷及 AI 工具关联", "三份来源试卷即可生成个性化变式练习"] },
  { version: "1.4.3", date: "2026-08", label: "历史错题", notes: ["新增历史错题试卷及 AI 工具关联", "按学生真实错题生成个性化练习并冻结历史内容"] },
];

export default function Home() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="EducationHelper 首页"><span className="brand-mark">EH</span><span>EducationHelper</span></a>
        <nav aria-label="页面导航">
          <a href="#capabilities">产品能力</a><a href="#releases">下载</a><a href="#versions">版本记录</a>
          <a href="https://github.com/HanYi-Wu/AITeaching" target="_blank" rel="noreferrer">GitHub ↗</a>
        </nav>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">AI-ASSISTED TEACHING SYSTEM · 1.5.1</p>
          <h1>把教学工作<br />连成一条线。</h1>
          <p className="hero-intro">EducationHelper 面向学校、教师与学生，把备课、组卷、作答、批改和学情分析放进同一个可追溯的教学闭环。</p>
          <div className="hero-actions"><a className="button primary" href="#releases">下载当前版本</a><a className="button quiet" href="#versions">查看更新路径</a></div>
        </div>
        <div className="release-stamp" aria-label="当前版本 1.5.1">
          <span className="stamp-kicker">CURRENT RELEASE</span><strong>1.5</strong><span className="stamp-zero">.1</span>
          <div className="stamp-meta"><span>稳定版</span><span>2026.08</span></div>
        </div>
      </section>

      <section className="capabilities section" id="capabilities">
        <div className="section-heading"><p className="eyebrow">WHAT IT CONNECTS</p><h2>不是零散工具，<br />是一条完整教学链。</h2></div>
        <div className="capability-grid">
          {capabilities.map(([number, title, text]) => <article className="capability-card" key={number}><span className="card-number">{number}</span><h3>{title}</h3><p>{text}</p></article>)}
        </div>
      </section>

      <section className="workflow section" aria-label="教学工作流">
        <p className="eyebrow">ONE CONTINUOUS LOOP</p>
        <div className="workflow-row">{['备课', '组卷', '考试', '批改', '分析', '改进'].map((step, index) => <div className="workflow-step" key={step}><span>{String(index + 1).padStart(2, '0')}</span><strong>{step}</strong></div>)}</div>
      </section>

      <section className="releases section" id="releases">
        <div className="release-title"><div><p className="eyebrow">RELEASE CENTER</p><h2>获取 EducationHelper</h2></div><div className="release-badge"><span className="status-dot" />1.5.1 稳定版</div></div>
        <div className="download-grid">
          <article className="download-card featured">
            <div><span className="platform">LINUX SERVER</span><h3>Linux 精简源码包</h3><p>用于后续远程部署。已排除 Windows 桌面壳、测试集、缓存、数据库、密钥和本地内容。</p></div>
            <dl><div><dt>格式</dt><dd>tar.gz</dd></div><div><dt>大小</dt><dd>1.58 MB</dd></div><div><dt>文件</dt><dd>569</dd></div></dl>
            <a className="button primary download" href="/releases/EducationHelper-1.5.1-linux-source.tar.gz" download>下载 Linux 包 <span>↓</span></a>
          </article>
          <article className="download-card">
            <div><span className="platform">COMPLETE SOURCE</span><h3>完整源码归档</h3><p>保留 Web、Windows 桌面端源码、测试与开发工具；仅排除可重新构建的 Windows 可执行文件。</p></div>
            <dl><div><dt>格式</dt><dd>zip</dd></div><div><dt>大小</dt><dd>9.47 MB</dd></div><div><dt>文件</dt><dd>956</dd></div></dl>
            <a className="button dark download" href="/releases/EducationHelper-1.5.1-source.zip" download>下载完整源码 <span>↓</span></a>
          </article>
        </div>
        <div className="terminal-card"><div className="terminal-bar"><span /><span /><span /><b>Linux 一键安装或升级</b></div><DownloadCommand /></div>
        <div className="integrity-row"><div><span>SHA-256 · Linux</span><code>c90ff835f6ced05c71282b6523c376d34475d142873c5551cb5b305add3137f3</code></div><a href="/releases/SHA256SUMS.txt" download>下载校验清单 ↓</a></div>
      </section>

      <section className="versions section" id="versions">
        <div className="section-heading compact"><p className="eyebrow">VERSION ARCHIVE</p><h2>一步一步，<br />把闭环补完整。</h2></div>
        <div className="version-list">{versions.map((item, index) => <article className="version-item" id={`v${item.version}`} key={item.version}>
          <div className="version-id"><strong>{item.version}</strong><span>{item.date}</span></div>
          <div className="version-copy"><span className={index === 0 ? "version-label active" : "version-label"}>{item.label}</span><ul>{item.notes.map(note => <li key={note}>{note}</li>)}</ul></div>
          {index === 0 ? <a href="#releases">获取版本 ↑</a> : <span className="archive-label">历史记录</span>}
        </article>)}</div>
      </section>

      <footer><div className="brand footer-brand"><span className="brand-mark">EH</span><span>EducationHelper</span></div><p>面向真实教学流程的 AI 教育辅助系统</p><div><a href="/releases/versions.json">版本清单</a><a href="https://github.com/HanYi-Wu/AITeaching">源码仓库</a></div></footer>
    </main>
  );
}
