# PdfEditor

Everything for PDFs, offline: view, annotate, edit, organize pages, OCR, convert PDF ⇄ Word/Excel/PowerPoint/images, compare, protect.

- **Windows**: `PdfEditor-Windows.zip` from the latest [Release](../../releases/latest). Unzip anywhere and run `PdfEditor.exe` (portable, settings stay in its `data` folder).
- **Phone**: `PdfEditor.apk` from the same release (Android).

## Updates
Both apps check the latest release every time they open. If a newer one exists they ask; on Windows **Update now** downloads it,
replaces the program files (the `data` folder is kept) and restarts. On the phone it downloads the new APK to install over the old one.

## Source
- `www/` – the app (same code on phone and PC)
- `desktop/` – Windows shell (Electron), including `updater.js`
- `android/PdfEditor.apk` – signed phone build, published with the release
- `tools/apk_repack.py` – puts new `www/` pages into the APK and signs it
- `.github/workflows/release.yml` – builds the Windows zip and publishes release `v<version in desktop/package.json>`

To ship a new version: change the code, raise `version` in `desktop/package.json` and `APP_VERSION` in `www/app.js`, rebuild the APK
(`python3 tools/apk_repack.py <old apk> android/PdfEditor.apk <keys dir> --assets www:assets/www/ --version-code <higher number>`), push.
