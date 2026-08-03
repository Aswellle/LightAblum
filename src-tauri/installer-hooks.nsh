; src-tauri/installer-hooks.nsh
;
; Tauri v2 NSIS installer hooks (bundle.windows.nsis.installerHooks in tauri.conf.json).
;
; BUGFIX: the uninstaller previously only removed the installed program files —
; it never touched %APPDATA%\LightAlbum\ (library.db + thumbnails\), so every
; uninstall left the full photo library metadata and the (potentially multi-GB)
; thumbnail cache behind on disk with no way to reclaim it short of manually
; finding and deleting the AppData folder.
;
; This hook asks the user at uninstall time and only deletes app data if they
; opt in — deleting it unconditionally would be wrong for users who are just
; upgrading/reinstalling rather than actually leaving.

!macro NSIS_HOOK_POSTUNINSTALL
  MessageBox MB_YESNO|MB_ICONQUESTION "是否同时删除 LightAlbum 的照片库数据？$\r$\n$\r$\n\
包括：相册分类、标签、收藏记录、缩略图缓存（不包括你的原始照片文件，原图从不会被删除）。$\r$\n$\r$\n\
数据位置：$APPDATA\LightAlbum" \
    IDYES la_delete_data IDNO la_keep_data

  la_delete_data:
    RMDir /r "$APPDATA\LightAlbum"
    Goto la_uninstall_data_done
  la_keep_data:
  la_uninstall_data_done:
!macroend
