# 应用内手册（正文源）

本目录为 **源远教学平台内手册** 的单一事实来源：`help-manifest.json` 列出可访问的篇目与路径，后端仅允许读取清单中的文件，供前端渲染。

## 根目录文件

- **`changelog.md`**：面向使用者的版本与体验更新说明。

## 子目录

- **`introduction/`**：理念引导与入门概念篇目（如系统与 Word 的区别、组卷系统概念）。
- **`tutorial/`**：特定业务的连续操作步骤说明（如组卷流程与导出、版式模板）。
- **`user/`**：具体功能点的使用说明（如题库交换、知识图谱、绘图工具等）。
- **`assets/`**：手册内嵌配图（如 PrimeBrush 示例 SVG），由 `GET /api/help/asset/...` 提供，**不在** `help-manifest.json` 中逐条登记；路径须位于 `assets/` 下且后缀为常见图片格式。

## 与根目录 `docs/` 的关系

- **`docs/`**：仓库内的开发说明、架构、计划、验收清单等，**不**作为应用内嵌正文的维护位置。
- **`src/solaire/web/assets/help_docs/`**（本目录）：随 Wheel / 嵌入式 Python 打包发布；修改此处 Markdown 即可更新产品内展示（由 `solaire.web.help_docs` 加载）。
