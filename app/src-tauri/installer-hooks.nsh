; Zenew 安装器钩子：注册 zenew:// 深链协议（HKCU，无需管理员）
; 付款成功后购买页用该协议把已打开的软件拉到前台并通知到账

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\zenew" "" "URL:Zenew Protocol"
  WriteRegStr HKCU "Software\Classes\zenew" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\zenew\DefaultIcon" "" "$INSTDIR\app.exe,0"
  WriteRegStr HKCU "Software\Classes\zenew\shell\open\command" "" '"$INSTDIR\app.exe" "%1"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\zenew"
!macroend
