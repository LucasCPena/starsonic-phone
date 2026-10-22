#pragma once
// A loja dos atalhos do app de PC (spec 3 da rc.3): ate 8 atalhos, por computador, os mesmos para todas as contas.
// C++ portatil: nada de Windows aqui.
//
// Formato (atalhos.json, JSON UTF-8 gravado de forma atomica): {"versao":1,"atalhos":[{"id","nome","numero",
// "acao":"ligar"|"transferir"|"consulta"|"teclas","blf":true|false}]}
//
// Carregar (Load): arquivo que nao existe vale como lista vazia (true); arquivo ilegivel, que nao e JSON ou de outra
// versao vale como vazio e Load devolve false; o arquivo nao e tocado ate o proximo Save. Uma entrada que a validacao
// do Save recusaria fica de fora, e passam so os 8 primeiros.
//
// Sem trava: a loja e usada so pela thread de comandos da DesktopApp (All() devolve uma referencia).
#include <string>
#include <vector>

#include "Files.h"

namespace starsonic {

struct Atalho {
    enum Acao { Ligar, Transferir, Consulta, Teclas };

    std::string id;       // vazio no Save = atalho novo (a loja gera o id)
    std::string nome;     // UTF-8, de 1 a 24 caracteres
    std::string numero;   // digitos, * # e +, de 1 a 32 caracteres
    Acao acao = Ligar;
    bool blf = false;
};

class AtalhosStore {
public:
    static constexpr size_t kMax = 8;
    static constexpr size_t kMaxNameChars = 24;
    static constexpr size_t kMaxNumberChars = 32;

    AtalhosStore(FileSystem& files, std::string path);

    bool Load();
    const std::vector<Atalho>& All() const { return atalhos_; }   // na ordem em que foram incluidos

    // Inclui (id vazio) ou substitui (pelo id). Devolve o id do atalho gravado; vazio se recusou, e entao *error (se
    // nao for nulo) diz por que, em portugues. Recusa o 9o atalho, nome ou numero invalidos, uma acao desconhecida e
    // um id que nao existe. O nome e o numero ficam sem os espacos das pontas. Nada muda se o disco falha.
    std::string Save(Atalho atalho, std::string* error);
    bool Remove(const std::string& id);   // false se nao existe ou o disco falhou: nada muda

private:
    bool Write(const std::vector<Atalho>& atalhos) const;

    FileSystem& files_;
    std::string path_;
    std::vector<Atalho> atalhos_;
};

}  // namespace starsonic
