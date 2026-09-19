# 知新 Zenew · M2 绿色版自研更新器设计稿

> 背景（见 03-技术选型.md §2）：Windows 上"免安装 + 自动更新"无现成方案——tauri-plugin-updater 只覆盖 NSIS/MSI 安装版；Electron portable 官方明确不支持更新。绿色版更新器需自研，本文件是 M2 的实现依据。

## 目标

- 绿色版（单 exe + resources，无安装）在用户双击即可用，且能**自动检测并升级到新版本**。
- 更新失败可回滚；升级包经签名校验，杜绝劫持。
- 安装版与绿色版共用同一份版本清单。

## 双通道总览

```
                     latest.json (阿里云 OSS + CDN，minisign 签名)
                     {version, pub_date, notes, platforms:{...}}
                       │                        │
        安装版（tauri-plugin-updater）    绿色版（自研 updater，本文档）
        passive 模式拉取→验签→安装          下载 zip→验签→退出替换→回滚
```

## 绿色版更新流程（约 200 行 Rust + 一个 cmd 脚本）

1. **检测**：应用启动 30 秒后 + 每 4 小时，GET `{CDN}/zenew/latest.json`（带 `If-None-Match`，304 即跳过）。
2. **比较**：语义化版本比较；仅在远程 > 本地时提示（托盘气泡 / 设置页红点，不打断学习）。
3. **下载**：流式下载 `Zenew_{ver}_x64_green.zip` 到 `%LOCALAPPDATA%/Zenew/updates/{ver}/`，显示进度；sha256 校验完整性。
4. **验签**：用内置公钥验证 zip 旁 `.sig`（minisign 格式，与 tauri-plugin-updater 共用同一密钥对）。
5. **暂存**：解压到 `updates/{ver}/staged/`；写 `updates/{ver}/manifest.json`（版本、时间、sha256）。
6. **替换**（Windows 文件占用问题的核心）：
   - 主进程写 `updates/{ver}/apply.cmd` 并 spawn（`CREATE_NO_WINDOW`）后立即退出；
   - apply.cmd：`timeout /t 2` → 备份当前 exe 为 `app.exe.bak` → 移动 `staged/zenew.exe` 到应用根 → 清理 staging；
   - 主进程重启自身（apply.cmd 末尾 `start "" "%~dp0zenew.exe" --relaunch`）。
7. **回滚**：启动时若检测到 `app.exe.bak` 且新 exe 校验失败/启动崩溃标记，恢复备份。
8. **失败静默**：任何一步失败 → 删除半成品目录 → 状态回到"已是最新"，不打扰用户。

## latest.json 示例

```json
{
  "version": "0.2.0",
  "pub_date": "2026-10-20T10:00:00Z",
  "notes": "扫描件 OCR 支持；考试倒计时",
  "platforms": {
    "windows-x86_64": {
      "signature": "<minisign 签名内容>",
      "url": "https://cdn.example.com/zenew/0.2.0/Zenew_0.2.0_x64_green.zip",
      "size": 18432000,
      "sha256": "…"
    }
  }
}
```

## 分发与密钥

- OSS 直传 + CDN 刷新；国内主通道，GitHub Releases 仅海外镜像。
- minisign 密钥对：私钥仅存在于发布机（CI Secret）；公钥编译进应用。
- 初期可用阿里云 OSS + 腾讯云 CDN 任一；切换只改 latest.json 域名。

## 验收标准（M2 出口）

1. 绿色版 v0.1 → 发布 v0.2 → 应用内提示 → 一键升级 → 重启后 `关于` 显示 v0.2。
2. 中途断网重试不损坏现有安装；校验失败自动回滚且老版本可继续使用。
3. 安装版同一清单走 tauri-plugin-updater 升级成功。
