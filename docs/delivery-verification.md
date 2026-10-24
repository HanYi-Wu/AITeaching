# 源码与离线包核验

本工具从 1.6.7 修订交付时使用的 `verify_deliverables.py` 提炼而来，去掉固定版本、工作目录、提交编号和下载文件名，作为仓库内的长期核验入口。
只读本地 Git 和归档，不访问网络，不执行归档内程序，也不解压文件到磁盘。需要 Python 3.11+ 与 Git。

## 源码包

从仓库根目录执行，`--ref` 必须指定要交付的提交或标签：

```sh
python -m tools.release_verify source /path/to/source.zip --ref v1.6.7
python -m tools.release_verify source /path/to/source.tar.gz --ref HEAD --output source-verification.json
```

逐文件比较 Git blob、大小和类型，检查缺失、多余、重复、路径穿越和不支持的链接类型；支持 GitHub 的单层顶级目录和无顶级目录的归档。
读取源码按块计算散列，不将整个源码包装入内存。Git 的 `export-ignore` / `export-subst` 会改变归档内容，本项目未使用这些归档转换；有意使用时须另外定义交付清单。

本地生成字节一致的包时使用：

```sh
git -c core.autocrlf=false archive --format=zip --output=source.zip HEAD
```

显式关闭自动换行转换，避免不同电脑的 Git 配置影响核验。

## Linux 离线包

```sh
python -m tools.release_verify offline /path/to/EducationHelper-version-commit-linux-x86_64-offline.tar.gz --ref HEAD
```

默认读取包旁同名 `.sha256` 文件，也可用 `--checksum` 指定。
核对外包散列、内部 app/runtime 散列、清单版本与提交、安装器及使用说明；比较 app 源码与运行环境中所有已安装 Python 源码，并检查包版本及中英文 OCR 语言数据。
应用源码压缩部分限制为 256 MiB，runtime 流式读取。该格式对应现有 Linux x86_64 离线构建器。

核验结果包含明确的提交、文件数和 SHA-256。退出码 0 表示上述检查通过，1 表示失败。
这些检查证明包内文件与指定提交及清单一致；业务流程、真实安装升级和浏览器布局仍分别由对应测试验证。

## 发布流程

常规 CI 校验候选源码归档。手动 Linux 离线工作流在打包后先核验内部文件，再进行真实安装测试和后续上传。
发布前要求目标版本标签已存在且指向本次构建提交；分支上试构建时使用 `publish_release=false`。
不同提交不能覆盖已有版本的发布资产，保护保留的 1.6.7 恢复版本。
核验结果打印到日志；默认不添加新的 Release 下载项，也不额外保存 Actions 产物。

2026-10-24 已用此入口复核 `319f189` 原版恢复源码的 887 个文件，以及其既有离线包的 275 个应用源码文件、183 个已安装 Python 源码文件。结果记录在本地交付工作目录，原包与标签保持不变。
