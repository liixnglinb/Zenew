# 知新 Zenew

> 把英语单词变成科学调度的练习系统。
> Turn English vocabulary into a scientifically scheduled practice system.

选词书（四级 / 六级 / 高频 / 基础 / 生词本）→ FSRS 遗忘曲线安排每日新学与复习 → 先回忆再作答，答完看词根词缀与形近词辨析。

**下载 · Download**：[lxlrwxs.top/zenew](https://lxlrwxs.top/zenew/) · [最新 Release](https://github.com/liixnglinb/Zenew/releases/latest)

Windows 10/11 · 安装一次，之后软件内自动更新（免安装、静默替换、自动重启）

---

## 特性 Features

- **完全离线**：四本词书与 14,625 词全量查词索引随安装包内置，不联网也能学、能查、能出形近词
- **提取练习优先**：每张卡都先回忆再看答案；选择题即时判分，回忆卡 1-4 键自评（忘了 / 想起 / 记得 / 秒答）
- **FSRS 调度**：现代间隔重复算法（Anki 同源），按记忆稳定性预测遗忘点，把卡片排在最该复习的时机
- **可解释复习**：详情页直接说清「为什么现在复习」——距上次学习天数 · 记忆强度 · 预计遗忘概率，数据全部来自本地 FSRS 状态
- **键盘流复习**：`1-4` 打分、`空格` 翻面、`回车` 下一张，全程不碰鼠标
- **本地数据**：学习记录存在本机 SQLite，无账号、无登录、无遥测
- **免安装更新**：启动自动检查更新清单 → 后台下载 → 确认后静默替换重启（Tauri updater + minisign 签名校验）

> **v0.22.0 起无账号体系**：客户端不再连接任何云端服务，注册/登录/邀请码一并移除。
> 历史版本（≤ v0.21.0）需要邀请码注册才能进入，其账号闸门与云端生成链路的代码见 git 历史。

## 技术栈 Tech Stack

| 层 | 选型 |
|---|---|
| 桌面壳 | Tauri v2（Rust）+ WebView2，安装包约 7 MB（含内置词库） |
| 前端 | React 19 + TypeScript + Vite，HashRouter |
| 界面 | 自维护设计系统（`app/src/index.css`），对齐 Windows 11 原生质感 |
| 调度 | ts-fsrs（FSRS 算法） |
| 本地存储 | SQLite（tauri-plugin-sql）+ 内置词库 JSON（`app/public/dict/`） |
| 更新 | tauri-plugin-updater + minisign 签名，清单 `latest.json` |

## 目录结构 Layout

```
app/                    Tauri 桌面应用（src/ 前端，src-tauri/ Rust 壳，public/dict/ 内置词库）
server/                 早期 FastAPI 网关 —— v0.22.0 起客户端不再依赖，保留备查
server-worker/          Cloudflare Workers 网关（Hono + D1）—— 同上，已无客户端消费者
docs/                   M1 构建规格、M2 更新器设计、前端规范与组件文档
scripts/                发布与验收脚本（publish-release.sh 一键发版，cdp-*.mjs 真机验收）
```

## 开发 Development

```bash
# 桌面端（热重载）
cd app && npm install && npm run tauri dev

# 检查（发版门禁：lint + 类型 + 构建）
cd app && npm run lint && npm run build

# 打包（需配置更新签名私钥环境变量）
cd app && npm run tauri build
```

刷新内置词库：`python scripts/build_vocab.py` 生成 5 个 JSON 后，覆盖到 `app/public/dict/`。

## 发版 Release

版本源是 `app/src-tauri/tauri.conf.json` 的 `version`（**不是** `app/package.json`，那是脚手架占位的 0.0.0）。

```bash
bash scripts/publish-release.sh    # 读取版本号 → 打包产物改名固定名 → 生成 latest.json → 创建 Release
```

更新清单结构（供客户端自动更新）：

```json
{
  "version": "0.2.0",
  "notes": "更新说明",
  "pub_date": "2026-09-19T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<minisign 签名>",
      "url": "https://github.com/liixnglinb/Zenew/releases/download/v0.2.0/Zenew-Setup.exe"
    }
  }
}
```

> 私钥保存在本地 `.tauri/zenew.key`，**不入库**（已 gitignore）。公钥写在 `app/src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。

## 关键词 Keywords

间隔重复 · 记忆卡片 · FSRS · 主动回忆 · 提取练习 · 学习工具 · spaced repetition · flashcards · active recall · retrieval practice · Tauri · React · SQLite

## License

MIT
