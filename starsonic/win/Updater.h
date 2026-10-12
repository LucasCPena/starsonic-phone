#pragma once
// Atualizador (spec 7.3): versao.json e instalador dos releases do GitHub, por HTTPS com
// validacao de certificado (Http.h) e SHA-256 conferido (Sha256.h). Os pontos de entrada
// chamados pelo MicroSIP (CheckUpdates e OnUpdateMessage, edicao E12) estao em Hooks.h.
#include <windows.h>

#include <string>

// versao.json do canal da build (STARSONIC_UPDATE_CHANNEL_TEST): o ultimo release que nao e
// pre-release, ou o pre-release fixo canal-teste.
std::wstring ManifestUrl();

// Unico prefixo aceito para o instalador indicado no versao.json.
std::string InstallerUrlPrefix();

// Timer de 24 h da janela principal (IDT_STARSONIC_UPDATES), ligado no OnMainWindowCreated.
void CALLBACK UpdateTimerProc(HWND window, UINT message, UINT_PTR id, DWORD tickCount);
