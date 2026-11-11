# Starsonic Phone — videochamada em grupo no Windows — especificação de design

- **Data:** 11/11/2026
- **Status:** o desenho foi aprovado pelo responsável no chat, em 10/11/2026, em quatro partes:
  1. como funciona para quem usa;
  2. como funciona por dentro;
  3. o que pode dar errado;
  4. os testes e a entrega.

  As telas de verdade vão para um quadro novo, "Starsonic Phone — sala de vídeo", que o responsável aprova antes do código das telas (seção 12). Esta spec escrita foi aprovada pelo responsável em 11/11/2026, às 17:06.
- **Versão alvo:** o app do Windows 0.4.0-rc.1.
- **Base:** a branch `video-etapa-2` (a 0.3.0-rc.2, publicada em 11/11/2026), com:
  - a videochamada de duas pessoas (spec `docs/superpowers/specs/2026-11-09-starsonic-phone-video-design.md`);
  - o motor com o vídeo da PJSIP (`starsonic/phone`, a tabela das ligações em `EngineCallVideo.cpp`);
  - o núcleo com as memórias de vídeo (`starsonic/desktop`, o `VideoSink`);
  - as telas (`windows/ui`, a `VistaDeVideo`, a tela da ligação e o grande);
  - a conferência de voz a três, que é misturada no próprio app.

> **Decisões do responsável** (10/11/2026):
> 1. A sala tem até 6 pessoas: quem monta e mais 5.
> 2. Entram colegas e gente de fora, em qualquer aparelho SIP: o app no Windows, o MicroSIP e outros programas, o celular com um app, e o telefone com câmera. Quem não tem vídeo entra com a voz.
> 3. As ligações passam pelas centrais dos próprios clientes, de várias marcas. O app segue o padrão do SIP, sem nada próprio de uma central.
> 4. O jeito 1: o app de quem monta a sala liga para cada pessoa, mistura o som e junta as imagens. Ficaram de fora:
>    - uma sala num servidor da Starsonic;
>    - a sala de conferência das próprias centrais.
> 5. Uma ligação de fora no meio da sala: atender tira você da sala por um momento, só com voz. Os outros continuam se ouvindo e se vendo. Você volta quando ela acaba ou pelo "Voltar para a sala".
> 6. A sala sai como 0.4.0-rc.1, depois da 0.3.0-rc.1. O quadro das telas vem antes do código das telas.
> 7. Fora da sala continua a regra da 0.3.0 (decidida em 10/11/2026): com duas ligações o vídeo pausa, e a voz continua.

## 1. Contexto

- A 0.3.0 faz a videochamada entre duas pessoas. A conferência de voz a três já é misturada na mesa de áudio do app, e a central não fica sabendo dela.
- O pedido do responsável: na videochamada, poder adicionar mais pessoas.
- A peça de vídeo da PJSIP (o `vid_conf`) junta até 4 imagens numa saída (`update_render_state`, com `tr_fmt_id[4]`). Para 5 ou 6 pessoas, o mosaico é nosso.
- O motor de hoje aceita no máximo 4 ligações ao mesmo tempo (o `PJSUA_MAX_CALLS` padrão da PJSIP, que o `build/config_site.h` não muda).

## 2. Objetivos

- Uma videochamada de até 6 pessoas, montada no app do Windows, com qualquer aparelho SIP, pelas centrais dos clientes, sem servidor e sem configurar as centrais.
- Nada muda numa ligação comum nem na videochamada de duas pessoas.

## 3. Critérios de sucesso

1. Numa videochamada no Windows, o "Adicionar pessoa" liga para mais pessoas, até 6 no total.
2. Cada convidado vê um mosaico com os outros, sem ele mesmo, num aparelho SIP comum: o MicroSIP com o H.264 e com o VP8, e um telefone com câmera.
3. Quem montou vê os convidados num mosaico, com o nome de cada um, e a própria imagem no canto.
4. Todos ouvem todos, e ninguém ouve a si mesmo.
5. Quando um convidado sai, o mosaico se arruma, e com um convidado só a sala volta a ser uma videochamada comum.
6. Quem montou atende uma ligação de fora, e os outros continuam se ouvindo e se vendo. Na volta, todos se juntam de novo.
7. Com 6 pessoas, num PC com um processador de 4 núcleos de 2018 para cá (como um Core i5 de 8ª geração), a sala roda sem engasgar e usa até cerca de 3 Mbit/s de upload.
8. O diagnóstico anota os eventos da sala sem nomes, números e imagens.

## 4. O que a versão entrega

### 4.1 Telas (o quadro "Starsonic Phone — sala de vídeo")
- **Na videochamada:** o botão "Adicionar pessoa", com o teclado e os contatos, como o painel do Transferir.
- **A sala, na tela da ligação:**
  - o mosaico dos convidados, com o nome de cada um no quadro dele;
  - a sua imagem no canto;
  - os controles: Mudo, Câmera, Adicionar pessoa, Abrir grande e Desligar.
- **O quadro de um convidado:**
  - o nome;
  - os estados "Chamando…", "Sem vídeo" (as iniciais no lugar da imagem) e "Em espera";
  - o "Tirar da sala", só para quem montou.
- **A pergunta do Desligar:** "Encerrar a sala para todos?".
- **Fora da sala** (a ligação de fora): uma faixa "Você está fora da sala" com o "Voltar para a sala".
- **O grande e a tela cheia** com o mosaico, como na videochamada de duas pessoas.
- **No limite:** o "Adicionar pessoa" desativado, com "A sala já tem 6 pessoas.".

### 4.2 Comportamento
- **Montar:**
  - a sala nasce de uma videochamada de duas pessoas, no Windows, com o vídeo do app ligado;
  - o "Adicionar pessoa" faz uma ligação comum com oferta de vídeo pela central da conta;
  - o quadro novo aparece como "Chamando…";
  - quando a pessoa atende, ela entra na sala com o som e a imagem.
- **Quem adiciona:** só quem montou a sala adiciona e tira pessoas. Um convidado que usa o Starsonic Phone vê uma videochamada comum.
- **O que cada um recebe:**
  - cada convidado recebe uma imagem só: o mosaico dos outros, montado para ele;
  - quem montou recebe a imagem de cada convidado separada e vê o mosaico de todos;
  - o som de cada um vai para todos os outros.
- **A saída de um convidado:**
  - o quadro some e o mosaico se arruma;
  - com um convidado só, a sala volta a ser uma videochamada comum: ele passa a receber a sua câmera direto, e você vê a imagem dele inteira.
- **O Desligar de quem montou:** depois da pergunta, desliga todas as ligações da sala.
- **A ligação de fora** (decisão 5):
  - o aviso aparece, como hoje, mas sem o "Atender com vídeo";
  - atender tira o seu som e a sua câmera da sala, e você fala só por voz com quem ligou;
  - a sala continua: o som e os mosaicos dos convidados seguem, e o seu quadro aparece para eles sem a imagem;
  - quando a ligação de fora acaba, ou no "Voltar para a sala", você volta, e a ligação de fora fica em espera se ainda estiver na linha.
- **A tela do Windows bloqueada:** a sua câmera pausa, como na 0.3.0, e a sala continua.
- **Dentro da sala:**
  - não aparecem a Espera, o Transferir, a Conferência e o Chat;
  - a regra de pausar o vídeo com duas ligações (decisão 7) não vale entre as ligações da própria sala.
- **A qualidade:**
  - o mosaico de cada convidado fica no máximo na qualidade Média da área do administrador;
  - a partir de 4 convidados, ele usa a "Média da sala" (seção 7), para o upload ficar perto de 3 Mbit/s.

### 4.3 A área do administrador
Nada novo. Os codecs, a qualidade e os porteiros do cartão Vídeo valem para a sala.

## 5. Fora do escopo
- Uma sala num servidor da Starsonic, e a sala de conferência das centrais.
- Mais de 6 pessoas.
- Um convidado adicionar ou tirar pessoas, e passar a sala para outra pessoa.
- O Android e o iPhone montarem uma sala (eles não têm vídeo). Eles entram como convidados, só com voz.
- Os nomes desenhados no mosaico que os convidados recebem. Só quem montou vê os nomes.
- Gravar a sala, mostrar a tela e o Chat dentro da sala.
- Juntar a conferência de voz a três de hoje com a sala. A conferência continua igual, fora da sala.

## 6. Arquitetura

### 6.1 As partes
- **O motor** (`starsonic/phone`) ganha a sala:
  - as ligações dela;
  - a mesa de áudio de todos com todos;
  - o mosaico.
- **O núcleo** (`starsonic/desktop`):
  - publica o estado da sala;
  - recebe os comandos dela;
  - leva o mosaico de quem montou à página pela memória do `remoto`.
- **A interface** (`windows/ui`) desenha a sala: o mosaico com os nomes por cima, os quadros, os controles e a faixa de fora da sala.

### 6.2 O motor
- **As ligações:**
  - o `PJSUA_MAX_CALLS` vai para 8 no `build/config_site.h`: 5 convidados, a ligação de fora e folga;
  - a sala guarda até 5 ligações. A tabela das ligações (`CallTable`) sabe quais são da sala, e o `Paused` nunca pausa uma ligação da sala por causa de outra ligação, seja da sala ou de fora;
  - enquanto houver sala, a ligação de fora fica só com voz.
- **O som:** a mesa de áudio da PJSIP (`pjsua_conf_connect`) liga:
  - cada ligação da sala com cada outra, nos dois sentidos;
  - o seu microfone e o seu fone com cada uma.

  Fora da sala, só o seu microfone e o seu fone saem da sala e vão para a ligação de fora.
- **O mosaico** (um componente novo, com as contas puras separadas para testar):
  - **A entrada:** a última imagem de cada convidado, que o motor já recebe separada por ligação, e a sua câmera.
  - **A saída para cada convidado:** uma porta de vídeo nossa na peça de vídeo da PJSIP (`pjsua_vid_conf_add_port`), ligada à codificação da ligação dele (`pjsua_call_get_vid_conf_port` com `PJMEDIA_DIR_ENCODING`) no lugar da câmera. A porta monta o mosaico dos outros quando a PJSIP pede um quadro. Cada ligação codifica no codec que combinou: H.264 ou VP8.
  - **A saída para quem montou:** mais um mosaico, com todos os convidados, escrito na memória do `remoto` (o formato SSV1 da 0.3.0, até 1920×1080).
  - **A arrumação:**
    - uma imagem ocupa tudo;
    - duas ficam lado a lado;
    - três e quatro ficam numa grade de 2×2;
    - cinco ficam em duas linhas, de 3 e 2.

    Cada imagem encaixa no seu quadro sem deformar, com faixas onde sobra, escalada pela libyuv (`I420Scale`).
  - **Sem imagem** (um convidado sem vídeo ou em espera, a sua câmera desligada ou pausada, ou você fora da sala): o quadro fica com a cor de fundo. Quem montou vê as iniciais por cima, desenhadas pela página.
- **Com um convidado só:** o mosaico sai do caminho e volta a ligação direta da câmera, como na 0.3.0.

### 6.3 O núcleo
- **O estado da sala**, na ligação:
  - os participantes, cada um com o id da ligação, o nome, o número, o estado ("chamando", "na sala", "em espera") e se manda imagem;
  - se você está fora da sala;
  - se a sala está cheia;
  - a arrumação do mosaico de quem montou: o retângulo de cada participante, de 0 a 1, para a página pôr os nomes e as ações nos lugares certos.
- **Os comandos novos:** `salaAdicionar` (o número), `salaTirar` (o id), `salaEncerrar` e `salaVoltar`. O Mudo, a Câmera e o Desligar continuam os de hoje.
- **O diagnóstico:** uma linha `sala:` por evento (entrou, saiu, falhou e o motivo, saiu e voltou), sem nomes nem números.

### 6.4 A interface
- **A sala** usa a `VistaDeVideo` do `remoto` para o mosaico de quem montou e põe por cima os nomes, os estados e o "Tirar da sala", pela arrumação publicada.
- **O "Adicionar pessoa"** reaproveita o painel de discar do Transferir.
- **A faixa de fora da sala** é como a faixa da conversa na ligação.
- **No iPhone,** nada da sala aparece.

### 6.5 A ponte
Os campos e os comandos novos ficam escritos em `docs/ponte-windows.md`, com a ponte falsa dos testes igual.

## 7. Os valores
- **O tamanho da sala:** até 6 pessoas, ou seja, 5 convidados.
- **`PJSUA_MAX_CALLS`:** 8.
- **O mosaico de cada convidado:**

  | Convidados | Imagem | Quadros por segundo | Taxa do vídeo, por convidado |
  | --- | --- | --- | --- |
  | 1 | a videochamada comum, sem mosaico | — | — |
  | 2 ou 3 | a da qualidade escolhida, no máximo a Média (640×480) | a da qualidade, no máximo 25 | a da qualidade, no máximo 800 kbit/s |
  | 4 ou 5 ("Média da sala") | 640×480 | 15 | 600 kbit/s |

- **O upload de quem montou** com 5 convidados: cerca de 3 Mbit/s de vídeo (5 × 600 kbit/s), mais o som.
- **O mosaico de quem montou:** 1280×720, na memória do `remoto`.

## 8. Fluxos
1. **Montar:** numa videochamada com a Ana, o "Adicionar pessoa", e o número do Carlos. O quadro dele aparece como "Chamando…". O Carlos atende e entra na sala.
   - A Ana passa a receber o mosaico com você e o Carlos.
   - O Carlos recebe o mosaico com você e a Ana.
   - Você vê a Ana e o Carlos, com os nomes.
2. **Mais gente:** o mesmo, até 5 convidados. No sexto, o botão fica desativado.
3. **Um convidado sai:** o quadro dele some e os mosaicos se arrumam. Com um convidado só, a sala vira uma videochamada comum.
4. **Encerrar:** o Desligar, depois "Encerrar a sala para todos?", e todas as ligações desligam.
5. **A ligação de fora:** o aviso, o Atender, e você fala com quem ligou só por voz. A sala continua. Quando a ligação acaba, ou no "Voltar para a sala", você volta.
6. **A tela bloqueada:** a sua câmera pausa, e a sala continua. No desbloqueio, a câmera volta, se estava ligada.

## 9. Segurança e privacidade
- **O caminho das imagens e do som:** nada passa por um servidor da Starsonic. Tudo vai entre o app de quem montou e cada convidado, pelas centrais.
- **A câmera** segue as regras da 0.3.0: só liga num clique da pessoa, e a sua imagem fica sempre à vista com ela ligada.
- **Quem vê quem:** os convidados se veem entre si, e quem montou escolhe quem entra. O texto do roteiro lembra isso.
- **O diagnóstico** não leva nomes, números nem imagens da sala.

## 10. Interface e textos
Os textos novos, que o quadro confirma:
- "Adicionar pessoa", "Tirar da sala";
- "Encerrar a sala para todos?";
- "Você está fora da sala", "Voltar para a sala";
- "Chamando…", "Sem vídeo", "Em espera";
- "A sala já tem 6 pessoas.".

As falhas de uma ligação para um convidado usam os textos de hoje das ligações que não completam.

## 11. Erros e testes

### 11.1 Erros
1. **O convidado não entra** porque não atendeu, está ocupado, o número está errado ou a central recusou mais uma ligação. Aparece o motivo, como numa ligação comum, e a sala continua.
2. **O convidado sem vídeo** porque o aparelho não tem câmera, ele recusou o vídeo, ou não há codec em comum. Ele fica só com a voz, e o quadro dele mostra as iniciais.
3. **O convidado põe a ligação em espera** no aparelho dele: o quadro mostra "Em espera", e ele para de receber o mosaico até voltar.
4. **A sua câmera falha ou é tirada:** aparece o aviso de hoje. O seu quadro fica sem imagem para os convidados, e a sala continua.
5. **O PC de quem montou cai** porque perdeu a internet ou o app fechou: todas as ligações da sala caem. Sem o app de quem montou não há sala.
6. **A central limita as ligações do ramal:** a ligação a mais falha com o motivo (como no 1). O roteiro manda conferir o limite em cada central de cliente.

### 11.2 Testes automáticos (a cada mudança, no GitHub)
1. **O mosaico, puro:**
   - a arrumação de 1 a 5 imagens, em cada tamanho de saída;
   - a montagem com imagens de teste: cada cor no seu lugar, inclusive com tamanhos ímpares;
   - o mosaico de cada convidado sem ele mesmo;
   - o quadro sem imagem.
2. **O motor, com o registrador falso:**
   - uma sala com 3 convidados em que cada um recebe o mosaico (o eco do registrador devolve o que chega);
   - o som de todos com todos;
   - a saída de um convidado, e a volta à videochamada comum com um só;
   - a ligação de fora com a sala seguindo;
   - o limite de 6;
   - uma ligação a mais que a central recusa.
3. **O núcleo:** o estado da sala publicado, os comandos e as linhas do diagnóstico sem nomes nem números.
4. **As telas, com a ponte falsa:**
   - a sala nos três tamanhos e nos dois temas, com os nomes nos quadros;
   - o "Adicionar pessoa", o "Tirar da sala" e o "Encerrar a sala para todos?";
   - a faixa de fora da sala e o "Voltar para a sala";
   - o limite;
   - o grande e a tela cheia;
   - as fotos para o responsável aprovar.
5. **A fumaça do Windows:** o app instalado monta uma sala com 2 convidados do registrador falso, e o mosaico chega à memória do `remoto`.

### 11.3 Teste manual
- Dois ou três PCs com o app, um MicroSIP com vídeo e um telefone com câmera, pela central de um cliente.
- 6 pessoas, se der, olhando o uso do processador e do upload de quem montou.
- A ligação de fora no meio da sala, a tela bloqueada, um convidado em espera, e um convidado sem vídeo.
- O limite de ligações do ramal em cada central de cliente.

## 12. Entrega e etapas
1. **Começa depois da 0.3.0-rc.1,** numa branch nova que sai da `video-etapa-2`.
2. **O quadro "Starsonic Phone — sala de vídeo"** com as telas da sala, para o responsável aprovar antes do código das telas.
3. **A etapa 3a, por dentro:** o motor (as ligações da sala, o som, o mosaico) e o núcleo (o estado, os comandos, a memória do mosaico de quem montou), com o seu plano.
4. **A etapa 3b, as telas:** a sala, o "Adicionar pessoa", os quadros, a faixa de fora da sala, o grande, as fotos, a fumaça e o roteiro, com o seu plano.
5. **A publicação:** a 0.4.0-rc.1 é publicada pelo responsável, pelo workflow `release`, depois de ele aprovar as fotos e os textos.

## 13. Riscos
- **Centrais que limitam as ligações de um ramal** (algumas deixam só 2 ou 4): a sala fica menor nessas centrais. O roteiro confere, e o motivo aparece na tela.
- **O PC ou a internet fracos de quem montou:** a "Média da sala" segura o upload perto de 3 Mbit/s, mas um PC antigo pode não dar conta de 5 codificações. O roteiro mede.
- **A porta de vídeo nossa na PJSIP:** a montagem acontece na thread da PJSIP, que pede os quadros. As imagens chegam de outras threads, com trava e cópia da última imagem, como já faz o caminho da memória.
- **Telas pequenas:** num celular, cinco quadros num mosaico de 640×480 ficam pequenos.
