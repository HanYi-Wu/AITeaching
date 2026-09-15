# EducationHelper（EH）

面向学校、教师和学生的教学与考试系统。当前代码版本 **1.5.3**，包含 Web 界面、Python API、AI 工具和可选桌面壳。适合在本机或学校内网部署。

## 已有功能

- 管理员配置平台与 AI；学校管理教师、学生、班级及导入数据。
- 教师录入、导入和整理题目，按模板组卷，预览和导出试卷，向班级发布考试。
- 学生网页答题、保存草稿和上传答题图片；教师按学生批改，发布成绩后学生查看结果。
- 支持线下试卷照片采集、OCR 辅助处理和 AI 批改建议；教师仍需核对结果。
- 根据历史答题生成错题试卷、专项复习试卷，提供班级和个人分析及报表导出。
- AI 对话可调用题目、试卷、分析和知识图谱等工具；有影响的数据操作按工具权限执行确认。
- 记录切屏等浏览器事件，辅助教师复核。浏览器无法证明学生没有作弊；OCR、AI 和分析结果也不能替代教师判断。

题库文件夹目前按教师保存，**1.5.3 的题目文件本身仍共用**。多教师环境使用前应了解这一限制，不能把文件夹隔离当成题目权限隔离。

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

[AI 接口](docs/api/agent.md) · [更新日志](src/solaire/web/assets/help_docs/changelog.md) · [题目分组说明](docs/bank-folders-and-ui-fixes.md)

```bash
python -m pytest tests
cd web
npm test
npm run build
```

Rust 检查：在 `primebrush-rs` 执行 `cargo test --workspace`。GitHub Actions 执行自动检查；版本号和历史测试记录不代表当前全部检查已通过，请查看对应提交的运行结果。

## 版本和许可

更新日志从 1.4.3 起记录功能变化；Git 提交记录保留实际开发历史。发布标签应指向对应代码，不以日志中提及某版本替代实际发布证据。

本项目使用自定义**非商业许可**，允许查看、学习和非商业使用，须保留署名与来源；商业使用需作者书面授权。详见 [LICENSE](LICENSE)。
