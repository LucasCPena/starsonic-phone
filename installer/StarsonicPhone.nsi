; Instalador do Starsonic Phone (NSIS 3, Unicode), gerado por build\Build-Installer.ps1, que define
; VERSION, VERSION_QUAD, APP_ICON, FILES_NSH, OUTFILE e, quando existir, WELCOME_BMP.

Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!include "MUI2.nsh"
!include "${FILES_NSH}"

!define APP_NAME "Starsonic Phone"
!define APP_EXE "StarsonicPhone.exe"

Name "${APP_NAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Starsonic Phone"
BrandingText "Starsonic"

!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"

!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Section "-Starsonic Phone"
  SetOutPath "$INSTDIR"
  !insertmacro StarsonicInstallFiles
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  !insertmacro StarsonicUninstallFiles
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
