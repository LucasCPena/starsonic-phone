#pragma once
// As regras do chat no executavel (0.2.0; spec do chat, 6.4; docs/ponte-windows.md, "O chat (0.2.0)"): o numero no
// icone da barra de tarefas (TaskbarBadge), o corte do titulo e do texto do aviso do Windows (Tray), o nome do arquivo
// baixado e o Zone.Identifier dele (ChatSave) e o endereco do servidor do chat (ChatDownloader). C++ portatil, em
// UTF-8 e sem o windows.h: testado tambem no Linux (tests/desktop/test_chat_files.cpp).
#include <cstddef>
#include <functional>
#include <string>

namespace starsonic {

// O servidor do chat: o download dos arquivos (/api/v1/arquivos/<id>) e o HostUrl do Zone.Identifier.
constexpr char kChatOrigin[] = "https://chat.starcloud-starsonic.com.br:8443";
// O maior arquivo do chat (25 MB, o limite do servidor: docs/chat-protocolo.md, secao 6): o limite do download.
constexpr size_t kChatMaxFileBytes = 26214400;

// O texto do numero no icone: n <= 0: "" (sem numero); de 1 a 9: "1" a "9"; 10 ou mais: "9+".
std::string BadgeText(int n);
// O que o leitor de tela diz do numero: "1 mensagem nao lida", "<n> mensagens nao lidas" (com o til); n <= 0: "".
std::string BadgeDescription(int n);

// O nome para gravar o arquivo na pasta Downloads. O nome vem de outra pessoa do chat: nunca confiavel. Na ordem:
// - saem as sequencias que nao sao UTF-8 e os caracteres de controle (U+0000 a U+001F, o U+007F e U+0080 a U+009F),
//   tambem o NUL, antes de qualquer conversao para o UTF-16: o "nota.exe<NUL>.pdf" vira "nota.exe.pdf", e nunca o
//   "nota.exe" cortado no NUL;
// - saem os controles da direcao do texto (U+061C, U+200E, U+200F, U+202A a U+202E e U+2066 a U+2069: o
//   "Proposta<U+202E>fdp.exe" aparece como "Propostaexe.pdf");
// - fica so a parte depois da ultima "/" ou "\" (nunca fora da pasta);
// - saem os caracteres que o Windows nao aceita num nome (: * ? " < > |; o ":" abriria um fluxo do arquivo);
// - saem os pontos e os espacos das pontas (o Windows tira os do fim);
// - fica com ate 120 pontos de codigo, mantendo a extensao (a do ultimo ponto), como o servidor do chat;
// - vazio, vira "arquivo";
// - um nome reservado do Windows (CON, PRN, AUX, NUL, CONIN$, CONOUT$, COM0 a COM9 e LPT0 a LPT9, tambem com o 1, o 2 e
//   o 3 sobrescritos; o de antes do primeiro ponto, sem os espacos do fim e sem caixa) ganha um "_" na frente.
// O resultado e UTF-8 valido, sem NUL.
std::string SafeDownloadName(const std::string& nome);

// O nome, se ele ainda nao existe na pasta; senao, o primeiro livre de "<nome> (2)<extensao>" a "<nome>
// (1000)<extensao>" (a extensao: a do ultimo ponto, menos o do comeco). Depois do (1000), nenhum: "". exists diz se o
// nome ja existe na pasta.
std::string FreeName(const std::string& nome, const std::function<bool(const std::string&)>& exists);

// O texto do fluxo <arquivo>:Zone.Identifier (o "Mark of the Web"): a zona 3 (a internet), com o endereco do chat. O
// Windows avisa antes de abrir um programa que veio assim.
std::string ZoneIdentifier();

// O texto do aviso do Windows com no maximo maxUtf16Units unidades do UTF-16 (o NOTIFYICONDATA: 63 no titulo e 255 no
// texto, sem o fim do texto). Cabe: fica como veio. Nao cabe: cortado num ponto de codigo inteiro (um emoji, o par
// substituto do UTF-16, nunca pela metade) e terminado em U+2026, com o limite ja contando ele. UTF-8 em volta (uma
// sequencia que nao e UTF-8 conta como o U+FFFD, como no Utf8ToWide).
std::string FitNoticeText(const std::string& utf8, size_t maxUtf16Units);

}  // namespace starsonic
