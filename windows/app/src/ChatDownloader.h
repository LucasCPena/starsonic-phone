#pragma once
// O download de um arquivo do chat no executavel (0.2.0; spec do chat, 6.4): o gancho chatDownload do DesktopApp.
// - O arquivo vem do servidor do chat (kChatOrigin + "/api/v1/arquivos/<id>", ChatFiles.h) pelo HttpsGetBearer
//   (Http.h): com a chave do computador no Authorization, sem seguir redirecionamento, ate kChatMaxFileBytes e com o
//   user agent do atualizador. Um id fora da regra (ValidFileId, Chat.h) nem sai.
// - O 200 vai para a pasta Downloads (SHGetKnownFolderPath(FOLDERID_Downloads)) pelo SaveChatFile (o nome limpo, o
//   "(2)" e o Zone.Identifier: ChatSave.h) e abre com o programa padrao (ShellExecuteW "open": o Windows avisa antes de
//   abrir um programa que veio da internet). O done leva "".
// - O 410 (o arquivo passou de 365 dias) leva o toast "Arquivo expirado"; qualquer outra coisa (a rede, outro status, o
//   disco) leva "Nao foi possivel baixar o arquivo." (com os acentos, em UTF-8: docs/ponte-windows.md, "Os toasts do
//   chat").
// O diagnostico leva so "chat: download <status> <bytes>": nunca a chave, o id nem o nome do arquivo.
//
// Threads: como o CompanyFetcher, uma thread propria (com o COM dela, para o ShellExecuteW) baixa os pedidos, um por
// vez, na ordem; Download so poe na fila e volta (a thread de comandos do DesktopApp nunca espera a rede nem o disco).
// Cada pedido recebe uma resposta, uma vez (o done, na thread que baixa), ate o Stop. O Stop nao espera o download de
// agora (ate 25 MB numa rede lenta segurariam o Sair): marca a parada, descarta os pedidos na fila e volta; o download
// de agora termina sozinho e nao responde, e, se a parada chegou antes de ele gravar, nem grava nem abre. A thread
// confere a parada com a trava do Stop presa, e o done e o diagnostico rodam com ela: depois de o Stop voltar, nenhum
// done e nenhuma linha. A thread guarda o que precisa: o ChatDownloader pode sair antes dela.
#include <functional>
#include <memory>
#include <string>

namespace starsonic {

class ChatDownloader {
public:
    // userAgent: o do atualizador ("Starsonic Phone/<versao>"). log: uma linha do diagnostico (de qualquer thread).
    ChatDownloader(std::wstring userAgent, std::function<void(const std::string&)> log);
    ~ChatDownloader();   // Stop()

    ChatDownloader(const ChatDownloader&) = delete;
    ChatDownloader& operator=(const ChatDownloader&) = delete;

    // Baixa o arquivo (o id), grava com o nome (o do chat, limpo pelo SaveChatFile) e abre, com a chave; o done leva o
    // toast ("" quando deu certo). Depois do Stop: descartado (sem resposta). De qualquer thread; nunca espera.
    void Download(std::string arquivo, std::string nome, std::string chave,
                  std::function<void(const std::string& toast)> done);
    // Ver acima. De qualquer thread; de novo, nada.
    void Stop();

private:
    struct Shared;   // o estado dividido com a thread (ChatDownloader.cpp)
    static void Work(std::shared_ptr<Shared> shared);

    std::shared_ptr<Shared> shared_;
};

}  // namespace starsonic
