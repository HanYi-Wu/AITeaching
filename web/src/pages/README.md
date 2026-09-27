# 页面代码维护指南

本次整理以 GitHub `v1.6.1`（`01e342dff06d103101257f4dccc7113fc55c6513`）为基准。
页面使用 React 和 TypeScript，构建后生成 JavaScript；日常修改这里的源码即可。

## 按页面查找

| 页面 | 目录 | 主要文件 |
| --- | --- | --- |
| 手工组卷 | `compose/` | `ComposeWorkspace.tsx`；导出和题型匹配辅助函数在 `composeHelpers.ts` |
| 题库 | `bank/` | `BankWorkspace.tsx`；题组默认值和列表类型在 `bankModel.ts` |
| 考情分析 | `analysis/` | `AnalysisWorkspace.tsx`、`SvgBarChart.tsx`、`analysisTypes.ts` |
| 模板 | `template/` | `TemplateWorkspace.tsx`；模板解析、预设和序列化在 `templateModel.ts` |
| 知识图谱 | `graph/` | `GraphWorkspace.tsx` |
| 帮助中心 | `help/` | `HelpWorkspace.tsx`；Markdown 元素样式和渲染规则在 `markdownComponents.tsx` |
| 设置 | `settings/` | `SettingsWorkspace.tsx` |
| 操作日志 | `log/` | `LogWorkspace.tsx` |
| 欢迎与引导 | `welcome/` | `WelcomePage.tsx`、`WelcomeWorkspace.tsx`、`IntroPane.tsx`、`ProjectPane.tsx` |
| 管理员 | `platform/admin/` | `AdminWorkspace.tsx` |
| 学校管理 | `platform/school/` | `SchoolWorkspace.tsx`；已有的列表控件在 `SchoolControls.tsx` |
| 学生工作区 | `platform/student/` | `StudentWorkspace.tsx`；已有的导航、答题和成绩组件在 `StudentPanels.tsx` |
| 试卷中心 | `platform/papers/` | `PapersWorkspace.tsx`、`paperHelpers.ts`、`analysisPrint.css` |
| 学情查看 | `platform/insights/` | `TeacherStudentInsightsWorkspace.tsx` |
| 登录 | `platform/login/` | `PlatformLogin.tsx` |

各页面已有的测试放在对应目录中。多个页面共用的外壳、图表和引导清单仍位于 `platform/`；通用组件位于 `src/components/`。

## 修改样式

- 页面布局、颜色和响应式规则沿用 JSX 中的 Tailwind 类名，在对应页面或子组件里修改。
- 全局基础样式、桌面窗口规则和主题皮肤位于 `src/index.css`。
- 主题切换依赖 `bg-slate-50`、`bg-white`、`text-slate-*` 等现有类名。拆分代码时保留这些类名，避免改成固定颜色而影响换肤。
- 试卷分析打印样式位于 `platform/papers/analysisPrint.css`。页面通过 `?raw` 将其读取为字符串，放进原来的打印窗口，避免影响主页面。
- KaTeX、知识图谱、PDF 等第三方样式继续由原来的功能入口加载。

## 维护原则

- 页面状态、请求、输入法处理、快捷键和保存流程保留在原来的工作区组件中。
- 只提取已有的独立函数和子组件；小页面保持单文件，不为每个页面添加空的样式文件或转发入口。
- `src/App.tsx` 和 `src/app/routes.tsx` 继续使用原来的页面懒加载，只更新导入路径。
- `vite.config.ts` 沿用 1.6.1 的构建配置；本次不改变依赖版本或后端接口。

## 验证命令

在 `web/` 目录运行：

```sh
npm test
npm run build
```

业务调整后运行对应页面的测试；涉及共享组件、路由或全局样式时，再运行全部前端测试。
