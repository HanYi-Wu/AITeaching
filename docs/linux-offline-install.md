# Linux 离线安装／更新

包名带代码版本和 Git 提交，包含应用、前端成品、Python 运行环境及依赖、Cairo、Tesseract 和中英文 OCR。安装时不运行 apt/pip/npm/pixi，不访问下载站。Windows exe 暂不制作。

支持 x86_64、glibc 2.35+、systemd，例如 Ubuntu 22.04/24.04。系统需预先有 Python 3.10+、sudo（非 root 时）以及 tar；不是 Alpine/ARM 包。AI 模型/API 仍需网络，离线安装不等于模型离线运行。TeX/LaTeX 引擎、Pandoc 等额外工具不包含，已有服务器配置继续保留；全新机器若需要这些功能需另外安装，不会默默下载。

## 操作

将包复制到 Linux 后在该目录执行（替换为实际文件名）：

```bash
tar -xzf EducationHelper-<版本>-<提交>-linux-x86_64-offline.tar.gz
cd EducationHelper-<版本>-<提交>-linux-x86_64-offline
sudo bash install.sh
```

同一命令自动区分首次安装与已有 systemd 部署更新。默认目录为 `/opt/educationhelper`、`/var/lib/educationhelper`、`/etc/educationhelper`，默认访问 `http://Linux-IP:5173`。已有服务端口及服务账户自动识别。防火墙不会擅自改动，需要管理员允许使用的端口。

自定义部署须明确沿用原数据根目录：

```bash
sudo bash install.sh --app-base /opt/educationhelper --data-dir /var/lib/educationhelper --config-dir /etc/educationhelper --port 5173
```

`current` 必须是原版本符号链接；若原代码直接放在 current 普通目录，程序拒绝覆盖，先由管理员迁移目录。代码、数据与配置必须分开且不互相嵌套；自定义 systemd drop-in 需先人工核实，程序不会自行覆盖它们。

## 中断与保护

1. 校验包与平台、检查磁盘、加独占锁；原服务继续运行。
2. 将文件解到新版本目录，修复运行环境路径并检查应用导入。备份原配置、服务单元和 SQLite 在线快照（包含已提交 WAL），不停止业务。新版本还会执行保守的旧试卷数据修复：仅按发布记录／试卷元数据校正教师归属、恢复能与来源题目对应的旧答卷快照；冲突或缺失来源的记录只报告，不猜测。
3. 准备成功后才停止旧服务，原子替换 current 链接，启动新服务并检查后端、前端和 API 转发。前端使用 Python 静态服务器／流式代理，无 Node 运行时依赖。
4. 失败恢复旧链接和服务单元，重启旧服务并记录恢复健康检查结果。旧版本与失败版本均保留，不删除原项目文件、上传资料或配置。

停服通常只有重启所需的数秒，但不能承诺零中断；在途 AI、上传等长请求可能终止，建议避开正在考试或批量上传的时段。健康检查最多60秒，失败还需回滚时间。大文件解压和备份在停服前完成。

备份位于 `/opt/educationhelper/backups/<时间>/`，包括 transaction.json 和配置／数据库快照。数据库快照取于切换前，可能不包含之后刚提交的答卷；自动回滚**只回滚代码，不用旧数据库覆盖实时数据**。如未来版本含不兼容数据库迁移，旧代码可能不能直接恢复，管理员应结合日志进行人工恢复，不可把代码回滚当成数据库事务回滚。非数据库上传文件不改动，在线快照不是全部资料的时间点一致备份。

旧部署原配置文件逐字保留，包括 AI 密钥、数据路径和网络规则；本安装器不会再执行旧升级器的代理设置迁移。初次安装才生成配置，无内置万能密码。

修复工具也可单独运行。默认仅检查，不写入；确认报告后加 `--apply` 才会先在平台数据库旁的 `.solaire/repair-backups/` 创建 SQLite 在线备份，再应用可验证修复。实际路径请按服务配置替换：

```bash
PYTHONPATH=/opt/educationhelper/current/src /opt/educationhelper/current/runtime/bin/python -m solaire.web.legacy_exam_repair --project-root /var/lib/educationhelper/workspace --platform-root /var/lib/educationhelper/appdata/SolEdu/platform
PYTHONPATH=/opt/educationhelper/current/src /opt/educationhelper/current/runtime/bin/python -m solaire.web.legacy_exam_repair --project-root /var/lib/educationhelper/workspace --platform-root /var/lib/educationhelper/appdata/SolEdu/platform --apply
```

如使用了 `EH_DATA_ROOT`，平台数据库目录应为 `$EH_DATA_ROOT/platform`。安装器会自动识别它；手动执行时请代入真实目录。修复输出的 `unresolved` 需要人工核对，程序不会制造丢失的答题记录或擅自把试卷归给某位教师。

## 构建与校验

版本标签会触发 GitHub Actions 构建，并把 tar.gz 和 SHA256 文件发布到同版本 GitHub Release；也可手动运行 `Linux offline installer` 获取临时 artifact。它使用 conda-pack 生成可搬移运行环境，依赖列表随包记录。校验和用于传输完整性，不是数字签名；请仅使用可信仓库构建产物。

Linux 本地构建可准备含 Python3.12、Cairo、Tesseract、conda-pack 的 conda 环境，安装项目依赖并构建 web/dist，然后执行：

```bash
python scripts/build_linux_offline.py --runtime-prefix "$CONDA_PREFIX"
```

构建机需要网络，目标机器安装不需要网络。构建仅选取 Git 代码及前端成品，不会把本地 exams、resource、.planning、账号数据库或密钥打进包。
