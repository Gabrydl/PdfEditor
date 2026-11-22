; PdfEditor - Windows installer (Inno Setup 6). Built by .github/workflows/release.yml:
;   ISCC /DMyAppVersion=<version> installer\PdfEditor.iss   (expects the built app in out\PdfEditor)

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#define MyAppName "PdfEditor"
#define MyAppExe "PdfEditor.exe"

[Setup]
AppId={{8A1E2C55-4B7D-4F0A-9C3E-6D2B1F7A9E41}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher=Gabrydl
AppPublisherURL=https://github.com/Gabrydl/PdfEditor
AppUpdatesURL=https://github.com/Gabrydl/PdfEditor/releases
VersionInfoVersion={#MyAppVersion}
; per-user install: no admin prompt, and the app can update itself silently
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\{#MyAppName}
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
UsePreviousAppDir=yes
OutputDir=..\dist-installer
OutputBaseFilename={#MyAppName}-Setup
SetupIconFile=..\desktop\icon.ico
UninstallDisplayIcon={app}\{#MyAppExe}
UninstallDisplayName={#MyAppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=force
RestartApplications=no

[Files]
Source: "..\out\{#MyAppName}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; old pages from the previous version (settings live in the "data" folder and are kept)
Type: filesandordirs; Name: "{app}\resources\app\www"

[Icons]
Name: "{userprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"

[Run]
; silent update started from inside the app: open it again
Filename: "{app}\{#MyAppExe}"; Flags: nowait; Check: WizardSilent
Filename: "{app}\{#MyAppExe}"; Description: "Open {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/f /im {#MyAppExe}"; Flags: runhidden; RunOnceId: "StopApp"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\data"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/f /im {#MyAppExe}', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Sleep(800);
  Result := '';
end;
