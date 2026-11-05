#pragma once
// O chat do app de PC (0.2.0; docs/ponte-windows.md, "O chat (0.2.0)"): a chave do computador no chat, a empresa dela e
// os ramais que ja se conectaram a central neste computador. C++ portatil: nada de Windows aqui.
//
// chat.json: o JSON {"v":1,"chave":"...","empresa":"...","ramais":["servidor|ramal"]} passa inteiro pelo
// SecretCipher::Protect (no Windows, o DPAPI do usuario), como o admin.json, e o texto resultante e o conteudo do
// arquivo: quem o abre num editor de texto nao ve a chave. Fora do chat, o arquivo vai sem a chave e a empresa.
//
// Carregar (Load): sem arquivo (ou sem o caminho: o executavel que ainda nao o da), vazio e true; arquivo que nao
// decifra, que nao e JSON ou e de outra versao: vazio e false, e o arquivo nao e tocado ate a proxima gravacao. A chave
// e a empresa passam pela conferencia do SetLink (vale o par, ou nenhum dos dois), e um ramal que nao e texto fica de
// fora.
//
// Gravar (SetLink, ClearLink e AddRamal): o arquivo inteiro de uma vez. Sem o caminho, nada e gravado (false).
//
// Sem trava: a loja e usada so pela thread de comandos da DesktopApp (Link() devolve uma referencia).
#include <optional>
#include <string>
#include <vector>

#include "Cipher.h"
#include "Files.h"

namespace starsonic {

// A chave do computador no chat (o Authorization: Bearer do servidor) e o nome da empresa dela, em UTF-8.
struct ChatLink {
    std::string chave;
    std::string empresa;
};

// A chave: 43 caracteres de [A-Za-z0-9_-].
bool ValidChatKey(const std::string& chave);
// A empresa: de 1 a 80 pontos de codigo, em UTF-8 valido e sem caractere de controle (U+0000 a U+001F e U+007F a
// U+009F).
bool ValidChatCompany(const std::string& empresa);
// O id de um arquivo do chat: 32 caracteres de [0-9a-f] (sem as maiusculas).
bool ValidFileId(const std::string& id);

// O par de um ramal conectado ("servidor|ramal"): o servidor sem os espacos das pontas e em minusculas, "|", e o ramal
// sem os espacos das pontas. O servidor nao tem "|" (a regra da tela Entrar), entao dois pares diferentes nunca dao o
// mesmo texto.
class ChatStore {
public:
    ChatStore(FileSystem& files, SecretCipher& cipher, std::string path);

    bool Load();
    // A chave e a empresa guardadas; nada com o computador fora do chat.
    const std::optional<ChatLink>& Link() const { return link_; }
    // O par ja se conectou a central neste computador.
    bool HasRamal(const std::string& servidor, const std::string& ramal) const;
    // Grava a chave e a empresa, no lugar das de antes. false, e nada muda: uma das duas fora da regra (ValidChatKey,
    // ValidChatCompany), ou o cifrador ou o disco falhou.
    bool SetLink(const ChatLink& link);
    // Grava sem a chave e a empresa; os ramais ficam. false, e nada muda: o cifrador ou o disco falhou.
    bool ClearLink();
    // O par entra nos conectados, e grava so quando ele e novo (o mesmo par de novo: true, sem gravar). false: o
    // servidor ou o ramal vazio (o par nao entra), ou o cifrador ou o disco falhou; nesse caso o par fica nesta abertura
    // (ele se conectou, como a ligacao do RecentsStore::Add), e a proxima gravacao o leva.
    bool AddRamal(const std::string& servidor, const std::string& ramal);

private:
    bool Save(const std::optional<ChatLink>& link, const std::vector<std::string>& ramais);

    FileSystem& files_;
    SecretCipher& cipher_;
    std::string path_;
    std::optional<ChatLink> link_;
    std::vector<std::string> ramais_;   // os pares, na ordem em que entraram
};

}  // namespace starsonic
