# 第二阶段兼容契约与验收矩阵

实施总基线：`72934cdcc5ff5e56213665e72459ab92e31fee9f`。原版 `319f189` 仅用于历史对照，不覆盖第一阶段成果。

## PR1 固定边界

| 边界 | 自动化依据 | 后续实施约束 |
|---|---|---|
| 试卷、发布、作答、教师查询及组织 API | `tests/fixtures/paper-student-contract-72934cd.json`；`test_api_architecture.py` | 冻结 37 个路径、43 个操作及传递引用的 21 个 schema；旧字段、默认值、约束、响应及引用名保持，新增输入只能可选 |
| 同班不同教师的历史成绩与画像 | `test_teacher_student_scope.py` | 不能因共享班级读取另一教师的试卷、题目或成绩 |
| 两校两教师的试卷、发布及批改 | `test_two_schools_cannot_read_or_change_each_others_paper_attempts` | 外校列表不可见，猜测 ID 也不能查询、批改或发布；拒绝后原答卷和答案不变 |
| 历史试卷元数据修复 | `test_correcting_generic_subject_keeps_the_existing_publication_and_attempt` | 保留 paper、publication、attempt、folder、delivery 身份及关联 |
| 修复记录的所有权 | `test_generic_subject_record_cannot_be_claimed_by_another_teacher` | 元数据补全不能成为重新认领私有试卷的通道 |
| 学生考试与资源 | `test_platform_student_api.py`、`test_student_resource_access.py`、`test_publication_time.py` | 快照保密、原时间限制、作答与交卷事务、图片权限保持；草稿恢复不能延长考试 |
| 发布重复与范围 | `test_publication_deduplication.py`、`test_platform_paper_api.py` | 原班级及个人发布入口和有效发布唯一性保持 |
| 页面操作 | `PapersWorkspace.test.tsx`、`StudentWorkspace.test.tsx`；批末真实浏览器验收 | 原入口、按钮、布局、键盘与焦点语义保持，不能以拆分组件顺便改变流程 |

契约夹具从当前基线实际应用生成。已有仓库外 `core-api-baseline-1.6.7.json` 对应更早原版，不能直接当作本阶段起点。契约比较逐层保留旧字段与 schema 引用，防止只比 URL 数量漏掉破坏；允许新端点、可选字段及可选请求头，同时禁止给旧输入新增必填项或范围限制。权限、事务和用户交互由行为测试补充，不用 OpenAPI 代替。

## 起步检查（2026-10-25）

- 主分支本地及 GitHub API、Git 远端均确认同一基线；工作区起步干净，作者沿用本仓库 `naiyuan50` 身份。
- Python 3.12.13，现成解释器位于 `E:\智教双创\1.6.6验证\python-env\Scripts\python.exe`。Ruff 0.17.2 对 `src/solaire tools/release_verify tests` 通过。
- 后端起步全量：592 通过、1 跳过、5 失败。失败均误用了 `C:\Windows\system32\bash.EXE`。仅为本任务进程优先使用 `E:\Git\bin` 和 `E:\Git\usr\bin` 后，相关三个测试文件共 6 项全部通过；未修改系统设置或测试源码。全量在批末按该环境重跑。
- 前端起步全量：61 文件、281 项通过；TypeScript 与生产构建通过，保留已有的大资源提示。
- 完整原始日志保存在仓库外 `E:\智教双创\.p2-evidence\baseline-*.log`。前端基线测试有既有的预期错误输出，不把退出成功理解为所有日志均为空。
- 缺 Tesseract 的 OCR 跳过项不计通过。Rust、真实模型、LaTeX/Pandoc、原生安装和 Linux 运行尚未在本阶段验证；涉及相应改动时补验，不继承为已通过。

## 贡献记录

新增一致性、恢复及其他规则作为实际贡献；提取的历史实现继续可由 `git blame -M -C` 识别。任务完成需要改动、相关检查、差异审查及实施台账齐全。未验收批次不推送合并，不使用空提交或拆分实现与测试补数量。
