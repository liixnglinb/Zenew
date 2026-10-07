# -*- coding: utf-8 -*-
"""生成 Tauri 安装版 + Windows 绿色版共用的 latest.json。"""
import json, io, os, sys, datetime, shutil, hashlib

Z = r"..\Zenew"
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
VERSION = json.load(io.open(os.path.join(ROOT, "app", "src-tauri", "tauri.conf.json"), encoding="utf-8"))["version"]
TAG = f"v{VERSION}"

setup = os.path.join(ROOT, "app", "src-tauri", "target", "release", "bundle", "nsis", f"Zenew_{VERSION}_x64-setup.exe")
sig_src = setup + ".sig"
out_dir = os.path.join(ROOT, "release")
green = os.path.join(out_dir, f"Zenew_{VERSION}_x64_green.zip")

os.makedirs(out_dir, exist_ok=True)
assert os.path.isfile(setup), f"缺少安装包: {setup}"
assert os.path.isfile(sig_src), f"缺少签名: {sig_src}"
assert os.path.isfile(green), f"缺少绿色版: {green}（先运行 python scripts/build-portable.py）"

dst_exe = os.path.join(out_dir, "Zenew-Setup.exe")
dst_sig = os.path.join(out_dir, "Zenew-Setup.exe.sig")
shutil.copyfile(setup, dst_exe)
shutil.copyfile(sig_src, dst_sig)

sig = io.open(dst_sig, encoding="utf-8").read().strip()
notes_path = os.path.join(out_dir, f"NOTES-{VERSION}.md")
notes = io.open(notes_path, encoding="utf-8").read().strip() if os.path.isfile(notes_path) else f"Zenew {TAG}"
green_sig_path = green + ".sig"
green_sha = hashlib.sha256(io.open(green, "rb").read()).hexdigest()

if not os.path.isfile(green_sig_path):
    raise SystemExit(f"缺少绿色版签名文件：{green_sig_path}。使用同一 minisign 私钥签名 ZIP 后再生成清单。")
green_sig = io.open(green_sig_path, encoding="utf-8").read().strip()

manifest = {
    "version": VERSION,
    "notes": notes,
    "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "platforms": {
        "windows-x86_64": {
            "signature": sig,
            "url": "https://lxlrwxs.top/zenew/dl/Zenew-Setup.exe",
        }
    },
    "portable": {
        "url": f"https://lxlrwxs.top/zenew/dl/Zenew_{VERSION}_x64_green.zip",
        "signature": green_sig,
        "sha256": green_sha,
        "size": os.path.getsize(green),
    },
}

with io.open(os.path.join(out_dir, "latest.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)

print("安装包:", dst_exe, round(os.path.getsize(dst_exe) / 1048576, 2), "MB")
print("绿色版:", green, round(os.path.getsize(green) / 1048576, 2), "MB")
print("绿色 SHA256:", green_sha)
print("清单:", os.path.join(out_dir, "latest.json"))
