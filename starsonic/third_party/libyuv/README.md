# libyuv 1678: só os textos da licença

O `LICENSE` (a licença BSD de 3 cláusulas do LibYuv Project) e o `PATENTS` (a concessão de direitos de patente) vieram sem mudança de `third_party/yuv/` do [pjsip/pjproject](https://github.com/pjsip/pjproject), no commit `5a457451fa2712ba18e12b01738e8ff3af2b26fd` (a tag 2.17, o `pjproject.commit` do `build/deps.lock`). A versão, `1678`, é a do `LIBYUV_VERSION` em `third_party/yuv/include/libyuv/version.h` do mesmo commit.

Nenhum código da libyuv entra no repositório. Quem a usa é o motor do Windows: a PJSIP a compila junto (a conversão de quadros do vídeo). Os dois textos vão inteiros na tela Avisos de licença do app (`windows/ui/assets/licencas-windows.txt`).

Para trocar de versão, troque juntos o `LICENSE`, o `PATENTS`, o commit do `deps.lock` e o `licencas-windows.txt`.
