# 按目标自动组卷与查重

教师在组卷页面选择模板后，可通过“按目标组卷”设置总题量、知识点覆盖率、难度分布和题型比例。结果替换当前编辑中的选题，支持撤销；保存、导出和发布沿用现有入口。自动组卷和查重接口本身不保存试卷、不修改题库。

## 目标与数据

- 知识点读取题目 `metadata.knowledge_points`（列表或逗号分隔的文字）及当前教师知识图谱的题目绑定。支持按绑定节点 ID 或名称匹配。
- 难度使用 `easy`、`medium`、`hard`、`unknown` 四档；未标注或无法识别的值归入 `unknown`，不会自动当作中等题。
- 难度还识别低/简单/容易、中/中等/适中、高/难/困难，以及 `low/high`。0–1 的数字或数字字符串按越大越难处理：不超过 1/3 为简单、不超过 2/3 为中等，其余为困难；题组取已标注小题中最难的一档。
- 比例是非负权重，既可以填写 `30/50/20`，也可以填写 `0.3/0.5/0.2`。按最大余数法分配到整数题量，取整后总题量保持不变。
- 默认依据模板各小节的题量分配选题。设置题型比例时，重新分配到兼容的小节；模板缺少相应题型的小节时，返回明确错误。
- 完整题组作为一条选题计数，材料及小题共同参与查重；混合题组只能进入 `group` 或 `practice` 小节。同型题组可进入相应题型小节。
- 先联立处理小节题量、题型和难度分配，再通过知识点稀缺程度、多轮加权和同档换题改善覆盖率。目标不可达时返回实际结果和缺口，不保证穷尽全部组合寻找全局最优解。
- 缺题不会自动降低目标题量。响应中的 `required_count` 仍为目标数，便于继续手工补题。

查重默认检查本卷、当前教师可见题库、当前教师自己的历史试卷。排除题库中的来源题目自身、以及 `exclude_exam_id` 指定的当前试卷。历史已有冻结题面时使用冻结内容，题库删题后仍可查；只有引用、没有冻结题面的旧卷使用当前题库内容，并说明这一限制。无法读取的文件、无法还原的历史题面会返回警告。

`text_ngram_v1` 使用归一化文字、选项及字符片段相似度，并辅助识别数字变式。原题数字、运算符和选项不同不会仅因数字模板一致而归为完全重复。它是文字相似提示，不是 AI 语义判定。默认阈值 0.85，可在 0.5–1 之间调整；相似结果供教师复核，不自动删除、替换已有选题。

开启 `avoid_history` 后，自动排除历史相同编号、完全重复和达到阈值的相似题；可用题目可能因此不足。单次生成、手工查重最多处理 500 条选题。

## 接口

三个接口只允许教师或管理员访问，沿用平台登录会话、教师题库和试卷权限。

### 可选目标

`GET /api/exam/auto-compose/options?subject=数学`

返回 `total_count`、`knowledge_points`（`id/name/question_count`）、`difficulty_counts`、`type_counts`、`namespaces` 和 `warnings`。

### 生成并自动查重

`POST /api/exam/auto-compose`

```json
{
  "template_path": "templates/math.yaml",
  "template_ref": "math",
  "subject": "数学",
  "total_count": 20,
  "knowledge_points": ["函数", "导数"],
  "coverage_ratio": 1,
  "difficulty_distribution": {"easy": 30, "medium": 50, "hard": 20},
  "type_distribution": {"single_choice": 60, "fill": 40},
  "avoid_history": false,
  "exclude_exam_id": "期中考试/数学",
  "similarity_threshold": 0.85,
  "seed": 42
}
```

可选 `namespaces` 限定题集，`exclude_question_ids` 排除指定题目。留空的比例对象 `{}` 表示不限制难度或沿用模板题型；`section_counts` 可指定模板小节题量（总和必须等于 `total_count`，不能与 `type_distribution` 同时指定）。选择题总比例 `choice` 不能与 `single_choice/multiple_choice` 比例混用，避免重复计数。提供 `seed` 可在相同数据下复现选题。

响应包括：

- `complete`：题量、覆盖率、难度和题型目标是否全部达成。
- `selected_items`：与现有保存、校验和导出接口兼容的小节选题。
- `requested_count/generated_count/candidate_count/excluded_history_count`。
- `goals.knowledge`：目标、已覆盖、未覆盖知识点、实际覆盖率及是否达标。
- `goals.difficulty`、`goals.types`：目标与实际整数题量、是否达标。默认题型分组遵循模板的小节类型，`practice` 表示不限题型的小节；`choice` 包含单选和多选。
- `goals.sections`：每节目标题量与实际题量。
- `duplicate_report`：下述查重报告；`warnings`：数据或目标缺口。

### 对当前选题重新查重

`POST /api/exam/check-duplicates`

```json
{
  "question_ids": ["数学/日常题库/q1", "数学/日常题库/q2"],
  "exclude_exam_id": "期中考试/数学",
  "similarity_threshold": 0.85
}
```

`question_ids` 保留重复编号，用于检查同一道题被添加多次。不可用或无权访问的题号返回 400，不泄露其它教师的数据。

报告包含 `method`、`threshold`、`summary`、`questions` 和 `warnings`。每题包含 `qualified_id`、`occurrences`、`matches`、`match_count`、`truncated`。匹配来源为 `bank/history/paper`，类别为 `exact/similar/reused`；历史匹配附试卷标识及标题。每题最多显示 20 条匹配，完整匹配数量由 `match_count` 表示。摘要的各类数量按被标记的题目计数，同一题可同时属于多个类别。

修改选题后应重新查重。前端只展示与当前选题和账号、项目、试卷上下文一致的报告，忽略失效请求的晚到结果。
