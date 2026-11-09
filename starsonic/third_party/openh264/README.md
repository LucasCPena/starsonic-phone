# OpenH264 2.6.0: só a API

Os quatro cabeçalhos de `include/wels/` (`codec_api.h`, `codec_app_def.h`, `codec_def.h` e `codec_ver.h`) vieram sem mudança de `codec/api/wels/` da tag `v2.6.0` de [cisco/openh264](https://github.com/cisco/openh264) (commit `652bdb7719f30b52b08e506645a7322ff1b2cc6f`). O `LICENSE` (a licença BSD de 2 cláusulas do OpenH264) é o da mesma tag.

Só a API entra no repositório: nenhum código do codec é compilado aqui, e o binário da Cisco nunca vai dentro do app.

Quem usa os cabeçalhos, só no Windows:

- a PJSIP (`pjmedia/src/pjmedia-codec/openh264.cpp`), pelo `/I` que o `build/Build-Deps.ps1` põe no `CL`;
- o adaptador do app (`windows/app/src/OpenH264Shim.cpp`). Ele define as quatro funções que a PJSIP chama e as repassa ao módulo da Cisco (`openh264-2.6.0-win32.dll`), baixado à parte no computador da pessoa e carregado pelo caminho completo (spec da videochamada, seção 6.3).

A versão é a do `build/deps.lock` (`openh264.version`). Para trocar de versão, troque juntos os quatro cabeçalhos, o `LICENSE` e a versão do `deps.lock`. O `tests/python/test_deps_lock.py` confere que o `codec_ver.h` é da versão do `deps.lock`.

Os testes do motor no Linux não usam estes cabeçalhos: lá a PJSIP compila com o OpenH264 do sistema (`libopenh264-dev`), que é só dos testes e nunca é publicado.
