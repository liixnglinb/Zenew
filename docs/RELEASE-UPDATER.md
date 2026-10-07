# Zenew v0.23.1 更新系统发布清单

## 已实现

- 安装版：`tauri-plugin-updater`，使用现有 `latest.json`。
- 绿色版：`.zenew-portable` 标记触发自研更新器。
- 绿色版更新包：HTTPS 下载、SHA-256 校验、Minisign 验签、Zip Slip 防护、暂存、替换、启动探测与回滚。
- 两种渠道共用版本号与公钥。

## 发布步骤

1. 在 Windows 环境执行 `npm run tauri build`。
2. 执行 `python scripts/build-portable.py` 生成 `release/Zenew_<version>_x64_green.zip`。
3. 使用与 Tauri 安装版相同的 Minisign 私钥签署绿色 ZIP，输出同名 `.sig`。
4. 执行 `python scripts/make-latest-json.py` 生成 `release/latest.json`。
5. 将 `release/` 中的安装包、安装包签名、绿色 ZIP、绿色 ZIP 签名、`latest.json` 发布到 CDN / OSS；也可以执行 `scripts/publish-release.sh` 同步创建 GitHub Release。
6. 用 v0.23.0 安装版验证一次升级到 v0.23.1；再从带 `.zenew-portable` 的绿色版验证一次升级到 v0.23.1。

## 当前验证边界

本源码环境没有 Rust/Cargo 工具链，也没有发布签名私钥，因此无法在这里完成真实 Windows 构建、签名和 0.23.0 → 0.23.1 实机升级回归。源码级 JSON / Python / shell 检查已通过；TypeScript 项目因依赖安装超时且 node_modules 不完整，未完成完整 `tsc` 构建。
