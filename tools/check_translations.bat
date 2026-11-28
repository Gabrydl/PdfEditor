@echo off
rem Double-click to check the PdfEditor translations (all 20 languages): a quick check first (offline, a few seconds),
rem then, if you want, a full review of every line by Gemini. The report opens in Notepad when it's done.
rem Only some languages:  check_translations.bat it de fr
rem It runs with PdfEditor's own program (no Python or Node needed).
chcp 65001 >nul
setlocal
set "HERE=%~dp0"
set "EXE="
for %%E in ("%HERE%PdfEditor\PdfEditor.exe" "%HERE%..\PdfEditor\PdfEditor.exe" "%LOCALAPPDATA%\Programs\PdfEditor\PdfEditor.exe") do if not defined EXE if exist "%%~E" set "EXE=%%~E"
if defined EXE (
  set ELECTRON_RUN_AS_NODE=1
  "%EXE%" "%HERE%check_translations.js" %*
) else (
  where node >nul 2>nul && node "%HERE%check_translations.js" %* || echo PdfEditor was not found. Install it, or keep this file in the project folder next to the PdfEditor folder.
)
if exist "%HERE%translation_check.txt" start "" notepad "%HERE%translation_check.txt"
echo.
pause
