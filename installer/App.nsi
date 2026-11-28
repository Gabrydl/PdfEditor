; FileCompressor / PdfEditor installer (NSIS 3, Modern UI 2) - Install / Repair / Uninstall, in 21 languages.
;   makensis -DAPP=<Name> -DVERSION=<x.y.z> -DUNGUID=<{...}_is1> -DSRC=<built app folder> -DOUT=<Setup.exe> installer/App.nsi
; Per-user install in %LOCALAPPDATA%\Programs\<Name> (no admin). Settings (the "data" folder) are kept on update and Repair.
; It keeps a copy of itself as Setup.exe in the program folder: run it again (or Windows Settings > Apps > Modify) to Repair or Uninstall.
;   Setup.exe /REPAIR       repair the installed copy straight away
;   Setup.exe /VERYSILENT   (or /S) silent update started by the app's updater: no questions, the app opens again at the end
; The first screen asks the language (Windows' language preselected); the app opens in that language (lang.txt).

Unicode true
ManifestDPIAware true
RequestExecutionLevel user
SetCompressor /SOLID lzma

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!define EXE "${APP}.exe"
!define UNEXE "Uninstall ${APP}.exe"
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNGUID}"
!define REGKEY "Software\${APP}"

Name "${APP}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\${APP}"
BrandingText "${APP} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP}"
VIAddVersionKey "FileDescription" "${APP} Setup"
VIAddVersionKey "CompanyName" "Gabrydl"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Copyright (C) 2026 Gabrydl"
ShowInstDetails nevershow

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"

!define MUI_ICON "..\desktop\icon.ico"
!define MUI_UNICON "..\desktop\icon.ico"
!define MUI_ABORTWARNING

Var Repair        ; 1 = repair the installed copy (no welcome page)
Var Installed     ; folder of an existing install, or ""
Var RadioRepair
Var RadioRemove
Var LangCode
Var LangAsked

; ---------------------------------------------------------------- pages
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfInstalled
!define MUI_WELCOMEPAGE_TITLE "$(WELCOME_TITLE)"
!define MUI_WELCOMEPAGE_TEXT "$(WELCOME_TEXT)"
!insertmacro MUI_PAGE_WELCOME
Page custom MaintenancePage MaintenanceLeave
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "$(RUN_TEXT)"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!define MUI_LANGDLL_ALLLANGUAGES
!define MUI_LANGDLL_WINDOWTITLE "${APP}"
!define MUI_LANGDLL_INFO "Language / Lingua / Idioma / Sprache / Langue / Wika / Jazyk / Język / Kieli / Keel / Језик / Jezik / Език / Язык / Γλώσσα"
!insertmacro MUI_LANGUAGEEX "lang" "English"
!insertmacro MUI_LANGUAGEEX "lang" "Italian"
!insertmacro MUI_LANGUAGEEX "lang" "PortugueseBR"
!insertmacro MUI_LANGUAGEEX "lang" "Portuguese"
!insertmacro MUI_LANGUAGEEX "lang" "Spanish"
!insertmacro MUI_LANGUAGEEX "lang" "SpanishLatAm"
!insertmacro MUI_LANGUAGEEX "lang" "German"
!insertmacro MUI_LANGUAGEEX "lang" "French"
!insertmacro MUI_LANGUAGEEX "lang" "Tagalog"
!insertmacro MUI_LANGUAGEEX "lang" "Cebuano"
!insertmacro MUI_LANGUAGEEX "lang" "Czech"
!insertmacro MUI_LANGUAGEEX "lang" "Polish"
!insertmacro MUI_LANGUAGEEX "lang" "Finnish"
!insertmacro MUI_LANGUAGEEX "lang" "Estonian"
!insertmacro MUI_LANGUAGEEX "lang" "Serbian"
!insertmacro MUI_LANGUAGEEX "lang" "Croatian"
!insertmacro MUI_LANGUAGEEX "lang" "Montenegrin"
!insertmacro MUI_LANGUAGEEX "lang" "Bosnian"
!insertmacro MUI_LANGUAGEEX "lang" "Bulgarian"
!insertmacro MUI_LANGUAGEEX "lang" "Russian"
!insertmacro MUI_LANGUAGEEX "lang" "Greek"
!insertmacro MUI_RESERVEFILE_LANGDLL
!include "strings.nsh"

; ---------------------------------------------------------------- init
Function .onInit
  StrCpy $Repair 0
  StrCpy $Installed ""
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/VERYSILENT" $R1
  ${IfNot} ${Errors}
    SetSilent silent
  ${EndIf}

  ; an existing install (this installer, or the older Inno Setup one: same uninstall entry)
  ReadRegStr $0 HKCU "${UNKEY}" "InstallLocation"
  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0\${EXE}"
    StrCpy $Installed $0
    StrCpy $INSTDIR $0
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/REPAIR" $R1
  ${IfNot} ${Errors}
    ${If} $Installed == ""
      ${GetParent} "$EXEPATH" $R2           ; Setup.exe inside the program folder
      ${If} ${FileExists} "$R2\${EXE}"
        StrCpy $Installed $R2
        StrCpy $INSTDIR $R2
      ${EndIf}
    ${EndIf}
    ${If} $Installed != ""
      StrCpy $Repair 1
    ${EndIf}
  ${EndIf}

  ; language: the one picked last time, otherwise ask (Windows language preselected)
  ReadRegStr $0 HKCU "${REGKEY}" "Language"
  ${If} $0 != ""
    StrCpy $LANGUAGE $0
  ${Else}
    ; Spanish outside Spain -> Latin American Spanish
    System::Call 'kernel32::GetUserDefaultUILanguage() i .r1'
    IntOp $2 $1 & 0x3FF
    ${If} $2 == 0x0A
    ${AndIf} $1 != 1034
    ${AndIf} $1 != 3082
      StrCpy $LANGUAGE 2058
    ${EndIf}
  ${EndIf}
  StrCpy $LangAsked 0
  ${IfNot} ${Silent}
  ${AndIf} $Repair != 1
    !insertmacro MUI_LANGDLL_DISPLAY
    StrCpy $LangAsked 1
  ${EndIf}
  StrCpy $LangCode "$(LANG_CODE)"
FunctionEnd

Function un.onInit
  ReadRegStr $0 HKCU "${REGKEY}" "Language"
  ${If} $0 != ""
    StrCpy $LANGUAGE $0
  ${EndIf}
FunctionEnd

Function SkipIfInstalled
  ${If} $Installed != ""
    Abort
  ${EndIf}
FunctionEnd

; ---------------------------------------------------------------- already installed: Repair or Uninstall
Function MaintenancePage
  ${If} $Installed == ""
  ${OrIf} $Repair == 1
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "$(MAINT_TITLE)" "$(MAINT_SUB)"
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 16u "$(CHOOSE)"
  Pop $0
  ${NSD_CreateRadioButton} 10u 22u 100% 12u "$(REPAIR)"
  Pop $RadioRepair
  ${NSD_CreateLabel} 24u 36u 90% 28u "$(REPAIR_DESC)"
  Pop $0
  ${NSD_CreateRadioButton} 10u 72u 100% 12u "$(UNINSTALL)"
  Pop $RadioRemove
  ${NSD_CreateLabel} 24u 86u 90% 28u "$(UNINSTALL_DESC)"
  Pop $0
  ${NSD_Check} $RadioRepair
  nsDialogs::Show
FunctionEnd

Function MaintenanceLeave
  ${NSD_GetState} $RadioRemove $0
  ${If} $0 == ${BST_CHECKED}
    ${If} ${FileExists} "$Installed\${UNEXE}"
      Exec '"$Installed\${UNEXE}"'
    ${ElseIf} ${FileExists} "$Installed\unins000.exe"
      Exec '"$Installed\unins000.exe"'
    ${EndIf}
    Quit
  ${EndIf}
  StrCpy $Repair 1
FunctionEnd

; ---------------------------------------------------------------- install / repair
Section "Install"
  ; close the running app first
  nsExec::Exec '"$SYSDIR\taskkill.exe" /f /im ${EXE}'
  Sleep 800
  SetOutPath "$INSTDIR"
  ; the program files are replaced completely (Repair puts back anything broken or missing); settings live in "data"
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  Delete "$INSTDIR\unins000.exe"
  Delete "$INSTDIR\unins000.dat"
  File /r "${SRC}\*.*"
  ${If} "$EXEPATH" != "$INSTDIR\Setup.exe"
    CopyFiles /SILENT "$EXEPATH" "$INSTDIR\Setup.exe"
  ${EndIf}
  WriteUninstaller "$INSTDIR\${UNEXE}"

  CreateShortcut "$SMPROGRAMS\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0 SW_SHOWNORMAL "" "$(SHORTCUT)"
  CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0 SW_SHOWNORMAL "" "$(SHORTCUT)"

  WriteRegStr HKCU "${REGKEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "Language" "$LANGUAGE"
  ${If} $LangAsked == 1                     ; picked in this setup: the app opens in that language
    FileOpen $0 "$INSTDIR\lang.txt" w
    FileWrite $0 "$LangCode"
    FileClose $0
  ${EndIf}
  WriteRegStr HKCU "${UNKEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNKEY}" "Publisher" "Gabrydl"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" '"$INSTDIR\${UNEXE}"'
  WriteRegStr HKCU "${UNKEY}" "QuietUninstallString" '"$INSTDIR\${UNEXE}" /S'
  WriteRegStr HKCU "${UNKEY}" "ModifyPath" '"$INSTDIR\Setup.exe"'
  WriteRegStr HKCU "${UNKEY}" "URLInfoAbout" "https://github.com/Gabrydl/${APP}"
  WriteRegDWORD HKCU "${UNKEY}" "NoModify" 0
  WriteRegDWORD HKCU "${UNKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNKEY}" "EstimatedSize" "$0"

  ; silent update started from inside the app: open it again
  ${If} ${Silent}
    Exec '"$INSTDIR\${EXE}"'
  ${EndIf}
SectionEnd

; ---------------------------------------------------------------- uninstall
Section "Uninstall"
  nsExec::Exec '"$SYSDIR\taskkill.exe" /f /im ${EXE}'
  Sleep 800
  Delete "$SMPROGRAMS\${APP}.lnk"
  Delete "$DESKTOP\${APP}.lnk"
  !include "uninstall_extra.nsh"
  DeleteRegKey HKCU "${UNKEY}"
  DeleteRegKey HKCU "${REGKEY}"
  ; only the program's own files: results the user keeps next to the program (Compressed, Original) stay
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  RMDir /r "$INSTDIR\data"
  Delete "$INSTDIR\${EXE}"
  Delete "$INSTDIR\Setup.exe"
  Delete "$INSTDIR\*.dll"
  Delete "$INSTDIR\*.pak"
  Delete "$INSTDIR\*.bin"
  Delete "$INSTDIR\*.dat"
  Delete "$INSTDIR\LICENSE*"
  Delete "$INSTDIR\version"
  Delete "$INSTDIR\vk_swiftshader_icd.json"
  Delete "$INSTDIR\lang.txt"
  Delete "$INSTDIR\${APP}.log"
  Delete "$INSTDIR\${APP}.old.log"
  Delete "$INSTDIR\unins000.*"
  Delete "$INSTDIR\${UNEXE}"
  RMDir "$INSTDIR"
SectionEnd
