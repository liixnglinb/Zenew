# -*- coding: utf-8 -*-
"""生成 Tauri 更新清单 latest.json（与 scripts/publish-release.sh 同逻辑）"""
import json, io, os, sys, datetime, shutil, hashlib

Z = r"C:\Users\李星历\Desktop\课程学习软件\Zenew"
VERSION = "0.15.0"
TAG = f"v{VERSION}"
REPO = "liixnglinb/Zenew"

setup = os.path.join(Z, "app", "src-tauri", "target", "release", "bundle", "nsis", f"Zenew_{VERSION}_x64-setup.exe")
sig_src = setup + ".sig"
out_dir = os.path.join(Z, "release")
os.makedirs(out_dir, exist_ok=True)

assert os.path.isfile(setup), f"缺少安装包: {setup}"
assert os.path.isfile(sig_src), f"缺少签名: {sig_src}"

dst_exe = os.path.join(out_dir, "Zenew-Setup.exe")
dst_sig = os.path.join(out_dir, "Zenew-Setup.exe.sig")
shutil.copyfile(setup, dst_exe)
shutil.copyfile(sig_src, dst_sig)

sig = io.open(dst_sig, encoding="utf-8").read().strip()

notes_path = os.path.join(out_dir, f"NOTES-{VERSION}.md")
notes = io.open(notes_path, encoding="utf-8").read().strip() if os.path.isfile(notes_path) else f"Zenew {TAG}"

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
}
with io.open(os.path.join(out_dir, "latest.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)

h = hashlib.sha256(io.open(dst_exe, "rb").read()).hexdigest()
print("安装包 :", dst_exe, round(os.path.getsize(dst_exe) / 1048576, 2), "MB")
print("sha256 :", h)
print("签名   :", len(sig), "字符")
print("清单   : version", manifest["version"], "| notes 长度", len(notes))
print("清单 url:", manifest["platforms"]["windows-x86_64"]["url"])
