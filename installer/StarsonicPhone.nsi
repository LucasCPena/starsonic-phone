; Instalador do Starsonic Phone, o app novo (spec da W1: WebView2 e a interface de windows\ui), em NSIS 3 (Unicode).
; Gerado por build\Build-Installer.ps1, que define VERSION (X.Y.Z ou X.Y.Z-rc.N), VERSION_QUAD (X.Y.Z.N), APP_ICON,
; FILES_NSH (macros com os arquivos: o exe e a pasta ui\), OUTFILE, SIDE_BMP (164x314, a lateral das paginas de
; boas-vindas e de fim), HEADER_BMP (150x57, o cabecalho das outras) e WEBVIEW2_SETUP (o bootstrapper Evergreen do
; WebView2, MicrosoftEdgeWebview2Setup.exe, com o SHA-256 do build\deps.lock conferido).
;
; Por usuario, em %LOCALAPPDATA%\Starsonic Phone (a mesma pasta, as mesmas chaves e o mesmo exe da rc.7). Em /S (a
; atualizacao pelo app, tambem a da rc.7): instala o WebView2 se faltar, fecha o app, troca os arquivos sem mexer nos
; atalhos nem no "Iniciar com o Windows" e reabre o app; se der errado, reabre a versao que ficou e registra o motivo
; em instalador.log, na pasta do app.

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
!insertmacro RequireDefine SIDE_BMP
!insertmacro RequireDefine HEADER_BMP
!insertmacro RequireDefine WEBVIEW2_SETUP

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"
!include "${FILES_NSH}"

!define APP_NAME "Starsonic Phone"
!define APP_EXE "StarsonicPhone.exe"
!define APP_CLASS "Starsonic Phone"
!define REG_APP "Software\Starsonic Phone"
!define REG_RUN "Software\Microsoft\Windows\CurrentVersion\Run"
!define REG_APPROVED "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
!define REG_UNINSTALL "Software\Microsoft\Windows\CurrentVersion\Uninstall\StarsonicPhone"
!define REG_CLASSES "Software\Classes"
!define LINK_PROGID "StarsonicPhone.Link"
; O comando dos links: tudo depois do --link e o link (um lancador que nao escapa as aspas nunca injeta opcoes); o
; antigo, das instalacoes de antes, e trocado pelo novo na atualizacao (e tambem e do app na desinstalacao).
!define LINK_COMMAND '"$INSTDIR\${APP_EXE}" --link "%1"'
!define OLD_LINK_COMMAND '"$INSTDIR\${APP_EXE}" "%1"'
; O WebView2 Runtime (Evergreen): instalado quando a chave do cliente dele tem um "pv" (a versao) que nao e vazio
; nem 0.0.0.0 (documentacao da Microsoft, "Detect if a WebView2 Runtime is already installed").
!define WEBVIEW2_CLIENT "Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
; A pasta de dados do WebView2 do app (windows\app: %LOCALAPPDATA%\Starsonic Phone\WebView2, sempre ali).
!define WEBVIEW2_DATA "$LOCALAPPDATA\Starsonic Phone\WebView2"

Name "${APP_NAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Starsonic Phone"
InstallDirRegKey HKCU "${REG_APP}" ""
BrandingText "Starsonic"
ShowInstDetails hide
ShowUninstDetails hide
SetFont "Segoe UI" 9

; As cores do design system (windows\ui): o texto em ink e o fundo branco das paginas.
!define MUI_TEXTCOLOR "0A0E1A"
!define MUI_BGCOLOR "FFFFFF"
!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEFINISHPAGE_BITMAP "${SIDE_BMP}"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${SIDE_BMP}"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "${HEADER_BMP}"
!define MUI_HEADERIMAGE_UNBITMAP "${HEADER_BMP}"

Var Attempts
Var Closed
Var Upgrade         ; 1 quando ja existe um Starsonic Phone na pasta (a rc.7 ou o app novo)
Var WantDesktop     ; a escolha "Atalho na area de trabalho" (1 = marcada)
Var WantStartup     ; a escolha "Iniciar com o Windows" (1 = marcada)
Var WelcomeText
Var CheckDesktop
Var CheckStartup
Var WebView2Version

; A pagina do canvas "Instalador": a lateral com o logo e a frase, o titulo, o aviso de fechar o app, as duas
; opcoes e o Instalar (o progresso, inclusive o do WebView2, vem na pagina seguinte).
!define MUI_WELCOMEPAGE_TITLE "Instalar o Starsonic Phone"
!define MUI_WELCOMEPAGE_TEXT " "
!define MUI_PAGE_CUSTOMFUNCTION_SHOW WelcomeShow
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE WelcomeLeave
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "O Starsonic Phone está instalado"
!define MUI_FINISHPAGE_TEXT "O Starsonic Phone foi instalado neste computador."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o Starsonic Phone"
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

Function .onInit
  ; As opcoes comecam marcadas numa instalacao nova. Por cima de uma instalacao (a rc.7 ou o app novo), comecam
  ; como estao: o atalho que existe e o valor do Run (um valor presente = marcada; a rc.7 gravava /minimized).
  StrCpy $Upgrade 0
  StrCpy $WantDesktop 1
  StrCpy $WantStartup 1
  ${If} ${FileExists} "$INSTDIR\${APP_EXE}"
    StrCpy $Upgrade 1
    StrCpy $WantDesktop 0
    ${If} ${FileExists} "$DESKTOP\${APP_NAME}.lnk"
      StrCpy $WantDesktop 1
    ${EndIf}
    StrCpy $WantStartup 0
    ClearErrors
    ReadRegStr $0 HKCU "${REG_RUN}" "${APP_NAME}"
    ${IfNot} ${Errors}
      StrCpy $WantStartup 1
    ${EndIf}
  ${EndIf}
FunctionEnd

Function WelcomeShow
  ; O texto do MUI2 (vazio) da lugar ao do canvas, mais curto, e as duas opcoes embaixo dele.
  ShowWindow $mui.WelcomePage.Text ${SW_HIDE}
  SetCtlColors $mui.WelcomePage.Title "0C2671" "${MUI_BGCOLOR}"
  ${NSD_CreateLabel} 120u 42u 185u 34u "Feche o Starsonic Phone, se ele estiver aberto. As suas contas e os seus contatos continuam no computador."
  Pop $WelcomeText
  SetCtlColors $WelcomeText "5B6478" "${MUI_BGCOLOR}"
  ${NSD_CreateCheckbox} 120u 86u 185u 12u "Atalho na área de trabalho"
  Pop $CheckDesktop
  SetCtlColors $CheckDesktop "0C2671" "${MUI_BGCOLOR}"
  ${NSD_CreateCheckbox} 120u 102u 185u 12u "Iniciar com o Windows"
  Pop $CheckStartup
  SetCtlColors $CheckStartup "0C2671" "${MUI_BGCOLOR}"
  ${If} $WantDesktop = 1
    ${NSD_Check} $CheckDesktop
  ${EndIf}
  ${If} $WantStartup = 1
    ${NSD_Check} $CheckStartup
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Instalar"
FunctionEnd

Function WelcomeLeave
  ${NSD_GetState} $CheckDesktop $0
  StrCpy $WantDesktop 0
  ${If} $0 = ${BST_CHECKED}
    StrCpy $WantDesktop 1
  ${EndIf}
  ${NSD_GetState} $CheckStartup $0
  StrCpy $WantStartup 0
  ${If} $0 = ${BST_CHECKED}
    StrCpy $WantStartup 1
  ${EndIf}
FunctionEnd

; Fecha o app, se estiver aberto, e espera ate 30 s a janela sumir e o exe ficar livre (o processo ainda roda um
; pouco depois de fechar a janela). O app novo fecha com --sair; a rc.7 (o app antigo, sem a pasta ui\), com /exit.
; $Closed = 1 quando deu certo.
!macro CloseAppBody
  FindWindow $0 "${APP_CLASS}"
  ${If} $0 <> 0
  ${AndIf} ${FileExists} "$INSTDIR\${APP_EXE}"
    ${If} ${FileExists} "$INSTDIR\ui\index.html"
      ExecWait '"$INSTDIR\${APP_EXE}" --sair'
    ${Else}
      ExecWait '"$INSTDIR\${APP_EXE}" /exit'
    ${EndIf}
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

; $WebView2Version = a versao do WebView2 Runtime instalada, ou "" (por maquina, na visao de 32 bits do Windows de
; 64 bits ou no Windows de 32 bits; ou por usuario).
Function FindWebView2
  StrCpy $WebView2Version ""
  ClearErrors
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\${WEBVIEW2_CLIENT}" "pv"
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    ReadRegStr $0 HKCU "Software\${WEBVIEW2_CLIENT}" "pv"
  ${EndIf}
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    ReadRegStr $0 HKLM "SOFTWARE\${WEBVIEW2_CLIENT}" "pv"
  ${EndIf}
  ${If} $0 != ""
  ${AndIf} $0 != "0.0.0.0"
    StrCpy $WebView2Version $0
  ${EndIf}
FunctionEnd

; Reabre o app depois da instalacao silenciosa (atualizacao), se ele nao estiver aberto.
Function ReopenApp
  FindWindow $0 "${APP_CLASS}"
  ${If} $0 = 0
  ${AndIf} ${FileExists} "$INSTDIR\${APP_EXE}"
    SetOutPath "$INSTDIR"
    Exec '"$INSTDIR\${APP_EXE}"'
  ${EndIf}
FunctionEnd

; Um link tel:, sip: ou callto: abre o app com o numero no Teclado. O app aparece em Programas padrao (pelas
; Capabilities); a chave do esquema em HKCU\Software\Classes so e gravada quando nenhum outro programa tem o link,
; nem por usuario (HKCU) nem para a maquina (HKLM: a do HKCU passaria na frente dela), ou quando ja e a do app (com o
; comando novo ou o antigo, que vira o novo).
!macro RegisterLink SCHEME
  WriteRegStr HKCU "${REG_APP}\Capabilities\URLAssociations" "${SCHEME}" "${LINK_PROGID}"
  ReadRegStr $0 HKCU "${REG_CLASSES}\${SCHEME}\shell\open\command" ""
  ReadRegStr $1 HKLM "Software\Classes\${SCHEME}\shell\open\command" ""
  ${If} $1 == '${LINK_COMMAND}'
  ${OrIf} $1 == '${OLD_LINK_COMMAND}'
    StrCpy $1 ""
  ${EndIf}
  ${If} $1 == ""
  ${AndIf} $0 == ""
  ${OrIf} $0 == '${LINK_COMMAND}'
  ${OrIf} $0 == '${OLD_LINK_COMMAND}'
    WriteRegStr HKCU "${REG_CLASSES}\${SCHEME}" "" "URL:${SCHEME}"
    WriteRegStr HKCU "${REG_CLASSES}\${SCHEME}" "URL Protocol" ""
    WriteRegStr HKCU "${REG_CLASSES}\${SCHEME}\DefaultIcon" "" '"$INSTDIR\${APP_EXE}",0'
    WriteRegStr HKCU "${REG_CLASSES}\${SCHEME}\shell\open\command" "" '${LINK_COMMAND}'
  ${EndIf}
!macroend

!macro UnregisterLink SCHEME
  ReadRegStr $0 HKCU "${REG_CLASSES}\${SCHEME}\shell\open\command" ""
  ${If} $0 == '${LINK_COMMAND}'
  ${OrIf} $0 == '${OLD_LINK_COMMAND}'
    DeleteRegKey HKCU "${REG_CLASSES}\${SCHEME}"
  ${EndIf}
!macroend

; Os logs que a rc.7 deixava na pasta do app: o do PJSIP (pode ter tracos SIP) e os de travamento.
!macro DeleteRc7Logs
  Delete "$INSTDIR\StarsonicPhone_log.txt"
  Delete "$INSTDIR\crash-dump_*.*"
!macroend

Section "-Starsonic Phone" SecMain
  ; 1. O WebView2, antes de fechar o app: sem ele (e sem internet para o bootstrapper), nada muda.
  Call FindWebView2
  ${If} $WebView2Version == ""
    DetailPrint "Instalando o WebView2 da Microsoft…"
    InitPluginsDir
    File "/oname=$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe" "${WEBVIEW2_SETUP}"
    ClearErrors
    ExecWait '"$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe" /silent /install' $1
    ${If} ${Errors}
      StrCpy $1 "nao abriu"
    ${EndIf}
    Delete "$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe"
    Call FindWebView2
    ${If} $WebView2Version == ""
      !insertmacro FailInstall "WebView2 ausente (bootstrapper: $1)" "O Starsonic Phone precisa do WebView2 da Microsoft. Conecte-se à internet e tente de novo."
    ${EndIf}
    Push "WebView2 $WebView2Version instalado (bootstrapper: $1)"
    Call WriteLog
  ${EndIf}

  ; 2. O app aberto fecha (a rc.7 tambem).
  DetailPrint "Instalando o Starsonic Phone…"
  Call CloseApp
  ${If} $Closed <> 1
    !insertmacro FailInstall "o app continua aberto" "Feche o Starsonic Phone e tente de novo."
  ${EndIf}

  ; 3. Os arquivos: o exe e a pasta ui\ (vazia antes, se e do app: um arquivo que a versao nova nao tem nao fica para
  ; tras; numa pasta escolhida sem o app, uma ui\ de outra coisa fica como esta).
  ${If} ${FileExists} "$INSTDIR\${APP_EXE}"
  ${OrIf} ${FileExists} "$INSTDIR\ui\index.html"
    RMDir /r "$INSTDIR\ui"
  ${EndIf}
  SetOutPath "$INSTDIR"
  SetOverwrite on
  ClearErrors
  !insertmacro StarsonicInstallFiles
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  ${If} ${Errors}
    !insertmacro FailInstall "falha ao copiar os arquivos" "Não foi possível copiar os arquivos do Starsonic Phone."
  ${EndIf}

  ; 4. O que sobra da rc.7 e o app novo nao sobrescreve: os sons, a traducao e os logs do app antigo.
  Delete "$INSTDIR\*.wav"
  Delete "$INSTDIR\langpack_*.txt"
  !insertmacro DeleteRc7Logs

  ; A pasta da instalacao (a rc.7 tambem a lia daqui).
  WriteRegStr HKCU "${REG_APP}" "" "$INSTDIR"

  ; Atalho do menu Iniciar; na atualizacao silenciosa, o que existir fica como esta.
  ${IfNot} ${Silent}
  ${OrIfNot} ${FileExists} "$SMPROGRAMS\${APP_NAME}.lnk"
    CreateShortCut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  ${EndIf}

  ; As duas opcoes da primeira pagina (fora do modo silencioso; a atualizacao nao mexe nelas). O "Iniciar com o
  ; Windows" e so o valor do Run, como o app grava (ele le o registro ao abrir). O desligado do Gerenciador de
  ; Tarefas (StartupApproved\Run) fica como a pessoa deixou: so a chave do proprio app o muda.
  ${IfNot} ${Silent}
    ${If} $WantDesktop = 1
      CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
    ${Else}
      Delete "$DESKTOP\${APP_NAME}.lnk"
    ${EndIf}
    ${If} $WantStartup = 1
      WriteRegStr HKCU "${REG_RUN}" "${APP_NAME}" '"$INSTDIR\${APP_EXE}" --bandeja'
    ${Else}
      DeleteRegValue HKCU "${REG_RUN}" "${APP_NAME}"
    ${EndIf}
  ${EndIf}

  ; Os links tel:, sip: e callto:.
  WriteRegStr HKCU "${REG_CLASSES}\${LINK_PROGID}" "" "Starsonic Phone"
  WriteRegStr HKCU "${REG_CLASSES}\${LINK_PROGID}" "URL Protocol" ""
  WriteRegStr HKCU "${REG_CLASSES}\${LINK_PROGID}\DefaultIcon" "" '"$INSTDIR\${APP_EXE}",0'
  WriteRegStr HKCU "${REG_CLASSES}\${LINK_PROGID}\shell\open\command" "" '${LINK_COMMAND}'
  WriteRegStr HKCU "${REG_APP}\Capabilities" "ApplicationName" "${APP_NAME}"
  WriteRegStr HKCU "${REG_APP}\Capabilities" "ApplicationDescription" "Ligações pelo seu ramal"
  WriteRegStr HKCU "${REG_APP}\Capabilities" "ApplicationIcon" '"$INSTDIR\${APP_EXE}",0'
  !insertmacro RegisterLink "tel"
  !insertmacro RegisterLink "sip"
  !insertmacro RegisterLink "callto"
  WriteRegStr HKCU "Software\RegisteredApplications" "${APP_NAME}" "${REG_APP}\Capabilities"

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
  ${If} $Upgrade = 1
    Push "instalado por cima da versao anterior"
  ${Else}
    Push "instalado"
  ${EndIf}
  Call WriteLog
SectionEnd

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
  !insertmacro DeleteRc7Logs
  Delete "$INSTDIR\instalador.log"
  Delete "$INSTDIR\Uninstall.exe"
  ; A pasta de dados do WebView2: os processos do WebView2 saem logo depois do app; ate la, os arquivos ficam presos.
  StrCpy $Attempts 0
  ${Do}
    RMDir /r "${WEBVIEW2_DATA}"
    ${IfNot} ${FileExists} "${WEBVIEW2_DATA}\*.*"
      ${Break}
    ${EndIf}
    IntOp $Attempts $Attempts + 1
    ${If} $Attempts > 40
      ${Break}
    ${EndIf}
    Sleep 500
  ${Loop}
  RMDir "$INSTDIR"
  RMDir "$LOCALAPPDATA\Starsonic Phone"
  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  !insertmacro UnregisterLink "tel"
  !insertmacro UnregisterLink "sip"
  !insertmacro UnregisterLink "callto"
  DeleteRegKey HKCU "${REG_CLASSES}\${LINK_PROGID}"
  DeleteRegValue HKCU "Software\RegisteredApplications" "${APP_NAME}"
  DeleteRegKey HKCU "${REG_APP}"
  DeleteRegValue HKCU "${REG_RUN}" "${APP_NAME}"
  DeleteRegValue HKCU "${REG_APPROVED}" "${APP_NAME}"
  ; Por ultimo: o fim da desinstalacao e visto pela saida desta chave (Test-Installer.ps1).
  DeleteRegKey HKCU "${REG_UNINSTALL}"
  ; As contas, os contatos e os recentes (%APPDATA%\Starsonic Phone) ficam.
SectionEnd
