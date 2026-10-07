import { check, type Update } from '@tauri-apps/plugin-updater'
import { invoke } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { isTauri } from './db'

export interface UpdateInfo {
  version: string
  notes: string | null
}

type PortableUpdate = UpdateInfo & {
  kind: 'portable'
  url: string
  sha256: string
  signature: string
  size: number | null
}

type InstalledUpdate = UpdateInfo & {
  kind: 'installed'
  native: Update
}

export type AppUpdate = PortableUpdate | InstalledUpdate

let portableCache: boolean | null = null

export async function isPortable(): Promise<boolean> {
  if (!isTauri()) return false
  if (portableCache !== null) return portableCache
  portableCache = await invoke<boolean>('is_portable')
  return portableCache
}

/** 统一更新检查：安装版走 Tauri updater，绿色版走自研签名 ZIP 更新器。 */
export async function checkUpdate(): Promise<AppUpdate | null> {
  if (!isTauri()) return null
  if (await isPortable()) {
    const u = await invoke<PortableUpdate | null>('check_portable_update')
    return u ? { ...u, kind: 'portable' } : null
  }
  const native = await check()
  return native
    ? { kind: 'installed', version: native.version, notes: native.body ?? null, native }
    : null
}

/** 下载并安装更新；绿色版会退出当前进程，再由外部更新脚本替换并启动新版本。 */
export async function applyUpdate(update: AppUpdate, onProgress?: (received: number, total: number | null) => void): Promise<void> {
  if (update.kind === 'portable') {
    // Rust 更新器负责下载、SHA-256、Minisign 验签、解压、替换、回滚和重启。
    await invoke('apply_portable_update', { update })
    return
  }

  let received = 0
  let contentLength: number | null = null
  await update.native.downloadAndInstall((event) => {
    switch (event.event) {
      case 'Started':
        contentLength = event.data.contentLength ?? null
        break
      case 'Progress':
        received += event.data.chunkLength
        onProgress?.(received, contentLength)
        break
      case 'Finished':
        break
    }
  })
  await relaunch()
}
