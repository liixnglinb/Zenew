# 知新 Zenew · M1 施工规格（BUILD SPEC）

> 依据：《知新 Zenew 总体设计方案 v1.1》（见调研目录 00-总体设计方案.md）。
> 本文件是 M1 阶段的唯一施工依据：范围、数据模型、接口、里程碑、验收标准。
> 仓库：`D:\Zenew`（monorepo）。设计原则：本地 SQLite 为源，云端只做账号/网关/额度。

---

## 1. M1 范围（做什么 / 不做什么）

**做**：
1. 桌面端（Tauri v2 + React/TS + Vite）：登录 → 选课/导入 → 知识点树 → 卡片生成 → 复习闭环 → 基础统计。
2. 云端最小后端（FastAPI + SQLite）：邮箱注册/登录（JWT）、LLM 网关（服务端持 key、按用户计量限流）、额度查询、课程目录。
3. 内容三通道：内置课程库（种子目录 + 按知识点生成）、PDF/DOCX 讲义导入（客户端解析文本层）、用户自有 PDF（同管线 + 片段级瞬时处理）。
4. FSRS 调度：ts-fsrs 排程、复习日志落库（对齐 revlog 风格，未来可优化参数/导出）。

**不做（后续里程碑）**：扫描件 OCR、PPTX 导入、EPUB、公式 OCR、考试爬坡、校准四象限、同步服务、支付、绿色版更新器（M2 起）、手机号/微信登录（M2，M1 用邮箱；登录层留 provider 抽象）。

## 2. 仓库结构

```
D:\Zenew
├─ app/        # Tauri v2 + React + TS（前端 + Rust 壳）
│  ├─ src/         # React 页面与组件
│  ├─ src-tauri/   # Rust：SQLite、sidecar 预留、updater 预留
├─ server/     # FastAPI 云端最小后端
│  ├─ app/main.py  # 入口（auth / llm / quota / courses 路由）
│  ├─ data/        # SQLite（dev）
├─ docs/       # 本规格 + 设计方案副本
└─ scripts/    # 开发辅助脚本
```

## 3. 数据模型（app 本地 SQLite）

- `course(id, name, kind[seed|import], created_at)`
- `topic(id, course_id, parent_id nullable, title, sort, status[active|archived])` — 知识点树（章节→知识点）
- `source_doc(id, course_id, filename, pages, parsed_at)` — 导入的文档索引
- `card(id, topic_id, type[basic|why|choice], front, back, explanation, choices_json, lint_ok, created_at, suspended)`
- `card_state(card_id PK, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review)` — ts-fsrs 序列化状态
- `review_log(id, card_id, rating[1-4], reviewed_at, duration_ms)` — 追加型，永删不改
- `exam(id, course_id, title, exam_date)` — M1 只存，爬坡 M3

## 4. 云端接口（server）

| 方法/路径 | 说明 |
|---|---|
| POST /auth/register · /auth/login | 邮箱+密码（bcrypt），签发 JWT（7d） |
| GET /me | 用户信息 + 本月额度用量 |
| GET /courses | 内置课程目录（版本化 JSON，seed 数据在 repo 内） |
| POST /gen/outline | {course_seed 或 text_digest} → 知识点树 JSON（LLM） |
| POST /gen/cards | {topic_title, context?, n, types} → 卡片 JSON（LLM，强制 JSON 输出，服务端 lint：一题多问/答案泄漏/缺解释 → 自动修或拒） |
| 限流/计量 | 每用户每分钟 N 次 + 每月 token 配额；usage_log(id,user,endpoint,model,tokens_in,tokens_out,created_at) |

- LLM 供应商抽象：OpenAI 兼容协议；默认 qwen-flash，配置切换 DeepSeek；key 只存在服务端 .env。
- 所有 /gen/* 强制登录；未登录仅能浏览本地已有内容与复习。

## 5. 卡片 JSON Schema（LLM 输出契约）

```json
{"cards":[{"type":"basic|why|choice","front":"提问（≤60字，单一问题）","back":"答案（≤120字）","explanation":"为什么/常见错误/教材章节回链（必填）","choices":["A","B","C","D"],"answer_index":0}]}
```
lint 规则（服务端）：front 含多个问句→拆分/拒；back 出现在 front→重写；explanation 缺失→拒；choice 的 answer_index 越界→拒。

## 6. 复习闭环（ts-fsrs）

- 会话编排：今日到期（按 due 升序）+ 新卡配额（默认 10/天，可设置）；混排（同知识点连续 ≤2）。
- 评分推断：选择题/自测对错 → 正确=Good、错误=Again；用户可手动升级 Easy/降级 Hard（语义提示文案）。
- 反馈页：判定 → 正确答案 → explanation（P5 详细反馈）。
- 状态机写入 card_state + review_log；"掌握"= 跨 ≥3 个不同日期会话各成功提取一次（state → graduating → review）。

## 7. UI 页面与设计 token v0

页面：登录 / 今日（到期队列、预计时长、连胜）/ 课程详情（知识点树+掌握度）/ 导入向导 / 复习会话 / 统计 / 设置。
Token v0（CSS vars，M1 内随实现微调）：
`--bg:#FAF7F2; --bg-card:#FFFFFF; --ink:#2F2B26; --ink-soft:#6B655C; --primary:#4A6670(黛青); --accent:#E8A33D(琥珀); --danger:#B4544A; --ok:#5E8C61; radius:12px; 无 emoji，线性图标库（lucide）。`

## 8. 种子课程（M1 内置 5 门，大纲由 repo 内 JSON 维护）

高等数学（上）/ 线性代数 / 概率论与数理统计 / C 语言程序设计 / 数据结构。
每门：章→节→知识点三级大纲（自撰，对齐通用教学大纲，无版权问题）；卡片全部按需生成并本地缓存。

## 9. 里程碑切片（每片完成即 git commit）

- Z1 环境与骨架：工具链就绪、app+server 可跑 hello、CI 无
- Z2 云端：auth+quota+courses+gen(/outline,/cards) 联调通过（curl 实测）
- Z3 桌面壳：登录页→今日页骨架、SQLite 建表、路由骨架
- Z4 选课与生成：种子课程浏览→知识点树→卡片生成入库（经网关）
- Z5 导入：PDF/DOCX 文本提取→outline→生成（复用 Z4 管线）
- Z6 复习闭环：ts-fsrs 会话、评分、反馈页、日志落库
- Z7 统计+打磨：掌握度热力图 v0、设置页、空态/错误态、端到端验收

## 10. 验收标准（M1 出口）

1. 真实教材 PDF 一本：导入→树→生成→连续 3 天复习，全程不出错（本地文件跑通）。
2. 零文件路径：搜课程→生成→复习同样跑通（种子课程）。
3. 所有生成请求经服务端网关并有计量记录；客户端代码中无任何 LLM key。
4. `cargo tauri build` 产出 NSIS 安装包 + 绿色 exe 均可启动（绿色版更新器 M2 再做）。
