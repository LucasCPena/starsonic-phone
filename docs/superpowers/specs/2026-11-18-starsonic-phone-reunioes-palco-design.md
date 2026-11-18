# Starsonic Phone — reuniões com link — o palco da reunião no navegador — especificação de design

- **Data:** 18/11/2026
- **Status:** o desenho foi aprovado pelo responsável no chat, em 18/11/2026, em três partes:
  1. o caminho (uma imagem só, recortada pela página), às 10:17;
  2. as telas do quadro, às 10:32;
  3. o funcionamento por dentro, às 10:37.

  Esta spec escrita espera a aprovação do responsável.
- **Base:** esta spec completa a de 12/11/2026 (`2026-11-12-starsonic-phone-reunioes-link-design.md`) e muda as partes dela que a seção 8 lista. O resto daquela spec continua valendo.
- **Versões alvo:**
  - o servidor do chat `0.2.0-rc.4`;
  - o servidor de vídeo `0.1.0-rc.3`.
- **Quadro:** "Starsonic — reunião no navegador", telas 12 a 19, aprovadas em 18/11/2026.

## 1. Contexto

Na `chat-v0.2.0-rc.3`, a reunião no navegador funciona, e o responsável a testou no PC e no celular em 18/11. Ele pediu três mudanças, com o Meet e o Teams como referência:

1. as câmeras ocupando a tela toda, no PC e no celular;
2. um clique que aumenta a câmera de uma pessoa, também quando alguém compartilha a tela;
3. mais qualidade na tela compartilhada e na imagem das câmeras.

Por que hoje não é assim:

- O servidor de vídeo junta todas as câmeras numa imagem só, o mosaico, igual para todos. A página só mostra essa imagem, numa moldura 16:9.
- Com 2 pessoas, cada quadro ocupa um quarto do mosaico, e o resto fica escuro.
- A página não sabe onde está cada pessoa no mosaico. Por isso não consegue aumentar ninguém.
- O mosaico tem 1280×720, com 15 imagens por segundo.
- A tela compartilhada entra num pedaço de 1067×600 do mosaico, e as letras borram.
- A página pede a câmera sem dizer o tamanho. Nesse caso, o Chrome entrega 640×480.

Três caminhos foram comparados:

| Caminho | O que é | Decisão |
|---|---|---|
| 1. Uma imagem só | O mosaico continua único. A página recorta dele cada pessoa e a tela. | Escolhido. |
| 2. Duas imagens | Durante o compartilhamento, uma imagem só da tela e outra só das câmeras. | Fica para depois, por cima do caminho 1, se a câmera aumentada durante o compartilhamento incomodar. |
| 3. Um vídeo por pessoa | Cada pessoa manda o seu vídeo separado, como o Meet e o Teams fazem por dentro. | Recusado: troca o servidor de vídeo inteiro, e os telefones e o app não receberiam o mosaico único que a spec de 12/11 prevê. |

## 2. Objetivos

1. Os quadros das pessoas ocupam a área da reunião, no PC e no celular.
2. Cada pessoa aumenta o quadro que quiser, só para ela.
3. A tela compartilhada chega inteira, em 1920×1080.
4. A imagem das câmeras fica mais nítida e mais solta.
5. O mosaico continua único, para os telefones e o app das etapas seguintes.

## 3. Critérios de sucesso

1. Numa reunião de 2 pessoas, cada uma vê a outra ocupando a área da reunião e se vê pequena no canto.
2. Numa reunião de 3 a 10 pessoas, a grade das outras pessoas ocupa a área da reunião, como nas telas 13 e 18 do quadro.
3. Um clique num quadro o aumenta só para quem clicou. `Ver todos` e a tecla Esc voltam à grade.
4. Durante o compartilhamento, a tela aparece grande. Um clique numa câmera a aumenta, e `Voltar para a tela` traz a tela de novo.
5. A tela compartilhada de um monitor de 1920×1080 chega com 1920×1080 pontos. Um texto de tamanho 11, numa planilha a 100%, é lido do outro lado.
6. O mosaico tem 1920×1080 a 25 imagens por segundo, e a câmera de cada pessoa sai em 1280×720.
7. Quando alguém entra ou sai, as outras pessoas não trocam de lugar na imagem, de 1 a 4 pessoas e de 5 a 9.
8. Uma reunião de 10 pessoas usa menos de 50% da CPU da VM de 6 vCPU.
9. A página nova com um servidor de vídeo antigo mostra o mosaico inteiro, como na rc.3.

## 4. O que a etapa entrega

### 4.1 Telas

As telas são as do quadro "Starsonic — reunião no navegador", e tomam o lugar das telas 7, 8 e 11:

| Tela | O que mostra |
|---|---|
| 12 | PC, duas pessoas: a outra ocupa a tela, e você fica pequeno no canto. |
| 13 | PC, várias pessoas: a grade ocupa a tela. Um quadro mostra o mouse em cima, com a borda ciano e `Aumentar`. |
| 14 | PC, uma câmera aumentada: as outras pessoas na faixa ao lado, e `Ver todos`. |
| 15 | PC, a tela compartilhada grande, com as câmeras na faixa. |
| 16 | PC, a tela compartilhada com uma câmera aumentada: a tela na faixa, e `Voltar para a tela`. |
| 17 | Celular em pé, duas pessoas. |
| 18 | Celular em pé, várias pessoas. |
| 19 | Celular em pé, a tela compartilhada. |

O celular com um quadro aumentado não tem tela desenhada: o quadro grande fica em cima, e os outros numa faixa embaixo, que rola para o lado.

### 4.2 Comportamento

- **A grade.**
  - Mostra as outras pessoas. Você não entra na grade: aparece pequeno, no canto de baixo, à direita.
  - Sozinho na reunião, você se vê grande.
  - No PC e no celular deitado, cada quadro tem uma proporção entre 4:3 e 2:1. A grade escolhe as linhas e as colunas que dão os maiores quadros, e deixa no centro o que sobra.
  - No celular em pé, cada quadro ocupa a célula inteira: uma coluna até 3 pessoas, e duas colunas com mais.
- **O corte.**
  - A câmera sempre preenche o quadro dela. O que sobra dos lados, ou de cima e de baixo, é cortado por igual.
  - A tela compartilhada nunca é cortada: ela aparece inteira, com faixas escuras se for preciso.
  - Na faixa, os quadros têm sempre a proporção 16:9.
- **Aumentar.**
  - Um clique, um toque ou Enter num quadro o aumenta. As outras pessoas vão para a faixa, e você vira o último quadro da faixa.
  - Um clique em outro quadro da faixa troca quem está grande.
  - `Ver todos` e a tecla Esc voltam à grade.
  - Vale só para quem clicou. Ninguém mais vê diferença.
  - Se a pessoa aumentada sai da reunião, a página volta à grade.
- **A tela compartilhada.**
  - Quando alguém começa a compartilhar, a tela fica grande para todos, mesmo para quem tinha uma câmera aumentada.
  - Um clique numa câmera da faixa a aumenta, e a tela vai para o começo da faixa.
  - `Voltar para a tela` e a tecla Esc trazem a tela de novo. Um clique na tela da faixa também.
  - Quando o compartilhamento acaba, a página volta à grade.
  - Durante o compartilhamento, uma câmera aumentada fica menos nítida do que fora dele (seção 6.1).
  - Quem compartilha vê a própria tela grande, como os outros. O aviso `Você está compartilhando a tela` e o botão `Parar de compartilhar` continuam.
- **Os nomes.** A página escreve o nome por cima de cada quadro. Na tela compartilhada, escreve `Tela de <nome>`, e `A sua tela` para quem compartilha.
- **A câmera desligada.**
  - O quadro fica escuro, com o nome no centro.
  - Ele aparece assim na hora em que a pessoa desliga a câmera, e não 5 segundos depois.
- **O celular.**
  - Em pé, os quadros ocupam a tela, como diz a regra da grade.
  - Durante o compartilhamento, em pé, a tela fica em cima, na largura toda, com o aviso `Gire o celular para ver a tela maior.`, e as pessoas embaixo.
  - O aviso `Gire o celular para ver a reunião maior.` sai.
  - Deitado, o celular segue as regras do PC.
- **Os controles** (`Microfone`, `Câmera`, `Compartilhar a tela` e `Sair`) não mudam.

### 4.3 Os componentes novos do palco

Os componentes estendem o que as telas 1 a 11 já usam, com as cores e as medidas do design system da Starsonic no tema escuro.

- **O problema:** a reunião tinha um componente só, a moldura 16:9 do mosaico. Ela não deixa a pessoa escolher o que ver, e desperdiça a tela.
- **O que já existe e continua:**

  | O que já existe | O que se aproveita | Por que não basta |
  |---|---|---|
  | A moldura do mosaico | O fundo, os cantos e a etiqueta do nome | É uma imagem só, sem quadros que se possam clicar. |
  | Os botões em pílula dos controles | A forma e as cores | Ficam na barra de baixo, e não sobre o vídeo. |
  | O cartão "A conexão caiu" | Continua por cima do palco inteiro | — |

- **Os componentes:**

  | Componente | O que é | Variantes | Estados |
  |---|---|---|---|
  | Quadro | O vídeo de uma pessoa, recortado do mosaico. É um botão. | Grande, da grade e da faixa. | Normal. Com o mouse em cima: a borda `cyan` de 3 px e a pílula `Aumentar`. Sem câmera: o fundo `#1b2333` e o nome no centro. Esperando a imagem: o fundo `#1b2333` e a etiqueta do nome. |
  | Tela | A tela compartilhada. É um botão quando está na faixa. | Grande e da faixa. | Nunca cortada. A etiqueta leva o ícone do monitor e `Tela de <nome>`. |
  | Você | A sua câmera, direto do aparelho, espelhada. Não é um botão. | Flutuante no canto, a última da faixa, e grande quando você está sozinho. | Sem câmera: o fundo escuro e `Você`. |
  | Faixa | A fila dos quadros pequenos. | Uma coluna de 228 px à direita, no PC. Uma linha embaixo, no celular em pé. | Rola quando os quadros não cabem. |
  | Botão de voltar | Uma pílula sobre o quadro grande, em cima, à esquerda. | `Ver todos`, e `Voltar para a tela` durante o compartilhamento. | Normal e com o foco. |

- **As cores e as medidas** (os nomes são os do design system):
  - o fundo da página em `ink` (`#0a0e1a`), e as barras em `navy-950` (`#070b18`);
  - a ação em `cyan` (`#00c2cb`), com o texto em `on-cyan` (`#03222a`): a pílula `Aumentar` e a borda do mouse em cima;
  - a etiqueta do nome com o véu `rgba(0, 0, 0, 0.55)`, e a da tela com `rgba(0, 0, 0, 0.72)`;
  - o botão de voltar com a borda `outline` do tema escuro (`rgba(255, 255, 255, 0.28)`) sobre `rgba(7, 11, 24, 0.78)`;
  - os cantos de 12 px no quadro grande e na grade do PC, de 10 px na faixa e no celular, e `radius-pill` nos botões;
  - a sombra `shadow-float` no Você flutuante;
  - a letra Plus Jakarta Sans, nos pesos 600 (etiquetas) e 700 (botões).
- **Acessibilidade:**
  - o Quadro e a Tela da faixa são `<button>` de verdade, com o nome dito: `Aumentar a câmera de <nome>`, `Aumentar a tela de <nome>`, e `Aumentar o quadro de <nome>, que está com a câmera desligada`;
  - o Tab passa pelos quadros, o Enter e o Espaço aumentam, e o Esc volta;
  - o foco do teclado é o anel `cyan` de 3 px, afastado 2 px;
  - o botão de voltar tem pelo menos 44 px de altura;
  - o mouse em cima não depende só da cor: a pílula `Aumentar` aparece junto.
- **A conferir no teste manual:** o corte das laterais no celular em pé, e a largura da faixa num notebook de tela pequena.

## 5. Fora do escopo

- Destacar quem está falando.
- O ícone do microfone mudo nos quadros.
- O botão de tela cheia, e arrastar o Você para outro canto.
- Um mosaico mais leve para quem está numa rede fraca.
- A ligação direta entre as duas pessoas de uma reunião de 2, sem passar pelo mosaico.
- O caminho 2 (duas imagens durante o compartilhamento).
- O app e os telefones: continuam nas etapas da spec de 12/11.

## 6. Arquitetura

### 6.1 O mosaico (o servidor de vídeo)

- **O quadro do mosaico** passa a 1920×1080, a 25 imagens por segundo, em VP8, com 3 Mbit/s. O codificador continua um só para todos.
- **Os layouts da grade.** As células têm sempre a proporção 16:9, e o FreeSWITCH não corta a câmera: uma câmera de outra proporção ganha faixas escuras dentro da célula.

  | Layout | Para | As células |
  |---|---|---|
  | `starsonic-4` | 1 a 4 pessoas | 4 de 960×540: (0,0,180), (180,0,180), (0,180,180) e (180,180,180) |
  | `starsonic-9` | 5 a 9 | 9 de 640×360: (x,y,120), com x e y em 0, 120 e 240 |
  | `starsonic-12` | 10 | 12 de 480×270: (x,y,90), com x em 0, 90, 180 e 270, e y em 45, 135 e 225 |

  - As medidas são as do FreeSWITCH, num quadro de 360×360 esticado sobre o mosaico, como na seção 7 do `docs/video-agente.md`.
  - O grupo `starsonic-grade` tem os três, nessa ordem. O FreeSWITCH escolhe o primeiro em que todos cabem.
  - Assim, de 1 a 4 pessoas o layout é o mesmo, e de 5 a 9 também. Quem entra ocupa uma célula livre, e quem já estava não muda de lugar. Os outros só mudam de lugar na passagem de 4 para 5 e de 9 para 10 pessoas, e na volta.
  - O teste de ponta a ponta confere isso. Se o FreeSWITCH trocar alguém de célula por conta própria quando outra pessoa sai, o agente a devolve à célula dela (`vid-layer`).
  - Os layouts `starsonic-1`, `starsonic-2` e `starsonic-6` saem.
- **O compartilhamento.**
  - Quando a ligação de uma tela entra, o agente muda o mosaico para 1920×1440 (`vid-res`), põe o grupo `starsonic-apresentacao` (`vid-layout`) e sobe a banda para 4 Mbit/s (`vid-bandwidth`).
  - Quando a última tela sai, ele volta a 1920×1080, ao grupo `starsonic-grade` e aos 3 Mbit/s.
  - A tela ocupa os 1920×1080 de cima, ponto por ponto. As pessoas ficam nos 1920×360 de baixo.

  | Layout | Para | As células |
  |---|---|---|
  | `starsonic-apresentacao-3` | a tela e até 3 pessoas | a tela em (0,0,360,270), com o `reservation_id` `tela`; 3 de 640×360: (0,270,120,90), (120,270,120,90) e (240,270,120,90) |
  | `starsonic-apresentacao-12` | a tela e de 4 a 10 pessoas | a tela igual; 12 de 320×180: (x,270,60,45) e (x,315,60,45), com x em 0, 60, 120, 180, 240 e 300 |

  - Por isso a câmera aumentada durante o compartilhamento tem menos pontos: 640×360 até 3 pessoas, e 320×180 com mais.
- **Os nomes saem do mosaico.** O agente não põe mais o `video_banner_text`. Quem escreve os nomes é a página (seção 6.3).
- **Quem está sem câmera** continua com o quadro de `#1B2333` do FreeSWITCH na célula, depois de 5 s sem imagem.
- **A banda que cada ligação pode mandar** (`rtp_video_max_bandwidth_in`): 1,5 Mbit/s para a câmera e 2,5 Mbit/s para a tela.

### 6.2 O palco: quem está onde

O "palco" é a descrição do mosaico de agora: o tamanho dele e a célula de cada pessoa e da tela.

- **O agente** monta o palco de cada sala.
  - Ele sabe o layout, porque é ele quem gera os layouts.
  - Ele lê do FreeSWITCH a célula de cada ligação (o `videoLayerID` do `conference <sala> json_list`).
  - Ele lê a cada 500 ms enquanto a sala tem alguém, e logo depois de cada entrada, de cada saída e de cada troca de layout.
  - Só entra no palco a ligação que já tem célula.
- **O agente avisa o chat** quando o palco de uma sala muda, por um evento novo, e o `estado` leva o palco de cada sala:

  ```json
  {"tipo": "palco", "sala": "<sala>", "largura": 1920, "altura": 1080,
   "quadros": [{"participante": "<id>", "tela": false, "x": 0, "y": 0, "l": 960, "a": 540}]}
  ```

  - As medidas são em pontos do mosaico.
  - O evento não leva nome nenhum.
- **O chat repassa o palco** a cada página aceita daquela reunião, pelo canal dela:

  ```json
  {"tipo": "palco", "largura": 1920, "altura": 1080,
   "quadros": [{"quem": "<id>", "nome": "Ana Souza", "voce": false, "tela": false, "semCamera": false,
                "x": 0, "y": 0, "l": 960, "a": 540}]}
  ```

  - O chat põe o `nome`, o `voce` (o quadro é de quem recebe a mensagem) e o `semCamera`.
  - Na tela compartilhada, o `quem` e o `nome` são os de quem compartilha, e o `tela` é verdadeiro.
  - A página recebe o palco logo depois do `aceito` e do `voltou`, e a cada mudança.
- **A página avisa a câmera dela** ao chat, por uma mensagem nova:

  ```json
  {"tipo": "camera", "ligada": false}
  ```

  - Ela manda depois do `aceito` e do `voltou`, e a cada vez que a pessoa liga ou desliga a câmera.
  - Antes do `aceito`, a mensagem é fora de ordem (`erro invalido`).
  - O chat guarda isso por participante, e manda o palco de novo às páginas da reunião.
  - São no máximo 30 por minuto por canal. As que passam disso são ignoradas.

### 6.3 A página

- **O vídeo.** A página continua recebendo um vídeo só, o mosaico. Ele fica fora da vista, tocando.
- **Os quadros.** Cada quadro é um `<canvas>` que a página pinta com a célula daquela pessoa, a cada imagem do vídeo (`requestVideoFrameCallback`; sem ele, `requestAnimationFrame`).
- **O Você** é um `<video>` com a câmera do próprio aparelho, sem passar pelo servidor.
- **A arrumação** fica num módulo puro, o `palco.js`, testado em node como o `estado.js`:
  - ele recebe o palco, o tamanho da área, quem está aumentado e se o celular está em pé;
  - ele devolve o lugar e o tamanho de cada quadro na tela, e o recorte de cada um no mosaico;
  - ele guarda as regras do aumentar e da tela compartilhada (seção 4.2).
- **Sem o palco** (um servidor de vídeo antigo): se nenhum palco chega em 3 s depois de a ligação ficar no ar, a página mostra o mosaico inteiro, como na rc.3. Quando um palco chega, ela passa aos quadros.
- **Quando o palco muda:**
  - um quadro que só apareceu ou só sumiu não mexe nos outros;
  - quando as células dos outros mudam, ou o tamanho do mosaico muda, os quadros mostram o fundo escuro com o nome por um instante;
  - eles voltam a mostrar o vídeo quando o vídeo tem o tamanho que o palco diz e já passaram 250 ms.
- **Os nomes** são texto da página, por cima do quadro.

### 6.4 A câmera e a tela de cada pessoa

- **A câmera:** a página pede 1280×720, a 30 imagens por segundo, na proporção 16:9, com a câmera da frente no celular. Se o aparelho não tem, o navegador entrega o mais perto disso.
- **A tela:** a página pede até 1920×1080 e até 15 imagens por segundo, e marca a faixa como "detalhe" (`contentHint`), para o navegador preferir a nitidez ao movimento.

## 7. Os valores

| Valor | Antes | Agora |
|---|---|---|
| O mosaico | 1280×720, 15 imagens por segundo | 1920×1080, 25 imagens por segundo |
| O mosaico durante o compartilhamento | 1280×720 | 1920×1440 |
| A tela compartilhada dentro do mosaico | 1067×600 | 1920×1080 |
| Cada pessoa no mosaico, de 1 a 4 pessoas | 1280×720 (1), 640×360 (2 a 4) | 960×540 |
| Cada pessoa no mosaico, de 5 a 9 | 427×240 | 640×360 |
| Cada pessoa no mosaico, com 10 | 320×240 | 480×270 |
| Cada pessoa durante o compartilhamento | 213×120 | 640×360 até 3 pessoas, 320×180 com mais |
| A banda do mosaico, para cada pessoa | 1,5 Mbit/s | 3 Mbit/s, e 4 Mbit/s durante o compartilhamento |
| A câmera pedida ao navegador | sem tamanho (640×480 no Chrome) | 1280×720, 30 imagens por segundo |
| A banda da câmera, de cada pessoa para o servidor | até 1 Mbit/s | até 1,5 Mbit/s |
| A banda da tela, de quem compartilha para o servidor | até 1 Mbit/s | até 2,5 Mbit/s |
| A espera do palco antes de mostrar o mosaico inteiro | — | 3 s |
| A leitura das células pelo agente | — | a cada 500 ms, e logo depois de cada mudança |
| Os avisos da câmera, por canal | — | até 30 por minuto |

A medida de 18/11, numa máquina de 2 núcleos, com o FreeSWITCH preso a um núcleo e uma pessoa mandando 1280×720:

| O mosaico | Núcleos usados pelo FreeSWITCH |
|---|---|
| 1280×720 a 15 (hoje) | 0,20 |
| 1920×1080 a 25 | 0,48 |
| 1920×1440 a 25 | 0,53 |

Uma segunda pessoa, mandando 640×360, somou entre 0,03 e 0,08 núcleo. Por essa medida, uma reunião de 10 pessoas fica perto de 1,5 núcleo. É uma estimativa: o critério 8 se confere na VM do responsável.

## 8. O que muda na spec de 12/11

| Onde | O que dizia | O que passa a valer |
|---|---|---|
| Seção 3, critério 4 | 720p a 15 imagens por segundo | 1920×1080 a 25 imagens por segundo |
| Seção 4.2 | "Cada um vê a si mesmo no mosaico, como os outros o veem." | No navegador, cada um se vê pela própria câmera, pequeno no canto. O mosaico continua trazendo todos. |
| Seção 4.2 | "quem compartilha a tela ganha o quadro grande, e as pessoas vão para os quadros pequenos" | Vale como o começo. Cada pessoa pode aumentar uma câmera no lugar da tela. |
| Seção 5 | Fora do escopo: "Um mosaico diferente para cada pessoa (sem ela mesma)" | Continua fora no servidor. A página monta a vista de cada pessoa a partir do mosaico único. |
| Seção 6.2 | 1280×720, layouts de 1 a 10 e um de apresentação, "o nome de cada pessoa no quadro dela" | Os layouts e as medidas da seção 6.1 daqui. O nome é escrito pela página, e não vem mais no mosaico. |
| Seção 7 | O mosaico de 1280×720 a 15, e cerca de 1,5 Mbit/s para baixo e até 1 Mbit/s para cima | Os valores da seção 7 daqui. |

**Uma consequência:** um aparelho que mostra o mosaico cru, como o telefone de mesa da etapa da ponte, não vê mais os nomes na imagem. A etapa do app decide o que fazer com isso.

## 9. Segurança e privacidade

- O palco só vai para as páginas aceitas na reunião. Antes do `aceito`, a página não recebe nada dele.
- A página passa a receber o nome das outras pessoas como texto. Esses nomes já apareciam na imagem.
- O `quem` é o id do participante naquela reunião. Ele não dá acesso a nada: o canal da página não tem pedido nenhum sobre outra pessoa.
- O evento do agente não leva nomes. Os registros continuam sem nomes, números, códigos de link e chaves.
- O aviso da câmera é só de aparência. Uma página que mente sobre a própria câmera só muda o desenho do quadro dela.
- A CSP da página não muda: o `<canvas>` e o `<video>` usam o vídeo que a página já recebe.

## 10. Erros e testes

### 10.1 Erros

- **O palco não chega:** a página mostra o mosaico inteiro (seção 6.3).
- **O palco e o vídeo não combinam por um instante:** os quadros mostram o fundo escuro com o nome (seção 6.3).
- **A pessoa aumentada sai:** a página volta à grade, ou à tela compartilhada.
- **A conexão cai:** o cartão "A conexão caiu" continua por cima do palco. Na volta, o palco chega de novo depois do `voltou`.
- **O `vid-res` falha:** o agente deixa o mosaico como está e registra o erro, sem nomes. A tela compartilhada entra no layout de apresentação, com o tamanho que couber.

### 10.2 Testes automáticos

- **O agente (Go):** os layouts gerados; o palco montado a partir do `json_list`, com 1, 4, 5, 9 e 10 pessoas e com a tela; os comandos de entrada e de saída da tela; o evento e o `estado`.
- **O chat (Go):** o repasse do palco, com o `nome`, o `voce` e o `semCamera`; a mensagem `camera`, antes e depois do `aceito`, e o limite; o palco depois do `aceito` e do `voltou`; nenhum nome nos registros.
- **O `palco.js` (node):** a grade de 1 a 9 quadros, no PC, no celular em pé e deitado; o corte; o aumentar, o `Ver todos` e as regras da tela compartilhada; a pessoa aumentada que sai.
- **As telas da página (Playwright):** um vídeo de mentira com uma cor em cada célula, e palcos de mentira. Cada quadro mostra a cor da pessoa certa, na grade, aumentado e na faixa. O Você mostra a câmera local. Sem palco, o mosaico inteiro. O teclado e os nomes ditos.
- **De ponta a ponta:** três navegadores, cada um com a câmera de uma cor, contra o FreeSWITCH de verdade.
  - Cada página mostra as outras duas cores nos quadros com os nomes certos.
  - Quem entra e quem sai não muda os outros de lugar.
  - Com a tela compartilhada, o vídeo recebido tem 1920×1440, e o quadro da tela mostra a cor da tela.
  - Quando o compartilhamento acaba, o vídeo volta a 1920×1080.

### 10.3 Teste manual

Uma seção nova no `docs/teste-manual.md`, "O palco da reunião", com o PC e os celulares:

- as telas 12 a 19, uma a uma;
- o texto pequeno de uma planilha compartilhada, lido do outro lado;
- uma câmera aumentada durante o compartilhamento;
- a câmera desligada, que escurece na hora;
- uma reunião de 10 pessoas, com a CPU do cartão "Reuniões" abaixo de 50%;
- a página nova com o servidor de vídeo antigo, antes de atualizá-lo.

## 11. Entrega

- **As versões:** o chat `0.2.0-rc.4` e o servidor de vídeo `0.1.0-rc.3`, da branch `reunioes-etapa-1`.
- **A ordem de atualizar:**
  1. primeiro o chat: a página nova funciona com o servidor de vídeo antigo, mostrando o mosaico inteiro;
  2. depois o servidor de vídeo: a página passa aos quadros.

  Na ordem contrária, a página antiga mostraria o mosaico novo cru, sem os nomes, até o chat ser atualizado.
- **O servidor de vídeo é atualizado pela primeira vez.** O `atualizar` do instalador gera de novo a configuração do FreeSWITCH e reinicia os serviços: é para um horário sem reuniões.
- **Os guias** (`docs/video-agente.md`, `docs/chat-protocolo.md`, `docs/video-servidor.md` e `docs/chat-servidor.md`) e o roteiro mudam junto.

## 12. Riscos

1. **O palco e o vídeo chegam por caminhos diferentes.** Na passagem de 4 para 5 pessoas, de 9 para 10, e no começo e no fim de um compartilhamento, os quadros mostram o fundo escuro por um instante.
2. **A banda dobrou.** Quem está numa rede fraca, como um 4G ruim, pode ver a imagem travar mais do que hoje. A saída, numa etapa seguinte, é um mosaico mais leve para essas pessoas.
3. **O `vid-res` no começo e no fim do compartilhamento** pode dar uma pausa curta na imagem de todos.
4. **O FreeSWITCH pode trocar alguém de célula** quando outra pessoa sai, ao contrário do que se espera. A página segue o palco de qualquer jeito. Se o teste de ponta a ponta mostrar a troca, o agente ganha o trabalho de devolver cada um à sua célula (seção 6.1).
5. **A conta da CPU** veio de uma medida pequena. Se a reunião de 10 pessoas passar de 50% na VM, as saídas são 20 imagens por segundo ou mais núcleos.
6. **O Safari do iPhone** pode pintar os quadros mais devagar. O teste manual confere, e a saída é pintar em menos imagens por segundo.
7. **A câmera de um celular em pé** chega estreita, com faixas escuras dos lados, nos quadros de quem está no PC.
