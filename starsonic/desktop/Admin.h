#pragma once
// A area do administrador do app de PC (spec 6 da rc.3): a configuracao protegida, a senha e o codigo de puxar.
// C++ portatil: nada de Windows aqui.
//
// admin.json: o JSON {"versao":1,"mostrar_nao_perturbe","mostrar_atender_automatico","blf","puxar","codigo_puxar",
// "servidores":[{"endereco","porta"}],"canal"} passa inteiro pelo SecretCipher::Protect (no Windows, o DPAPI do
// usuario) e o texto resultante e o conteudo do arquivo. Quem troca o arquivo num editor de texto nao o abre.
//
// Carregar (Load): sem arquivo, os padroes (true); arquivo que nao decifra, que nao e JSON ou e de outra versao: os
// padroes e false; o arquivo nao e tocado ate o proximo Save. Os padroes: os dois botoes aparecem, BLF e puxar
// desligados, codigo vazio, os servidores do perfil.ini embutido e o canal de fabrica ("").
//
// Sem trava: a loja e usada so pela thread de comandos da DesktopApp (Get() devolve uma referencia).
#include <cstdint>
#include <string>
#include <vector>

#include "Cipher.h"
#include "Files.h"
#include "Profile.h"

namespace starsonic {

struct AdminConfig {
    bool mostrarNaoPerturbe = true;
    bool mostrarAtenderAuto = true;
    bool blf = false;
    bool puxar = false;
    std::string codigoPuxar;               // com {ramal}: PickupNumber troca pelo numero do atalho
    std::vector<ServerPort> servidores;    // os padroes vem do perfil
    std::string canal;                     // "" = o canal do build
};

class AdminStore {
public:
    AdminStore(FileSystem& files, SecretCipher& cipher, std::string path, const Profile& profile);

    bool Load();
    const AdminConfig& Get() const { return config_; }
    // Grava. O codigo de puxar fica sem os espacos das pontas; servidores sem endereco ou com a porta fora de 1 a 65535
    // ficam de fora. false se o cifrador ou o disco falhou: nada muda.
    bool Save(const AdminConfig& config);

private:
    AdminConfig Defaults() const;

    FileSystem& files_;
    SecretCipher& cipher_;
    std::string path_;
    std::vector<ServerPort> profileServers_;
    AdminConfig config_;
};

// A senha digitada confere com o resumo PBKDF2-HMAC-SHA256 embutido? Comparacao em tempo constante.
bool CheckAdminPassword(const std::string& typed);

// O sal, a chave e as iteracoes embutidos (para o teste conferir o formato; a senha em si nao esta em lugar nenhum).
struct AdminHashParams {
    uint32_t iterations = 0;
    std::vector<uint8_t> salt;
    std::vector<uint8_t> key;
};
AdminHashParams EmbeddedAdminHash();

// O numero que puxa a ligacao: o codigo com cada {ramal} trocado pelo ramal. "*8" fica "*8"; "" fica "".
std::string PickupNumber(const std::string& code, const std::string& ramal);

}  // namespace starsonic
