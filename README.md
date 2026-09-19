# 知新 Zenew

> 把大学课程变成科学调度的练习系统。
> Turn your university courses into a scientifically scheduled practice system.

选课程或导入讲义 → AI 生成「先回忆再看答案」的知识卡片 → FSRS 间隔重复安排每天的复习。

**下载 · Download**：[lxlrwxs.top/zenew](https://lxlrwxs.top/zenew/) · [最新 Release](https://github.com/liixnglinb/Zenew/releases/latest)

Windows 10/11 · 安装一次，之后软件内自动更新（免安装、静默替换、自动重启）

---

## 特性 Features

- **提取练习优先**：每张卡都先回忆再看答案；选择题即时判分，回忆卡 1-4 键自评（忘了 / 想起 / 记得 / 秒答）
- **FSRS 调度**：现代间隔重复算法（Anki 同源），按记忆稳定性预测遗忘点，把卡片排在最该复习的时机
- **AI 生成卡片**：按课程名生成章节与知识点树，逐点生成回忆卡 / 选择题 / 解释卡，服务端质检后才入库
- **键盘流复习**：`1-4` 打分、`空格` 翻面、`回车` 下一张，全程不碰鼠标
- **本地数据**：学习记录存在本机 SQLite；账号只用于生成服务计费
- **免安装更新**：启动自动检查 GitHub Releases → 后台下载 → 确认后静默替换重启（Tauri updater + minisign 签名校验）

## 技术栈 Tech Stack

| 层 | 选型 |
|---|---|
| 桌面壳 | Tauri v2（Rust）+ WebView2，安装包约 3 MB |
| 前端 | React 19 + TypeScript + Vite，HashRouter |
| 调度 | ts-fsrs（FSRS 算法） |
| 本地存储 | SQLite（tauri-plugin-sql） |
| 云服务 | FastAPI 网关：账号 / 生成代理 / 额度计量（`server/`） |
| 更新 | tauri-plugin-updater + minisign 签名，清单 `latest.json` |

## 目录结构 Layout

```
app/            Tauri 桌面应用（src/ 前端，src-tauri/ Rust 壳）
server/         FastAPI 云端网关（本地开发 / 自建服务器部署）
server-worker/  Cloudflare Workers 版网关（Hono + D1，公网部署用，功能对齐 server/）
docs/           M1 构建规格、M2 更新器设计
scripts/        发布与验收脚本（publish-release.sh 一键发版）
```

## 开发 Development

```bash
# 后端（默认 mock LLM，无需密钥）
cd server && ./.venv/Scripts/python.exe -m uvicorn app.main:app --port 8765

# 桌面端（热重载）
cd app && npm install && npm run tauri dev

# 打包（需配置更新签名私钥环境变量）
cd app && npm run tauri build
```

## 发版 Release

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
