# EducationHelper 1.6.2

本次发布重点优化前端代码架构，完成全部 16 个核心业务工作区及平台管理页面的目录模块化重构，提升代码可维护性与协作扩展能力。

主要变更与优化：

- **页面目录结构模块化**：将原先平铺于 `web/src/pages/` 及 `web/src/pages/platform/` 的 16 个页面组件解耦归类至专属子目录中（涵盖 `analysis`、`bank`、`compose`、`graph`、`help`、`log`、`settings`、`template`、`welcome` 以及 `platform/admin`、`platform/papers`、`platform/login`、`platform/school`、`platform/student`、`platform/insights`）。
- **就近单测与模块索引**：为各个页面子目录统一配置 `index.ts` 导出入口，将对应的前端自动化测试用例就近迁移至各模块的 `__tests__` 目录中，并新增 `web/src/pages/README.md` 架构说明文档。
- **100% 行为与样式等价保证**：重构严格保持所有页面原有代码逻辑、Tailwind 样式类名、React 组件状态、属性传参及事件绑定机制，所有路由映射保持完全一致，不影响任何系统交互与功能行为。
- **端到端测试与版本统一**：前端全部单元测试通过，全栈版本元数据对齐为 1.6.2；版本标签发布源码与发布说明，离线打包保留为手动调度触发。

更新服务器源码后，在 `web` 目录执行前端重新构建并重启相关服务即可生效。
