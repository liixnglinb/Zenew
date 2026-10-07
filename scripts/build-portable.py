# -*- coding: utf-8 -*-
"""从 Tauri release 构建目录制作 Windows 绿色版 ZIP。"""
from pathlib import Path
import json, shutil, sys, zipfile, hashlib

ROOT = Path(__file__).resolve().parents[1]
CONF = ROOT / "app" / "src-tauri" / "tauri.conf.json"
VERSION = json.loads(CONF.read_text(encoding="utf-8"))["version"]
TARGET = ROOT / "app" / "src-tauri" / "target" / "release"
OUT = ROOT / "release"
STAGE = OUT / f"portable-stage-{VERSION}"
ZIP_PATH = OUT / f"Zenew_{VERSION}_x64_green.zip"

if not TARGET.exists():
    raise SystemExit(f"找不到构建目录：{TARGET}，先执行 npm run tauri build")

candidates = [TARGET / "Zenew.exe", TARGET / "app.exe"]
candidates += sorted(TARGET.glob("*.exe"))
exe = next((p for p in candidates if p.is_file()), None)
if exe is None:
    raise SystemExit("找不到 Tauri release EXE（尝试过 Zenew.exe / app.exe）")

if STAGE.exists():
    shutil.rmtree(STAGE)
STAGE.mkdir(parents=True)
shutil.copy2(exe, STAGE / "Zenew.exe")
(STAGE / ".zenew-portable").write_text("portable\n", encoding="utf-8")

resources = TARGET / "resources"
if resources.exists():
    shutil.copytree(resources, STAGE / "resources")

OUT.mkdir(parents=True, exist_ok=True)
if ZIP_PATH.exists():
    ZIP_PATH.unlink()
with zipfile.ZipFile(ZIP_PATH, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for path in sorted(STAGE.rglob("*")):
        if path.is_file():
            z.write(path, path.relative_to(STAGE).as_posix())

sha = hashlib.sha256(ZIP_PATH.read_bytes()).hexdigest()
print(f"绿色版：{ZIP_PATH}")
print(f"大小：{ZIP_PATH.stat().st_size / 1048576:.2f} MB")
print(f"SHA256：{sha}")
shutil.rmtree(STAGE)
