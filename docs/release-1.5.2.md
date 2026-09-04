# EducationHelper 1.5.2：升级、OCR 与行为说明

## 升级与 OCR

先下载再执行，下载失败不会执行空脚本。升级脚本保留数据与配置，并重启两个服务，不需要重启 Linux。

```bash
wget -O /tmp/eh-upgrade.sh https://educationhelper-downloads.btxmnr988y.chatgpt.site/releases/upgrade-linux.sh && bash /tmp/eh-upgrade.sh
wget -O /tmp/eh-ocr.sh https://educationhelper-downloads.btxmnr988y.chatgpt.site/releases/install-ocr-ubuntu.sh && bash /tmp/eh-ocr.sh
```

安装网络确实需要代理时，只对下载和安装命令设置 `EH_INSTALL_PROXY_URL`，不要向服务全局导出 HTTP_PROXY。例如：

```bash
https_proxy=http://192.168.0.4:7890 wget -O /tmp/eh-upgrade.sh https://educationhelper-downloads.btxmnr988y.chatgpt.site/releases/upgrade-linux.sh && EH_INSTALL_PROXY_URL=http://192.168.0.4:7890 bash /tmp/eh-upgrade.sh
```

源码中的脚本为 `scripts/upgrade-linux.sh` 与 `scripts/install-ocr-ubuntu.sh`；部署后 OCR 脚本也位于 `/opt/educationhelper/current/scripts/install-ocr-ubuntu.sh`。

OCR 安装使用 Ubuntu/Debian 官方 apt 包 `tesseract-ocr`、`tesseract-ocr-chi-sim`、`tesseract-ocr-eng`。安装后校验引擎及语言包；识别服务无需重启。优先适用于清晰印刷文字，不保证手写、公式、图表的准确性；无文字、坏图、缺语言包或超时会报错，不编造内容。图片上限25MB、4000万像素，单次60秒。

## 网络决策

为避免 VPN 关闭拖垮所有请求，放弃继承 HTTP(S)_PROXY/ALL_PROXY 的全局策略。AI SDK 使用 `trust_env=False`；没有显式匹配时直连。Linux 升级会备份环境文件为 `/etc/educationhelper/educationhelper.env.before-network-migration` 并清除全局代理项，其他键保持不变。

若个别服务需要 VPN，在 `/etc/educationhelper/educationhelper.env` 添加：

```ini
EH_EXTERNAL_PROXY_URL=http://192.168.0.4:7890
EH_PROXY_HOSTS=api.openai.com,api.anthropic.com
```

修改后执行 `sudo systemctl restart educationhelper-backend.service`。域名精确匹配，不使用通配符；localhost 和私网数字地址始终直连。DeepSeek 等未列入的域名直连；确实依赖 VPN 的服务在 VPN 关闭后仍不可用。SDK 的 OPENAI_BASE_URL/ANTHROPIC_BASE_URL 与界面配置均按最终目标判断。不更改供应商价格、不承诺固定节省比例。

## 工具和兼容性

- `bank.create_items`：`subject?`、`questions[1..50]`；每题 `question_id/question_type/content/answer` 必填，可带 `analysis/options/metadata/source_kind`。一次确认整批，返回 `created/failed/results`；部分失败保留成功项，只重试失败项。原有单题工具保留。
- 分类放在 `metadata.category`，可通过原有 bank.update_item 修改，也可批量创建时传入。没有分类的旧题不改文件，显示未分类。
- `exam.workspace_delete`：先核对 `exam_id`，始终确认；归属不明拒绝执行，有发布记录不删源卷/成绩，使用 paper.update_publication 撤销。草稿移到 `.solaire/trash/exams/<id>`，返回恢复路径。管理员可移回原 `exams/<标签>/<学科>`；恢复前确认目标不存在。
- `file.read` 对图片自动 OCR，`doc.ocr_image` 可显式指定语言；OCR 输出仍是不可信附件数据。
- `/api/resource/{path}` 仍需会话认证；学生仅可读取其已打开试卷引用的图片，解析图片需教师完成批改后可见。无会话401，无权限403。
- 登录 `/api/auth/login` 优先精确用户名；仅当全平台学号唯一时接受学号别名。跨校重号用系统分配用户名；不猜学校、不重置密码。
- 旧题目、答卷、成绩、账号及密钥不清理。升级前仍建议管理员另做数据库备份。

## 验证边界

本地执行定向 Python/前端测试、真实 Tesseract 印刷文本识别、前端构建和 Bash 检查；Windows 上的脚本检查不等于远端 Ubuntu 已安装成功。远端需运行上述脚本并验收。源码版本1.5.2不包含用户数据或凭据。
