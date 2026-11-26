# PdfEditor

Everything for PDFs, offline: view, annotate, edit, organize pages, OCR, convert PDF ⇄ Word/Excel/PowerPoint/images, compare, protect.

## Download

The Windows installer and the Android APK are published in this repository's Releases section.

## Updates
Both apps check the latest release every time they open. If a newer one exists they ask; on Windows **Update now** downloads it,
replaces the program files (the `data` folder is kept) and restarts. On the phone it downloads the new APK to install over the old one.

## Source
- `www/` – the app (same code on phone and PC)
- `desktop/` – Windows shell (Electron), including `updater.js`
- `android-app/` – the phone app's source: a Kotlin shell (open, save, share, read aloud) around `www/`. `.github/workflows/android.yml` builds it
  (unsigned) into the `android-build` pre-release; sign it with `tools/apk_repack.py ... keys/pdfeditor --cn PdfEditor`
- `android/PdfEditor.apk` – signed phone build, published with the release
- `tools/apk_repack.py` – puts new `www/` pages into the APK and signs it
- `.github/workflows/release.yml` – builds the Windows installer (Inno Setup, `installer/PdfEditor.iss`) and publishes release `v<version in desktop/package.json>`
- `installer/PdfEditor.nsi` – the same installer made with NSIS, which also builds on Linux without GitHub:
  `makensis -DVERSION=<version> -DSRC=<built app folder> -DOUT=PdfEditor-Setup.exe installer/PdfEditor.nsi`
  (it installs over a version installed by the Inno Setup installer and accepts the updater's `/VERYSILENT`)

## Building without GitHub
1. Windows app: unzip `electron-v45.3.0-win32-x64.zip` into `PdfEditor/`, delete `resources/default_app.asar`, copy `desktop/` into
   `resources/app/` and `www/` into `resources/app/www/`, rename `electron.exe` to `PdfEditor.exe`, run `tools/set_exe_info.js` (needs `npm i resedit pe-library`),
   then `makensis` as above.
2. Phone app: `python3 tools/apk_repack.py <installed PdfEditor.apk> PdfEditor.apk "<G:\Progetti\0. keys\5. PdfEditor>" --assets www:assets/www/ --version-code <higher> --version-name X.Y.Z --old-version-name <old> --cn PdfEditor`.
   It keeps the phone shell of the installed APK and signs with the same key, so it installs as an update.

## Settings › Features
Every function can be switched off (search, bookmarks, night mode, two pages, reading mode, read aloud, compare, print, export notes,
copy/drag pages, dropping files, split, compress, password, OCR, convert): its buttons, menu entries, home tiles and shortcuts disappear.

To ship a new version: change the code, raise `version` in `desktop/package.json` and `APP_VERSION` in `www/app.js`, rebuild the APK
(`python3 tools/apk_repack.py <old apk> android/PdfEditor.apk <keys dir> --assets www:assets/www/ --version-code <higher number>`), push.
