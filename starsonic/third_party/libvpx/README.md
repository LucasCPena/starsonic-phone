# libvpx 1.16.0: só os textos da licença

O `LICENSE` (a licença BSD de 3 cláusulas do WebM Project) e o `PATENTS` (a concessão de direitos de patente) vieram sem mudança da tag `v1.16.0` de [webmproject/libvpx](https://github.com/webmproject/libvpx) (`https://raw.githubusercontent.com/webmproject/libvpx/v1.16.0/LICENSE` e `.../PATENTS`).

Nenhum código da libvpx entra no repositório. Quem a usa é o motor do Windows: o VP8 e o VP9 da PJSIP, compilada com a libvpx da porta `libvpx` do vcpkg (a versão `1.16.0` do `build/deps.lock`, `vcpkg.versions.libvpx`). Os dois textos vão inteiros na tela Avisos de licença do app (`windows/ui/assets/licencas-windows.txt`).

Para trocar de versão, troque juntos o `LICENSE`, o `PATENTS`, a versão do `deps.lock` e o `licencas-windows.txt`.
