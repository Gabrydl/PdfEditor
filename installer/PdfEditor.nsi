; PdfEditor - Windows installer made with NSIS (builds on Linux too: makensis). Same behaviour as PdfEditor.iss:
;   per-user install in %LOCALAPPDATA%\Programs\PdfEditor (no admin), Start menu + Desktop shortcuts, settings ("data" folder)
;   kept on update. It replaces an earlier install made with the Inno Setup installer (same folder, same uninstall entry).
;   makensis -DVERSION=<version> -DSRC=<built app folder> -DOUT=<output exe> installer/PdfEditor.nsi
; Silent update from inside the app: the updater passes /VERYSILENT (Inno style) or /S; both work, and the app opens again.

Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user
ManifestDPIAware true

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!define APP "PdfEditor"
!define EXE "PdfEditor.exe"
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\{8A1E2C55-4B7D-4F0A-9C3E-6D2B1F7A9E41}_is1"

Name "${APP}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\${APP}"
BrandingText "${APP} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP}"
VIAddVersionKey "FileDescription" "${APP} installer"
VIAddVersionKey "CompanyName" "Gabrydl"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" ""

!include "MUI2.nsh"
!include "FileFunc.nsh"

!define MUI_ICON "..\desktop\icon.ico"
!define MUI_UNICON "..\desktop\icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Open ${APP}"
!define MUI_WELCOMEPAGE_TITLE "Install ${APP} ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Everything for PDFs, offline.$\r$\n$\r$\n${APP} is installed for you only, in your user folder, so it doesn't need administrator rights. If an older version is installed, it is updated and your settings are kept.$\r$\n$\r$\nClick Next to install it."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/VERYSILENT" $R1
  IfErrors +2
  SetSilent silent
FunctionEnd

Section "Install"
  ; close the running app first
  nsExec::Exec '"$SYSDIR\taskkill.exe" /f /im ${EXE}'
  Sleep 800
  SetOutPath "$INSTDIR"
  ; old pages from the previous version (settings live in the "data" folder and are kept)
  RMDir /r "$INSTDIR\resources\app\www"
  ; files left by the earlier Inno Setup installer
  Delete "$INSTDIR\unins000.exe"
  Delete "$INSTDIR\unins000.dat"
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall ${APP}.exe"

  CreateShortcut "$SMPROGRAMS\${APP}.lnk" "$INSTDIR\${EXE}"
  CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\${EXE}"

  WriteRegStr HKCU "${UNKEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNKEY}" "Publisher" "Gabrydl"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" '"$INSTDIR\Uninstall ${APP}.exe"'
  WriteRegStr HKCU "${UNKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall ${APP}.exe" /S'
  WriteRegStr HKCU "${UNKEY}" "URLInfoAbout" "https://github.com/Gabrydl/PdfEditor"
  WriteRegDWORD HKCU "${UNKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNKEY}" "EstimatedSize" "$0"

  ; silent update started from inside the app: open it again
  IfSilent 0 +2
  Exec '"$INSTDIR\${EXE}"'
SectionEnd

Section "Uninstall"
  nsExec::Exec '"$SYSDIR\taskkill.exe" /f /im ${EXE}'
  Sleep 800
  Delete "$SMPROGRAMS\${APP}.lnk"
  Delete "$DESKTOP\${APP}.lnk"
  ; "Open with PdfEditor" and the PDF app registration, if they were switched on in Settings
  DeleteRegKey HKCU "Software\Classes\PdfEditor.PDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\PdfEditor"
  DeleteRegKey HKCU "Software\Classes\Applications\PdfEditor.exe"
  DeleteRegValue HKCU "Software\Classes\.pdf\OpenWithProgids" "PdfEditor.PDF"
  DeleteRegValue HKCU "Software\RegisteredApplications" "PdfEditor"
  DeleteRegKey HKCU "Software\PdfEditor"
  DeleteRegKey HKCU "${UNKEY}"
  RMDir /r "$INSTDIR"
SectionEnd
