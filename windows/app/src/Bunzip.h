#pragma once
// Descompacta um buffer bzip2 (libbz2): o modulo H.264 da Cisco vem em .bz2. Portatil: o app usa a porta bzip2 do vcpkg
// e os testes do desktop, o BZip2 do sistema.
#include <cstddef>
#include <optional>
#include <string>

// O conteudo descompactado, ou nullopt: entrada vazia, lixo, cortada, com bytes depois do fim do fluxo, ou saida
// maior que maxOut (a saida nunca passa de maxOut: uma bomba de descompressao para no limite).
std::optional<std::string> Bunzip2(const std::string& compressed, size_t maxOut);
