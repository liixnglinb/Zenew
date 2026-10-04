# 知新 Zenew · 「晴空 Sky」改造说明（v0.15 设计重构）

> 依据 `视频解析/视频解读报告.md` 提炼的参考产品（百词斩）画风与功能，对 Zenew 桌面端做的全面优化改造。
> 设计系统版本：**Sky v4**｜主色 `#245EF0`｜构建校验：`tsc` 0 错误、`vite build` 通过

---

## 一、改造总览

| 维度 | 改造前 | 改造后 |
|---|---|---|
| 主色 | 金黄 `#A48830` + 近黑 | **亮蓝 `#245EF0`** + 天空渐变 `#BFDCFE→#F3F9FF` |
| 布局 | 左侧栏 216px + 内容列 | **顶部应用栏 + 底部 5 tab 悬浮胶囊坞 + 左右悬浮入口** |
| 卡片 | 白底 + 1px 描边 + 小阴影 | **大圆角（22/28px）+ 毛玻璃 + 蓝色柔光阴影** |
| 学习流 | 翻面自评（回忆卡） | **媒体卡 + 2×2 四选一 + 纸屑庆祝 + 多 tab 详情 + 底部操作栏（← 斩 Ai 提示 朗读 继续）** |
| 反馈色 | 绿/红胶囊 | **薄荷绿 `#94D7CF` 答对高亮 + ✓ 弹出 + 22 片纸屑** |
| 详情 | 释义 + 例句 | **深藏蓝 `#142854` tab 头：释义 / 例句 / 词根词缀 / 形近词 + AI 辨析气泡** |
| 统计 | 4 指标 + 7 天柱图 | **未来 10 天复习预测 + 五档掌握（初记/强化/巩固/熟识/已斩）+ 进展曲线 + 斩词提示** |
| 首页 | 待学数量 + 开始按钮 | **动态词云 + 学习计划卡（01/02 页签、新学/复习组数）+ 运营位 + 悬浮入口** |
| 图标 | 旧图标 | **天空蓝圆角方 + 白色「知」+ 星光**（全平台尺寸已重生成） |

---

## 二、视频功能 → Zenew 落点对照

| 参考产品（视频中） | Zenew 落点 | 数据来源 |
|---|---|---|
| 词云首页 | `Today.tsx` 知识云（已学词优先，不足补知识点） | 本地 `card` / `card_state` |
| 学习计划卡（01/02/+、200/739 词、新学/复习组数） | `Today.tsx` 计划卡 | 本地词书课程 + `study.ts` 计划设置 |
| 单词卡（插画 + 单词 + 音标 + 例句） | `ReviewSession.tsx` 媒体卡（字卡渐变）+ 单词 + 音标 + 例句高亮 | 词书 `VocabEntry` |
| 四选一释义 | `buildWordChoices()`：正确项 + 3 个同词性/长度相近干扰项 | 同词书其它词卡（稳定洗牌） |
| 答对纸屑庆祝 + 绿色✓ | `.celebrate` 22 片纸屑 + `.choice-cell.is-right` + `.choice-tick` | CSS 动画 |
| 斩（认识，移出计划） | 底部操作栏「斩」= `card.suspended=1` + 按 Easy 记录 + 立即下一张 | 本地库 |
| AI 辨析「和 illegal 搞混了？」 | `similarWords()`：14,625 词索引内编辑距离 ≤2 的形近词 | CDN 词典索引 |
| 词根词缀 leg-al | `morphology()`：前缀/词根/后缀离线词表拆词讲解 | 内置词表（约 400 条） |
| 同义替换 / 真题考频 | 「变形·派生」「延展」tab（离线启发式推导） | 词形推导 |
| 例句多来源 | 例句 tab（词书自带例句 + 中文译文） | 词书数据 |
| 复习统计（预测 + 五档 + 进展） | `Stats.tsx`：`forecastDays()` / 五档 SQL / `progressSeries()` | 本地库真实数据 |
| 斩词模式提示（机器人） | `Stats.tsx` 顶部提示条（稳定期 15–21 天的知识点数） | 本地库 |
| 调整计划（组数 ↔ 天数） | `Plan.tsx`：组数 → 完成天数/预计完成时间/每日用时联动；有考试则置灰不可行档位 | 词书统计 + 考试表 |
| 每日任务（星星罐） | `Tasks.tsx`：三条任务由真实复习记录驱动，集 30 星开礼包 | `review_log` 实时统计 |
| 词书排行榜（段位星球） | `Rank.tsx`：赛季倒计时 + 段位星球 + 领奖台 + 榜单 | 我的分数真实；**同侪为演示数据（页面已标注）** |
| Pro 会员（¥28/月、铜板） | `Pro.tsx`：四档额度包（¥3.9/9.9/19.9/39.9）+ 卡密兑换 + 权益说明 | 真实商业接口（网页支付 + `/billing/redeem`） |
| 词库商店（彩色书封 + 已添加） | `Vocab.tsx`：分类 tab + 3D 书封 + 导入进度 + 计划入口 | CDN 词书 + 本地导入 |
| 设置（音效震动 / 学习提醒 / 显示 / 长辈版） | `Settings.tsx` 分组开关 + `study.ts` 本地设置（音效用 WebAudio 合成，无外部资源） | localStorage |
| 底部 5 tab（单词/学习/训练场/一起背/商城） | 单词 / 学习 / 训练场 / 一起背 / 我的；商城职能由「会员」页承担 | — |
| 悬浮入口（任务/排行榜/查词/词书/会员） | 首页左右 `.fabrail` 胶囊（窄窗口自动隐藏） | — |

---

## 三、新增能力（全部离线可用）

1. **本地设置层** `src/study.ts`
   - 音效（WebAudio 合成三音/两音提示，无素材依赖）、震动、学习提醒、字号缩放、长辈版
   - 答对/答错/斩词分别有音效与震动反馈，可在设置里关闭
2. **学习增强**
   - `buildWordChoices`：四选一干扰项生成（同词性优先、长度相近、按卡 id 稳定洗牌）
   - `morphology`：词根词缀离线拆解（前缀/词根/后缀词表 + 讲解文案）
   - `similarWords`：基于编辑距离的形近词（即「AI 辨析」的离线近似实现）
   - 例句目标词自动高亮（`highlightWord`）；单词自动朗读（WebView2 TTS）
3. **激励与计划**
   - 学习得分：每复习 1 张 +4，答对再 +2（`todayActivity`）
   - 每日任务 + 星星罐（幂等结算，同一任务当天只计一次）
   - 词书学习计划：组数 → 新学上限（`VocabStudy` 按计划取队列）、完成天数、预计完成时间、每日用时
   - 词书卡长按菜单：修改组数 / 换个内容 / 调整顺序（toast 提示）/ 移出计划

---

## 四、文件清单

**新增**
- `app/src/study.ts` — 本地设置 + 学习增强 + 激励 + 计划
- `app/src/pages/Plan.tsx` — 调整计划
- `app/src/pages/Tasks.tsx` — 每日任务
- `app/src/pages/Rank.tsx` — 词书排行榜
- `app/src/pages/Pro.tsx` — 会员与额度
- `app/docs/ui-preview.html` + `app/docs/ui.css` — 静态界面预览（用真实 CSS 渲染）
- `app/public/favicon.svg`、`app/src-tauri/icons/*`（全平台重生成）

**重写**
- `app/src/index.css`（Sky v4 设计系统，707 → 1100+ 行）
- `app/src/App.tsx`（顶栏 + 底部导航 + 悬浮入口 + 12 条路由）
- `app/src/pages/`：`Today` `ReviewSession` `Stats` `Vocab` `VocabStudy` `Settings` `Login`
- `app/src/pages/`：`Courses` `CourseDetail` `Exams` `Dict`（视觉升级，逻辑未动）

---

## 五、构建与验证

```powershell
cd .\app
node node_modules\typescript\bin\tsc -p tsconfig.app.json --noEmit   # 类型校验：0 错误
node node_modules\vite\bin\vite.js build                            # 生产构建：通过
```

- 界面预览（无需启动应用，直接双击打开）：`app/docs/ui-preview.html`
  截图为静态预览，动画（纸屑、词云漂浮、开关）在真实应用内生效。
- 真实应用运行：`npm run tauri dev`（需 Rust 工具链）；界面层改动已通过以上两项校验。

---

## 六、诚实标注

- **排行榜同侪数据为本地演示数据**，页面底部已注明；只有「我」的分数由真实复习记录计算。
- 「同义替换 / 真题考频 / 词组搭配」在参考产品里来自付费题库；本项目无该数据源，改用**词根词缀 + 形近词 + 变形派生**这些可离线推导的能力，未伪造题目数据。
- 「星星罐开礼包」的奖励为本地纪念徽章，不涉及真实账务。
- 单词卡媒体区在无图源时使用**字卡渐变**（由词形哈希决定配色），不是伪造的插画。

---

## 七、v5 前端工程化（设计系统 + 组件库 + 可访问性）

> 本节是「前端规范」层面的改造，规范正文见 `docs/前端规范.md`，组件用法见 `docs/组件文档.md`。

### 7.1 已去除的商业内容

| 移除项 | 位置 |
|---|---|
| 会员/额度页（四档购买、卡密兑换、权益） | 删除 `src/pages/Pro.tsx` 与路由 |
| 充值到账监听与全局提示 | 删除 `src/topup.ts`；`App.tsx` 不再订阅 |
| 账单 API（下单/兑换/订单查询） | 删除 `api.ts` 的 `createOrder` / `redeemCode` / `fetchMyOrders` / `MyOrder` |
| 额度与余额展示 | 设置页「额度与充值」分组、统计页额度卡全部删除 |
| 商业文案 | 「额度不足，去兑换充值码」→「服务端生成暂时不可用，请稍后重试」；「额度暂停」→「已暂停」 |
| 「会员」入口 | 顶栏/悬浮入口/个人资料页的会员按钮全部移除 |
| 礼包奖励 | 由「+200 AI 额度」改为「坚持者」纪念徽章 |

保留的与账号相关能力仅用于云端生成功能：登录/注册、服务地址配置、每日新学上限。学习、复习、统计、发音、词书完全本地可用。

### 7.2 设计 token 化

颜色（品牌色阶 + success/warning/danger/info + 中性色，**浅色/深色两套**）、间距（`--sp-1…10`，4px 基准）、字号（`--fs-2xs…4xl`，rem 单位随 `--scale` 缩放）、圆角（chip/input/btn/card/modal/pill）、阴影（`--elev-1/2/3` + `--mask`）、动效（`--dur-fast/base/slow` + 三种缓动）、布局（`--container` 等）全部集中在 `src/index.css` 的 `:root`，页面不再写魔法值。

### 7.3 深浅色主题

`ThemeProvider` 支持 **跟随系统 / 浅色 / 深色**，写入 `html[data-theme]` 并同步 `color-scheme`（原生滚动条与表单控件跟随）。深色配色同样校验了正文对比度（正文 ≈13:1、次级 ≈7:1、弱化 ≈4.7:1）。顶栏一键切换，设置页与抽屉里也可切换。

### 7.4 组件库（`src/ui/`）

Button / IconButton / Tag / Badge / Avatar / Progress / Spinner / Skeleton / Card / Divider（primitives）、Field / Input / Textarea / SearchInput / Switch / Checkbox / Radio / Segmented（forms）、Tabs / Breadcrumb / PageHeader / Pagination / LoadMore（navigation）、Modal / ConfirmDialog / Drawer / BottomSheet（overlays）、EmptyState / ErrorState / LoadingState / NetBanner / ErrorBoundary（feedback）、DataTable（data），以及 `useAsync` / `useOnline` / `useSubmit` / `useFocusTrap` / `useEscape` / `useMediaQuery` / `useDebounced` 与 `useToast` / `useTheme`。

### 7.5 状态覆盖

| 状态 | 落地 |
|---|---|
| 加载 | 骨架屏 `LoadingState` / `Skeleton`（固定高度，无布局抖动） |
| 空态 | `EmptyState`：文案 + 图标 + 行动按钮（去导入 / 去挑词书 / 去创建课程） |
| 错误 | `ErrorState` 带重试；页面级由 `ErrorBoundary` 兜底（可重置、可回首页） |
| 成功 | 全局 `useToast()`（aria-live 播报，可手动关闭） |
| 断网 | 全局 `NetBanner`：说明本地可用 + 重连按钮 |

### 7.6 信息架构与导航

- 一级导航：底部 5 tab（单词 / 学习 / 训练场 / 一起背 / 我的），带 `aria-current`。
- 二级导航：抽屉（完整功能清单 + 主题/语言切换）、页面内 Tabs（分类/详情/迷你下划线三种形态）。
- 三级定位：`PageHeader` 的返回按钮 + **面包屑**（如「课程 › 课程名」「单词 › 每日任务」）。
- 内容组织：高信息密度用 `DataTable`（列宽/排序/操作列/空态），中等用卡片列表，单条用行式列表。

### 7.7 可访问性

键盘可达（Tabs 支持 ← →/Home/End，复习页 `1-4` 作答、`空格` 翻面、`Esc` 退出）、`:focus-visible` 统一焦点环、弹窗/抽屉焦点陷阱与焦点归还、`role`/`aria-*` 语义（tablist/switch/dialog/progressbar/live）、状态标签带图标（不只用颜色）、弱化文字对比度从 3.4:1 提升到 4.6:1 达 AA、字号全部 rem 且支持「小/标准/大/特大」与长辈版。

### 7.8 交互、边界与其他

- 动效统一 `--dur-*` 与缓动，尊重 `prefers-reduced-motion`。
- 新增**拖动排序**：首页学习计划卡可拖动调整顺序，顺序写入本地并在下次启动生效。
- 长文本（`.truncate`/`.clamp-2`/`.wrap-anywhere`）、超大数字（`formatNumber` + `.tnum`）、极端窗口（≤420 兜底、≥1440 内容居中）均有防护。
- 防重复提交：`useSubmit` 并发点击直接忽略；搜索输入 `useDebounced`。
- 隐私：邮箱脱敏显示（`l*****s@qq.com`）；危险操作（退出登录、删除课程、删除考试）统一 `ConfirmDialog` 二次确认。
- i18n：`lib/i18n.ts` 提供 `t()` 词条表、语言切换与 RTL 方向预留；`lib/format.ts` 统一数字/日期/时长/脱敏格式。

