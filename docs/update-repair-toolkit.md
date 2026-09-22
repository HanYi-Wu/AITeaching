# EducationHelper 更新与旧数据修复工具包

本 ZIP 含两套 Linux 更新入口及旧试卷数据修复脚本，代码来源为 Git 提交 `de2f49a`。它是**工具包，不是完整应用发布包**；不含 `app.tar.gz`、`runtime.tar.gz`、`manifest.json` 或线上发布元数据，不能单独用于安装／更新应用。

## 内容

- `offline/install.sh`、`offline/installer.py`：配合完整 Linux 离线包使用。更新时保留项目资料及配置，切换前备份 SQLite，并自动运行修复脚本。详情见 `docs/linux-offline-install.md`。
- `online/update.sh`、`online/upgrade-linux.sh`：旧版在线／本地源码升级入口。`update.sh` 必须与 `release.json`、`educationhelper-source.tar.gz` 同目录；此 ZIP 不包含这两个发布文件。相同版本号可能被旧升级器视为“已安装”，不应把它当作此次提交的现成升级包。
- `repair/legacy_exam_repair.py`：旧试卷教师归属与答卷题目快照的保守修复。依赖服务器现有 EducationHelper Python 代码和运行环境。默认只预览；加 `--apply` 才会先创建 SQLite 在线备份再写入。

## 单独运行数据修复（默认路径示例）

先解压 ZIP，进入解压后的目录。确认服务实际安装路径和数据路径；下例适用于完整离线包默认部署：

```bash
PYTHONPATH=/opt/educationhelper/current/src /opt/educationhelper/current/runtime/bin/python repair/legacy_exam_repair.py --project-root /var/lib/educationhelper/workspace --platform-root /var/lib/educationhelper/appdata/SolEdu/platform
```

检查输出的 `owners_repaired`、`attempts_repaired` 和 `unresolved`。确认后才添加 `--apply` 重跑。`backup` 字段会给出数据库备份路径。若服务使用 `EH_DATA_ROOT`，则平台目录通常为 `$EH_DATA_ROOT/platform`。旧 Pixi 部署可使用其环境中的 Python 运行同一脚本，但必须把当前应用的 `src` 目录加入 `PYTHONPATH`。

无法确认教师归属、缺失源试卷或已答题目与来源不一致时，脚本只记录问题，不制造试卷、题目或答题数据。升级或修复前仍建议额外备份整个持久化数据目录，并避开正在考试的时段。
