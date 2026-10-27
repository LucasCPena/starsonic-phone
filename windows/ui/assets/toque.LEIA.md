# toque.wav

O toque da ligação recebida (`completo`) no app do Windows, tocado em loop pela interface (`src/ring.ts`).

- **Origem:** o `ringtone.wav` do pacote oficial do MicroSIP 3.22.16 (MicroSIP-Lite), o mesmo arquivo de `microsip-dist/ringtone.wav`, copiado byte a byte.
- **Licença:** a do MicroSIP, GNU GPL v2 ou posterior, compatível com a GPL v3 do app.
- **Crédito:** não aparece na tela Sobre por causa da regra da marca (nenhum texto visível com o nome do MicroSIP no app nem no instalador, que o `build/check_branding.py` confere). A origem e a licença ficam só aqui, no código-fonte: este arquivo não é copiado para a `dist/` (o `build.mjs` não o lista) e não vai no instalador.
