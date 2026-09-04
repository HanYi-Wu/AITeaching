# 扩展组件 API

Ubuntu/Debian OCR 一键安装：`bash /opt/educationhelper/current/scripts/install-ocr-ubuntu.sh`（先升级至1.5.2）。安装引擎和中英语言包后，`file.read` 与 `doc.ocr_image` 均可使用；详见 [安装与限制](../release-1.5.2.md)。

管理员页面使用这些接口检测和配置 PDF 排版、文档转换与 OCR 组件。公网模式下读取接口需要登录，变更接口仅允许平台管理员；扩展变更不要求浏览器提供本机控制令牌。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/system/extensions` | 返回扩展检测结果。每项包含 `ready`、可执行文件、版本、来源、`platform`、`install_mode`（`winget` / `command` / `manual`）、可选 `install_command` 和 `requires_confirmation` |
| POST | `/api/system/extensions/{ext_id}/install` | Windows 启动 winget 安装窗口；Linux 不执行 sudo，而是返回 `action: command` 与适合当前包管理器的命令；未知扩展返回 `ok: false` |
| PUT | `/api/system/extensions/{ext_id}/manual-path` | 校验并保存服务器本机程序或目录，正文为 `{ "path": "...", "location_kind": "file" | "dir" }` |
| DELETE | `/api/system/extensions/{ext_id}/manual-path` | 清除已保存的本机路径并恢复系统 PATH 检测 |

Linux 命令根据后端实际检测到的 `apt-get`、`dnf`、`yum` 或 `pacman` 生成。管理员需在 Linux 终端执行复制的命令，然后点击“重新检测”；Web 服务不会代替管理员获取 sudo 权限。
