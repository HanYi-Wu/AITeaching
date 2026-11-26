# 源远教学平台（OriginReach，OR）

面向学校、教师和学生的教学与考试系统；拥有ai助手“源远智能体”。当前代码版本为 **1.8.0**，包含 Web 界面、Python API、AI 工具和可选桌面壳。适合在本机或学校内网部署。

1.8.0 更新了智能体浮窗、教师工作台和个人错题练习，并加入签名更新包工具。详见 [1.8.0 升级说明](docs/release-1.8.0.md)。

1.7.2 新增按目标智能组卷与多维查重、学校管理端细粒度权限与审计热力图，并全面优化前后端性能与移动端交互体验。详见 [1.7.2 升级说明](docs/release-1.7.2.md)。

1.7.1 统一应用内下拉与交互，优化桌面、平板和手机布局，修复题库编辑冲突反馈、组卷状态和演示数据问题。详见 [1.7.1 升级说明](docs/release-1.7.1.md)。

1.7.0 增加可恢复的导出与编辑草稿、统一任务状态和复练效果对比，完善题库编辑、考试发布、学生作答与教师批改，优化分析、文档转换和大型页面交互，并修复并发保存、迟到响应和历史班级显示等问题。逐项变化见 [1.7.0 升级说明](docs/release-1.7.0.md)。

1.6.6 增加教师个人练习发布、试卷文件夹的一人一份校验、目录与标签管理，并允许组卷覆盖模板默认题量。版本变更见内置手册的更新日志；1.6.2 的模块化重构见 [1.6.2 说明](docs/release-1.6.2.md)。

1.6.1 修复多教师环境下教师从工作区生成试卷与直接发布试卷时因试卷归属缺失触发的 403 权限错误，规范认领与只读查询隔离。详见 [1.6.1 说明](docs/release-1.6.1.md)。

1.6.0 修复教师新建、重命名和复制试卷时的权限检查错误，保留教师之间的试卷隔离和重名保护。详见 [1.6.0 说明](docs/release-1.6.0.md)。

## 已有功能

- 管理员配置平台与 AI；学校管理教师、学生、班级及导入数据。
- 教师录入、导入和整理题目，按模板组卷，预览和导出试卷，向班级发布考试。
- 题库支持子目录、拖动移动和剪切粘贴、7天文件夹邀请CDK；教师可手动编辑分项多答案及且/或关系，新教师改密后进入持久化使用引导。详见 [1.5.6 说明](docs/release-1.5.6.md)。
- 学生网页答题、保存草稿和上传答题图片；全选择题网页试卷自动发布成绩，混合试卷由教师按学生批改并发布。
- 支持线下试卷照片采集、OCR 辅助处理和 AI 批改建议；教师仍需核对结果。
- 根据历史答题生成错题试卷、专项复习试卷，提供班级和个人分析及报表导出。
- AI 对话可调用题目、试卷、分析和知识图谱等工具；有影响的数据操作按工具权限执行确认。
- 记录切屏等浏览器事件，辅助教师复核。浏览器无法证明学生没有作弊；OCR、AI 和分析结果也不能替代教师判断。

题目文件、图片和新题目导出按教师隔离，AI 文件工具使用同一权限边界。1.5.5 不再给所有教师复制无归属旧题；1.5.4 产生的未修改旧副本隔离保存，新增或已修改题目保留，历史原件及快照不删除。管理员核实归属后可恢复旧题，详见 [1.5.5 说明](docs/release-1.5.5.md)。

## 本地运行

推荐 Python 3.12、Node.js 20，或使用仓库中的 Pixi 环境。PDF/LaTeX 编译还需可用的 TeX 引擎；OCR 需 Tesseract 及中文语言包。Rust 用于 PrimeBrush 原生组件和桌面构建，不是纯 Web 开发的必需启动条件。

```bash
python -m pip install -e ".[dev,primebrush-pdf]"
cd web
npm ci
```

分别在两个终端启动（第一条在仓库根目录，第二条在 web 目录）：

```bash
python -m uvicorn solaire.web.app:app --app-dir src --host 127.0.0.1 --port 8000
```

```bash
npm run dev -- --host 0.0.0.0 --port 5173
```

访问 `http://127.0.0.1:5173`。Windows 安装好依赖后可双击 `start-web.bat`；该脚本会绑定仓库为内容目录。已有部署应沿用原内容目录，避免切换目录后误以为数据丢失。

Pixi 用户可执行 `pixi install --frozen`、`pixi run bootstrap`，再分别运行 `pixi run dev-backend` 和 `pixi run dev-frontend`。首次进入平台按界面初始化管理员，无内置通用密码。

## Linux 部署与更新

- 新的完整 Linux 离线安装／更新包包含运行环境和前端成品，目标机无需下载 Python 依赖或运行 npm；原配置与业务资料保留，准备后短暂停服切换，失败回滚代码。见 [离线安装说明](docs/linux-offline-install.md)。Windows exe 暂不制作。

- 已有 systemd 部署的 1.5.3 更新方式见 [升级说明](docs/release-1.5.3.md)。交付包本地上传后执行 `update.sh`，代码校验及构建成功后切换版本。
- 应用目录默认为 `/opt/educationhelper/current`，数据目录 `/var/lib/educationhelper`，配置目录 `/etc/educationhelper`；更新保留数据，但仍应自行备份。
- `scripts/deploy-linux.sh` 是历史在线安装入口，其下载版本取决于脚本和公共站点，不能用它推断已经部署了当前 Git 版本。
- OCR 安装脚本为 `scripts/install-ocr-ubuntu.sh`，详见 [OCR 与网络说明](docs/release-1.5.2.md)。

AI 密钥在管理员设置中保存；Windows 与 Linux 的配置独立。AI 默认直连，只有 `EH_PROXY_HOSTS` 明确列出的域名使用 `EH_EXTERNAL_PROXY_URL`。对外提供服务时应启用平台公开访问权限控制，配置 HTTPS 和反向代理，并保留 SSE 流式响应。

## 代码与文档

| 目录 | 用途 |
| --- | --- |
| `src/solaire/web` | FastAPI、认证、教学业务和数据访问 |
| `src/solaire/agent_layer` | 模型适配、对话编排、权限与 AI 工具 |
| `src/solaire/exam_compiler` | 试卷编译及导出 |
| `web/src` | React + TypeScript 用户界面 |
| `primebrush-rs` / `src-tauri` | 绘图原生组件及可选桌面应用 |
| `tests` / `web/src/**/__tests__` | 后端和前端测试 |
| `scripts` | 安装、更新、构建与辅助脚本 |

[1.5.6 功能文档](docs/feature-specification-1.5.6.md) · [AI 接口](docs/api/agent.md) · [更新日志](src/solaire/web/assets/help_docs/changelog.md) · [题目分组说明](docs/bank-folders-and-ui-fixes.md)

```bash
python -m pytest tests
cd web
npm test
npm run build
```

Rust 检查：在 `primebrush-rs` 执行 `cargo test --workspace`。GitHub Actions 执行自动检查；版本号和历史测试记录不代表当前全部检查已通过，请查看对应提交的运行结果。

## 版本和许可

本项目使用**非商业许可**，允许查看、学习和非商业使用，须保留署名与来源；商业使用需作者书面授权。详见 [LICENSE](LICENSE)。
