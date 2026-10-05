; Zenew 安装器钩子：注册 zenew:// 深链协议（HKCU，无需管理员）
; 深链最初为「付款到账后把软件拉到前台」而设；付费体系已于 2026-10-03 下线，
; 协议与单实例转发保留（配合 tauri-plugin-single-instance，仍可从外部唤起已运行的窗口）。

; ⚠ 不要在本文件里用 $0–$9 写「安装位置防呆」之类的逻辑。
; 2026-10-05 实测教训：曾在 NSIS_HOOK_PREINSTALL 里用 StrLen $9 "$DESKTOP" / StrCpy $8 ...
; 做桌面路径检测，结果 makensis 正常出包、安装器退出码 0、注册表三个键值都写对了，
; 但 **一个文件都没拷进 $INSTDIR**（Programs\Zenew 根本不存在）——
; Tauri 的 installer.nsi 模板自己占用 $0–$9 传递解压与安装路径，hook 里覆写会静默破坏后续 File 段。
; 要做安装位置约束，应改用 Tauri 官方 nsis 配置项（installMode / perUser）或经完整安装验证的方案。

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\zenew" "" "URL:Zenew Protocol"
  WriteRegStr HKCU "Software\Classes\zenew" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\zenew\DefaultIcon" "" "$INSTDIR\app.exe,0"
  WriteRegStr HKCU "Software\Classes\zenew\shell\open\command" "" '"$INSTDIR\app.exe" "%1"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\zenew"
!macroend
