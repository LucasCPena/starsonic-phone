; Instalador do Starsonic Phone (NSIS 3, Unicode), gerado por build\Build-Installer.ps1, que define
; VERSION (X.Y.Z ou X.Y.Z-rc.N), VERSION_QUAD (X.Y.Z.N), APP_ICON, FILES_NSH (macros com a lista
; dos arquivos), OUTFILE e, quando existir, WELCOME_BMP (164x314).
;
; Por usuario, em %LOCALAPPDATA%\Starsonic Phone (spec 9.5). Em /S (atualizacao pelo app): fecha o
; app, troca os arquivos sem mexer nos atalhos nem no "Iniciar com o Windows" e reabre o app; se
; der errado, reabre a versao que ficou e registra o motivo em instalador.log, na pasta do app.

Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!macro RequireDefine NAME
  !ifndef ${NAME}
    !error "${NAME} nao definido: gere o instalador com build\Build-Installer.ps1"
  !endif
!macroend
!insertmacro RequireDefine VERSION
!insertmacro RequireDefine VERSION_QUAD
!insertmacro RequireDefine APP_ICON
!insertmacro RequireDefine FILES_NSH
!insertmacro RequireDefine OUTFILE

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "${FILES_NSH}"

!define APP_NAME "Starsonic Phone"
!define APP_EXE "StarsonicPhone.exe"
!define APP_CLASS "Starsonic Phone"
!define REG_APP "Software\Starsonic Phone"
!define REG_RUN "Software\Microsoft\Windows\CurrentVersion\Run"
!define REG_UNINSTALL "Software\Microsoft\Windows\CurrentVersion\Uninstall\StarsonicPhone"

Name "${APP_NAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Starsonic Phone"
InstallDirRegKey HKCU "${REG_APP}" ""
BrandingText "Starsonic"
ShowInstDetails hide
ShowUninstDetails hide

!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_ABORTWARNING
!ifdef WELCOME_BMP
  !define MUI_WELCOMEFINISHPAGE_BITMAP "${WELCOME_BMP}"
!endif
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o Starsonic Phone"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

VIProductVersion "${VERSION_QUAD}"
VIFileVersion "${VERSION_QUAD}"
VIAddVersionKey /LANG=${LANG_PORTUGUESEBR} "ProductName" "${APP_NAME}"
VIAddVersionKey /LANG=${LANG_PORTUGUESEBR} "CompanyName" "Starsonic"
VIAddVersionKey /LANG=${LANG_PORTUGUESEBR} "FileDescription" "Instalador do Starsonic Phone"
VIAddVersionKey /LANG=${LANG_PORTUGUESEBR} "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_PORTUGUESEBR} "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_PORTUGUESEBR} "LegalCopyright" "Software livre sob a GNU GPL v3"

Var Attempts
Var Closed

; Fecha o app, se estiver aberto, e espera ate 30 s a janela sumir e o exe ficar livre (o processo
; ainda roda um pouco depois de fechar a janela). $Closed = 1 quando deu certo.
!macro CloseAppBody
  FindWindow $0 "${APP_CLASS}"
  ${If} $0 <> 0
  ${AndIf} ${FileExists} "$INSTDIR\${APP_EXE}"
    ExecWait '"$INSTDIR\${APP_EXE}" /exit'
  ${EndIf}
  StrCpy $Closed 0
  StrCpy $Attempts 0
  ${Do}
    FindWindow $0 "${APP_CLASS}"
    ${If} $0 = 0
      ${IfNot} ${FileExists} "$INSTDIR\${APP_EXE}"
        StrCpy $Closed 1
        ${Break}
      ${EndIf}
      ClearErrors
      FileOpen $1 "$INSTDIR\${APP_EXE}" a
      ${IfNot} ${Errors}
        FileClose $1
        StrCpy $Closed 1
        ${Break}
      ${EndIf}
    ${EndIf}
    IntOp $Attempts $Attempts + 1
    ${If} $Attempts > 60
      ${Break}
    ${EndIf}
    Sleep 500
  ${Loop}
!macroend

Function CloseApp
  !insertmacro CloseAppBody
FunctionEnd

Function un.CloseApp
  !insertmacro CloseAppBody
FunctionEnd

; Acrescenta "data hora versao: motivo" a instalador.log, na pasta do app.
Function WriteLog
  Exch $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  Push $R8
  ${GetTime} "" "L" $R1 $R2 $R3 $R4 $R5 $R6 $R7
  CreateDirectory "$INSTDIR"
  ClearErrors
  FileOpen $R8 "$INSTDIR\instalador.log" a
  ${IfNot} ${Errors}
    FileSeek $R8 0 END
    FileWrite $R8 "$R3-$R2-$R1 $R5:$R6:$R7 ${VERSION}: $R0$\r$\n"
    FileClose $R8
  ${EndIf}
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd

; Para a instalacao: registra o motivo (ASCII) e, fora do modo silencioso, mostra a mensagem.
!macro FailInstall REASON MESSAGE
  Push "${REASON}"
  Call WriteLog
  MessageBox MB_ICONSTOP "${MESSAGE}" /SD IDOK
  Abort
!macroend

; Reabre o app depois da instalacao silenciosa (atualizacao), se ele nao estiver aberto.
Function ReopenApp
  FindWindow $0 "${APP_CLASS}"
  ${If} $0 = 0
  ${AndIf} ${FileExists} "$INSTDIR\${APP_EXE}"
    SetOutPath "$INSTDIR"
    Exec '"$INSTDIR\${APP_EXE}"'
  ${EndIf}
FunctionEnd

Section "-Starsonic Phone" SecMain
  Call CloseApp
  ${If} $Closed <> 1
    !insertmacro FailInstall "o app continua aberto" "Feche o Starsonic Phone e tente de novo."
  ${EndIf}

  SetOutPath "$INSTDIR"
  SetOverwrite on
  ClearErrors
  !insertmacro StarsonicInstallFiles
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  ${If} ${Errors}
    !insertmacro FailInstall "falha ao copiar os arquivos" "Não foi possível copiar os arquivos do Starsonic Phone."
  ${EndIf}

  ; O MicroSIP entra em modo instalado quando o (Padrão) desta chave e a pasta do exe.
  WriteRegStr HKCU "${REG_APP}" "" "$INSTDIR"

  ; Atalho do menu Iniciar; na atualizacao silenciosa, o que existir fica como esta.
  ${IfNot} ${Silent}
  ${OrIfNot} ${FileExists} "$SMPROGRAMS\${APP_NAME}.lnk"
    CreateShortCut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  ${EndIf}

  ; "Iniciar com o Windows" desmarcado; a secao do componente liga de novo.
  ${IfNot} ${Silent}
    WriteRegDWORD HKCU "${REG_APP}" "RunAtSystemStartup" 0
    DeleteRegValue HKCU "${REG_RUN}" "${APP_NAME}"
  ${EndIf}

  WriteRegStr HKCU "${REG_UNINSTALL}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${REG_UNINSTALL}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${REG_UNINSTALL}" "Publisher" "Starsonic"
  WriteRegStr HKCU "${REG_UNINSTALL}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "${REG_UNINSTALL}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${REG_UNINSTALL}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegStr HKCU "${REG_UNINSTALL}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${REG_UNINSTALL}" "URLInfoAbout" "https://starsonic.com.br/"
  WriteRegDWORD HKCU "${REG_UNINSTALL}" "NoModify" 1
  WriteRegDWORD HKCU "${REG_UNINSTALL}" "NoRepair" 1
SectionEnd

Section "Atalho na área de trabalho" SecDesktop
  ${IfNot} ${Silent}
    CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  ${EndIf}
SectionEnd

Section "Iniciar com o Windows" SecStartup
  ${IfNot} ${Silent}
    ; RunAtSystemStartup vale na primeira abertura (regra do MicroSIP); o valor de Run, igual ao
    ; que o app grava, vale tambem para quem reinstala com as configuracoes ja criadas.
    WriteRegDWORD HKCU "${REG_APP}" "RunAtSystemStartup" 1
    WriteRegStr HKCU "${REG_RUN}" "${APP_NAME}" '"$INSTDIR\${APP_EXE}" /minimized'
  ${EndIf}
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "Cria um atalho do Starsonic Phone na área de trabalho."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecStartup} "Abre o Starsonic Phone, minimizado, quando você entra no Windows."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Function .onInstSuccess
  ${If} ${Silent}
    Call ReopenApp
  ${EndIf}
FunctionEnd

Function .onInstFailed
  ; Atualizacao que deu errado: o app volta a abrir na versao que ficou.
  ${If} ${Silent}
    Call ReopenApp
  ${EndIf}
FunctionEnd

Section "Uninstall"
  Call un.CloseApp
  ${If} $Closed <> 1
    MessageBox MB_ICONSTOP "Feche o Starsonic Phone e tente de novo." /SD IDOK
    Abort
  ${EndIf}
  !insertmacro StarsonicUninstallFiles
  Delete "$INSTDIR\instalador.log"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  DeleteRegKey HKCU "${REG_APP}"
  DeleteRegValue HKCU "${REG_RUN}" "${APP_NAME}"
  ; Por ultimo: o fim da desinstalacao e visto pela saida desta chave (Test-Installer.ps1).
  DeleteRegKey HKCU "${REG_UNINSTALL}"
  ; As configuracoes (%APPDATA%\Starsonic Phone) ficam, como no MicroSIP.
SectionEnd
