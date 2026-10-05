; Zenew 安装器钩子
; 1) 安装位置防呆  2) 注册 zenew:// 深链协议（HKCU，无需管理员）
; 深链最初为「付款到账后把软件拉到前台」而设；付费体系已于 2026-10-03 下线，
; 协议与单实例转发保留（配合 tauri-plugin-single-instance，仍可从外部唤起已运行的窗口）。

; 防呆：不允许把软件装进「桌面」下（含桌面里的源码仓库目录）。
; v0.21.0 及之前本机就装进了 桌面\课程学习软件\Zenew，之后每次升级 NSIS 都沿用这个错误位置，
; 把 app.exe / uninstall.exe 混进 git 工作区。这里强制回落到 per-user 标准位置。
; 用纯 NSIS 指令做前缀比较，不依赖 LogicLib（hook 的 include 环境不确定）。
!macro NSIS_HOOK_PREINSTALL
  StrLen $9 "$DESKTOP"
  StrCpy $8 "$INSTDIR" $9
  StrCmp $8 "$DESKTOP" 0 +2
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\Zenew"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\zenew" "" "URL:Zenew Protocol"
  WriteRegStr HKCU "Software\Classes\zenew" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\zenew\DefaultIcon" "" "$INSTDIR\app.exe,0"
  WriteRegStr HKCU "Software\Classes\zenew\shell\open\command" "" '"$INSTDIR\app.exe" "%1"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\zenew"
!macroend
