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

## 签名 ZIP 更新（双实例试运行）

现有离线安装器仍可独立使用。ZIP 更新需要另行配置可信 Ed25519 公钥 `EH_UPDATE_PUBLIC_KEY_FILE` 和非 root 更新服务。公钥、更新服务和目录配置由运维提供，不从更新包读取。生产环境启用前应先在独立环境演练。

在可信构建机上，准备两份对应版本的发布目录（含 `src/solaire` 和 `web/dist`），把签名私钥和输出放在这两份目录之外，再生成包：

```bash
PYTHONPATH=src python -m tools.release_verify.build_update_zip --base /path/to/old-release --candidate /path/to/new-release --base-version 1.7.4 --version 1.7.5 --private-key /secure/release-key.pem --output /path/to/output
```

产物 `OriginReach-update-v1.7.5.zip` 可手动上传，也可作为匹配版本的 GitHub Release 资产。变更和删除均带基线哈希，不适配旧文件被本地改动的部署；这种部署应改用完整离线升级。只有发布端持有私钥，服务器只持有公钥。检查和下载默认直连，需要代理时只给更新服务配置 `EH_UPDATE_PROXY_URL`。

- 网关配置 `EH_BACKEND_RELEASE_STORE`、`EH_BACKEND_URL`、`EH_BACKEND_STANDBY_URL`。备用服务仅绑定 `127.0.0.1`。纯前端无重启更新另外配置 `EH_FRONTEND_RELEASE_STORE`。
- 后端双实例使用同一服务账号的 `educationhelper-backend@primary.service` 和 `educationhelper-backend@standby.service`。模板服务通过已固定的运维工具目录调用 `python -m tools.release_verify.backend_slot_runner --slot %i --store <槽位目录> --runtime-python <已安装运行时> --initial-release <初始版本目录> --primary-port <主端口>`。主、备和网关端口必须不同；两个后端都使用同一份由运维维护的生产数据配置。
- 可通过本机 systemd 用户定时器定期运行 `tools.release_verify.update_worker`。默认只预检后端；只有确认发布包支持新旧版本并行，并配置 `--platform-db` 和 `--enable-compatible-backend-rollout <槽位目录>` 后才尝试后端切换。混合包要求前端与后端共享同一个发布目录，两者通过同一份指针切换。运行时依赖、数据库结构变化不走自动热切换路径。
- 候选启动及独立健康检查通过后才切流。旧实例保留以完成已有请求；新实例经网关检查失败时自动恢复原路由。只有**单实例、单 worker** 的网关可启用自动排空，须在网关和独立更新器上配置同一个 `EH_UPDATE_DRAIN_TOKEN`，并在外部代理封禁 `/_eh_backend_drain`。排空确认不可用或仍有请求时不会强行停止旧实例；多 worker 部署禁用该令牌，由运维确认排空后再复用。页面计时是网关切换和验证耗时，不代表实际业务中断时长。
- 激活成功后，管理员可以在当前任务中申请回滚。前端包恢复上一个静态发布；兼容后端或混合包重新检查上一槽位后恢复路由，不回写生产数据库。「结束任务」会清理暂存包并记录最近结束的任务，不删除已安装版本、静态资源或业务数据；如需从页面回滚，请先执行回滚再结束任务。

演练时先留出一份可恢复的数据库备份，在非生产站点启动两套后端和网关。用持续的登录、答题保存及导出请求分别覆盖前端包和兼容混合包，记录首个失败到恢复的时长；再断开 GitHub、提交错误签名、上传基线不匹配的包及验证切换失败后的回退。迁移改变数据库结构时，应使用已备份且暂停考试的维护窗口，不把双实例切换计时当成中断时间。
