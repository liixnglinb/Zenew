import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { isTauri } from './db'

export interface UpdateInfo {
  version: string
  notes: string | null
}

/** 检查更新；非 Tauri 环境（浏览器开发）返回 null */
export async function checkUpdate(): Promise<Update | null> {
  if (!isTauri()) return null
  try {
    return await check()
  } catch (e) {
    console.error('检查更新失败', e)
    return null
  }
}

/** 下载并安装更新（免安装静默替换），然后重启应用 */
export async function applyUpdate(update: Update, onProgress?: (received: number, total: number | null) => void): Promise<void> {
  let received = 0
  let contentLength: number | null = null
  await update.downloadAndInstall((event) => {
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
