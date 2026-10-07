use minisign_verify::{PublicKey, Signature};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use tauri::AppHandle;
use zip::ZipArchive;

const UPDATE_MANIFEST_URL: &str = "https://lxlrwxs.top/zenew/dl/latest.json";
const UPDATER_PUBLIC_KEY_B64: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEY1NTBGNDVFMDU2RjFFMTQKUldRVUhtOEZYdlJROWR5SUVvVFZQOEs4Ui9zdlh2aTNzZEtRS2NVRlBQQm9leVYweDA3UHN4ckIK";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableManifest {
  pub version: String,
  pub notes: Option<String>,
  pub pub_date: Option<String>,
  pub portable: Option<PortableArtifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableArtifact {
  pub url: String,
  pub signature: String,
  pub sha256: String,
  pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableUpdateInfo {
  pub version: String,
  pub notes: Option<String>,
  pub url: String,
  pub sha256: String,
  pub signature: String,
  pub size: Option<u64>,
}

#[tauri::command(rename = "is_portable")]
pub fn is_portable(_app: AppHandle) -> bool {
  let Ok(exe) = std::env::current_exe() else { return false };
  let marker = exe.parent().unwrap_or_else(|| Path::new(".")).join(".zenew-portable");
  marker.is_file()
}

#[tauri::command(rename = "check_portable_update")]
pub async fn check(app: AppHandle) -> Result<Option<PortableUpdateInfo>, String> {
  if !is_portable(app) {
    return Ok(None);
  }

  let current = env!("CARGO_PKG_VERSION");
  let client = Client::builder()
    .user_agent(format!("Zenew/{current}"))
    .build()
    .map_err(|e| format!("构建更新网络客户端失败：{e}"))?;

  let manifest: PortableManifest = client
    .get(UPDATE_MANIFEST_URL)
    .send()
    .await
    .map_err(|e| format!("获取更新清单失败：{e}"))?
    .error_for_status()
    .map_err(|e| format!("更新清单返回异常：{e}"))?
    .json()
    .await
    .map_err(|e| format!("解析更新清单失败：{e}"))?;

  if compare_versions(&manifest.version, current) <= 0 {
    return Ok(None);
  }

  let Some(artifact) = manifest.portable else {
    return Ok(None);
  };

  Ok(Some(PortableUpdateInfo {
    version: manifest.version,
    notes: manifest.notes,
    url: artifact.url,
    sha256: artifact.sha256,
    signature: artifact.signature,
    size: artifact.size,
  }))
}

#[tauri::command(rename = "apply_portable_update")]
pub async fn install(update: PortableUpdateInfo, app: AppHandle) -> Result<(), String> {
  if !is_portable(app.clone()) {
    return Err("当前不是绿色版，不能走绿色版更新流程".into());
  }

  #[cfg(not(target_os = "windows"))]
  {
    let _ = (app, update);
    return Err("绿色版更新目前仅支持 Windows".into());
  }

  #[cfg(target_os = "windows")]
  {
    let exe = std::env::current_exe().map_err(|e| format!("读取当前程序路径失败：{e}"))?;
    let app_dir = exe.parent().ok_or("无法确定程序目录")?.to_path_buf();
    let update_root = portable_update_root().ok_or("无法定位本机更新目录")?;
    let version_dir = update_root.join(&update.version);
    let staged_dir = version_dir.join("staged");
    fs::create_dir_all(&staged_dir).map_err(|e| format!("创建更新目录失败：{e}"))?;

    let client = Client::builder()
      .user_agent(format!("Zenew/{}", env!("CARGO_PKG_VERSION")))
      .build()
      .map_err(|e| format!("构建下载客户端失败：{e}"))?;

    let bytes = client
      .get(&update.url)
      .send()
      .await
      .map_err(|e| format!("下载更新失败：{e}"))?
      .error_for_status()
      .map_err(|e| format!("更新下载返回异常：{e}"))?
      .bytes()
      .await
      .map_err(|e| format!("读取更新包失败：{e}"))?;

    let hash = hex_sha256(&bytes);
    if !hash.eq_ignore_ascii_case(&update.sha256) {
      cleanup_dir(&version_dir);
      return Err("更新包 SHA-256 校验失败，已取消更新".into());
    }

    verify_signature(&bytes, &update.signature)?;

    let zip_path = version_dir.join(format!("Zenew_{}_x64_green.zip", update.version));
    fs::write(&zip_path, &bytes).map_err(|e| format!("保存更新包失败：{e}"))?;

    extract_zip(&bytes, &staged_dir)?;
    let staged_exe = find_staged_exe(&staged_dir)?;

    let manifest_path = version_dir.join("manifest.json");
    let manifest = serde_json::json!({
      "version": update.version,
      "sha256": hash,
      "installed_from": update.url,
      "prepared_at": chrono::Utc::now().to_rfc3339(),
    });
    fs::write(&manifest_path, serde_json::to_vec_pretty(&manifest).unwrap())
      .map_err(|e| format!("写入更新记录失败：{e}"))?;

    let target_exe = app_dir.join("Zenew.exe");
    if exe != target_exe {
      fs::copy(&exe, &target_exe).map_err(|e| format!("准备主程序路径失败：{e}"))?;
      let marker = app_dir.join(".zenew-portable");
      if !marker.exists() {
        fs::write(marker, b"portable")
          .map_err(|e| format!("创建绿色版标记失败：{e}"))?;
      }
    }

    let script = version_dir.join("apply.cmd");
    write_apply_script(&script, &staged_exe, &target_exe, &version_dir)?;

    Command::new("cmd.exe")
      .args(["/C", script.to_string_lossy().as_ref()])
      .creation_flags(0x08000000)
      .spawn()
      .map_err(|e| format!("启动更新器失败：{e}"))?;

    app.exit(0);
    Ok(())
  }
}

#[cfg(target_os = "windows")]
fn portable_update_root() -> Option<PathBuf> {
  let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from)?;
  Some(base.join("Zenew").join("updates"))
}

fn verify_signature(bytes: &[u8], signature_text: &str) -> Result<(), String> {
  let public_key = PublicKey::from_base64(UPDATER_PUBLIC_KEY_B64)
    .map_err(|e| format!("更新公钥无效：{e}"))?;
  let signature = Signature::decode(signature_text)
    .map_err(|e| format!("更新签名格式无效：{e}"))?;
  public_key
    .verify(bytes, &signature, false)
    .map_err(|e| format!("更新签名校验失败：{e}"))
}

#[cfg(target_os = "windows")]
fn extract_zip(bytes: &[u8], target: &Path) -> Result<(), String> {
  let cursor = Cursor::new(bytes);
  let mut archive = ZipArchive::new(cursor).map_err(|e| format!("读取更新压缩包失败：{e}"))?;

  for index in 0..archive.len() {
    let mut file = archive.by_index(index).map_err(|e| format!("读取压缩包条目失败：{e}"))?;
    let Some(relative) = file.enclosed_name().map(PathBuf::from) else {
      return Err("更新包包含非法路径".into());
    };
    let out = target.join(relative);
    if file.is_dir() {
      fs::create_dir_all(&out).map_err(|e| format!("创建更新目录失败：{e}"))?;
      continue;
    }
    if let Some(parent) = out.parent() {
      fs::create_dir_all(parent).map_err(|e| format!("创建更新目录失败：{e}"))?;
    }
    let mut dst = File::create(&out).map_err(|e| format!("写入更新文件失败：{e}"))?;
    std::io::copy(&mut file, &mut dst).map_err(|e| format!("复制更新文件失败：{e}"))?;
  }
  Ok(())
}

#[cfg(target_os = "windows")]
fn find_staged_exe(staged: &Path) -> Result<PathBuf, String> {
  let preferred = staged.join("Zenew.exe");
  if preferred.is_file() {
    return Ok(preferred);
  }
  for entry in walkdir::WalkDir::new(staged).follow_links(false) {
    let entry = entry.map_err(|e| format!("扫描更新文件失败：{e}"))?;
    if entry.file_type().is_file()
      && entry.path().extension().and_then(|x| x.to_str()).is_some_and(|x| x.eq_ignore_ascii_case("exe"))
    {
      return Ok(entry.path().to_path_buf());
    }
  }
  Err("更新包中没有找到 Zenew.exe".into())
}

#[cfg(target_os = "windows")]
fn write_apply_script(script: &Path, staged_exe: &Path, target_exe: &Path, version_dir: &Path) -> Result<(), String> {
  let backup = target_exe.with_extension("exe.bak");
  let staged_parent = staged_exe.parent().ok_or("更新暂存目录无效")?;
  let script_text = format!(
    r#"@echo off
setlocal
set "TARGET={target}"
set "STAGED={staged}"
set "BACKUP={backup}"
set "ROOT={root}"

timeout /t 2 /nobreak >nul

for /l %%i in (1,1,15) do (
  if not exist "%BACKUP%" move /y "%TARGET%" "%BACKUP%" >nul 2>&1
  if exist "%BACKUP%" goto swapped
  timeout /t 1 /nobreak >nul
)

exit /b 1

:swapped
move /y "%STAGED%" "%TARGET%" >nul 2>&1
if not exist "%TARGET%" goto rollback
start "" "%TARGET%"
timeout /t 8 /nobreak >nul
tasklist /FI "IMAGENAME eq Zenew.exe" | find /I "Zenew.exe" >nul
if errorlevel 1 goto rollback

del /q "%BACKUP%" >nul 2>&1
rmdir /s /q "%ROOT%" >nul 2>&1
exit /b 0

:rollback
if exist "%TARGET%" del /f /q "%TARGET%" >nul 2>&1
if exist "%BACKUP%" move /y "%BACKUP%" "%TARGET%" >nul 2>&1
if exist "%TARGET%" start "" "%TARGET%"
exit /b 1
"#,
    target = quote_cmd_path(target_exe),
    staged = quote_cmd_path(staged_exe),
    backup = quote_cmd_path(&backup),
    root = quote_cmd_path(version_dir),
  );
  fs::write(script, script_text).map_err(|e| format!("写入更新脚本失败：{e}"))?;
  let _ = staged_parent;
  Ok(())
}

fn quote_cmd_path(path: &Path) -> String {
  format!("{}", path.to_string_lossy().replace('"', ""))
}

fn cleanup_dir(path: &Path) {
  let _ = fs::remove_dir_all(path);
}

fn hex_sha256(bytes: &[u8]) -> String {
  let mut hasher = Sha256::new();
  hasher.update(bytes);
  format!("{:x}", hasher.finalize())
}

fn compare_versions(a: &str, b: &str) -> i32 {
  let parse = |v: &str| -> Vec<u64> {
    v.trim_start_matches('v')
      .split('.')
      .map(|part| part.split(|c: char| !c.is_ascii_digit()).next().unwrap_or("0").parse::<u64>().unwrap_or(0))
      .collect()
  };
  let av = parse(a);
  let bv = parse(b);
  for i in 0..av.len().max(bv.len()) {
    let x = *av.get(i).unwrap_or(&0);
    let y = *bv.get(i).unwrap_or(&0);
    if x > y { return 1; }
    if x < y { return -1; }
  }
  0
}
