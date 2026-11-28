; uninstall: what the app itself added to Windows
; "Open with PdfEditor" and the PDF app registration, if they were switched on in Settings
  DeleteRegKey HKCU "Software\Classes\PdfEditor.PDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\PdfEditor"
  DeleteRegKey HKCU "Software\Classes\Applications\PdfEditor.exe"
  DeleteRegValue HKCU "Software\Classes\.pdf\OpenWithProgids" "PdfEditor.PDF"
  DeleteRegValue HKCU "Software\RegisteredApplications" "PdfEditor"
  DeleteRegKey HKCU "Software\PdfEditor"
