# Starsonic Phone — a correção do FreeSWITCH na troca de tamanho do mosaico — desenho curto

- **Data:** 19/11/2026
- **Status:** aprovado e construído em 19/11. O responsável escolheu, em 18/11 às 15:37, receber a `0.1.0-rc.3` do servidor de vídeo para testar as telas, com esta correção em seguida; deu o "pode seguir" dela em 19/11 às 00:24; e, às 03:50, com este desenho e o plano na mão, respondeu "Continue". O plano é o `docs/superpowers/plans/2026-11-19-video-freeswitch-troca-de-tamanho.md`. As seções 4, 5 e 6 dizem o que mudou do desenho para o que foi construído. No mesmo dia, um revisor de fora leu tudo, e três coisas mudaram por causa dele: uma segunda correção, para o comando da banda (seção 3); as rodadas sem a correção refeitas, com a prova de quantos processadores o FreeSWITCH enxergava (seção 5); e o "mil trocas", que virou "mil pedidos de troca", com um segundo teste que confere cada troca (seção 4).
- **Base:** o risco 11 da spec de 18/11 (`2026-11-18-starsonic-phone-reunioes-palco-design.md`). Este desenho resolve aquele risco.
- **Tamanho:** uma mudança pequena. Dois arquivos de correção para o FreeSWITCH, dois testes novos, e os guias.

## 1. O problema

Desde a etapa do palco, o mosaico muda de tamanho: no começo e no fim de um compartilhamento, e quando o número de pessoas passa de um layout a outro. O agente pede a troca com o comando `vid-res`. No FreeSWITCH 1.11.3, esse comando tem um defeito, com duas formas. A primeira só existe com mais de 2 processadores. A segunda existe sempre.

**Com mais de 2 processadores, a imagem congela.** É o caso do servidor de produção e das máquinas de teste do GitHub.

- O FreeSWITCH usa uma thread para o mosaico e, com mais de 2 processadores, uma thread a mais para cada pessoa (ela põe a câmera da pessoa no mosaico).
- O `vid-res` roda em outra thread, a do comando. Ela segura a trava do mosaico e espera a trava de escrita.
- A thread do mosaico segura a trava de escrita e espera a thread de uma pessoa acabar.
- A thread dessa pessoa espera a trava do mosaico.
- As três ficam esperando uma pela outra enquanto essa pessoa continuar na reunião. A imagem congela para todos os que estão nela. Ninguém vê tela de erro.
- O comando fica sem resposta. O agente fala com o FreeSWITCH por uma ligação só, que atende um comando de cada vez: enquanto esse não responde, o mosaico de nenhuma reunião do servidor se arruma.
- O FreeSWITCH continua de pé, então o serviço não reinicia sozinho.
- Quando aquela pessoa sai da reunião, a thread do mosaico para de esperar por ela, e tudo segue. Ou seja, a imagem só volta depois de alguém sair. De fora, não dá para saber quem.

**Com qualquer número de processadores, o FreeSWITCH pode cair.**

- A thread do comando solta a imagem antiga do mosaico e cria uma nova.
- A thread do mosaico pode estar, nesse instante, codificando a imagem antiga. Ela usa uma imagem que já foi solta.
- Às vezes isso só estraga uma imagem, e o registro mostra um `VPX encode error`. Às vezes o processo cai, e o serviço volta 5 segundos depois.
- A queda só foi vista com 2 processadores. Com 4, o que se viu foi a imagem congelada, em todas as rodadas da bancada e do primeiro teste; uma rodada do segundo teste, mais curta, acabou antes de congelar, só com os erros do codificador (seção 5).

O que foi lido no código do FreeSWITCH (`src/mod/applications/mod_conference/conference_video.c`, no commit do `video-servidor/deps.lock`):

| O quê | Onde |
|---|---|
| O comando solta e cria a imagem, segurando a trava do mosaico | `conference_video_change_res`, linha 3105 |
| Em seguida ele pede a trava de escrita | `conference_video_init_canvas_layers`, linha 1553 |
| A thread do mosaico espera as threads das pessoas, segurando a trava de escrita | `wait_for_canvas`, linha 3050 |
| Ela para de esperar por uma pessoa que já não está na reunião | `wait_for_canvas`, linha 3059 |
| A thread de cada pessoa pede a trava do mosaico | `conference_video_scale_and_patch`, linha 511 |
| A thread do mosaico usa a imagem sem trava nenhuma, ao codificar | `conference_video_muxing_thread_run`, da linha 4069 em diante |

O código oficial do FreeSWITCH de hoje (19/11/2026) tem essa função igual. Não há correção pronta para trazer.

## 2. Os caminhos

**A. A thread do mosaico aplica o tamanho novo (o escolhido).** O comando só anota o tamanho pedido. A thread do mosaico troca a imagem no começo da volta seguinte dela, quando ninguém está usando a imagem. O FreeSWITCH já faz exatamente isso com a troca de layout (`vid-layout`), no mesmo ponto do código. São cerca de 50 linhas, em dois arquivos de um módulo.

- A favor: tira as duas formas do defeito pela raiz, e segue um caminho que o próprio FreeSWITCH já usa e já provou.
- O custo: o tamanho muda até uma imagem depois do comando (0,04 s), e não mais no mesmo instante. A página não percebe: ela já espera a imagem do tamanho novo chegar.

**B. Pôr mais travas na thread do mosaico.** Ela seguraria uma trava enquanto monta e codifica a imagem. Não foi escolhido: o módulo tem muitas travas, tomadas em ordens diferentes por threads diferentes, e uma trava nova, segurada por tanto tempo, pode criar outro travamento como o de hoje.

**C. O agente parar de usar o `vid-res`.** Não serve: o tamanho do mosaico é o sinal que a página usa para saber qual desenho vale (spec de 18/11, seção 6.3).

**D. Limitar o FreeSWITCH a 2 processadores.** Tira o travamento, mas deixa a queda, e joga fora metade da folga do servidor. Não é correção.

## 3. A correção

Em `conference_video.c` e `mod_conference.h`, do módulo `mod_conference`:

1. A estrutura do mosaico ganha dois números: a largura e a altura pedidas e ainda não aplicadas.
2. `conference_video_change_res` (a função do `vid-res`) passa a só anotar esses dois números, com a trava do mosaico. Ela não solta mais a imagem.
3. A thread do mosaico, no começo de cada volta e antes de olhar se há um layout novo, vê se há um tamanho anotado. Se há, ela troca a imagem e refaz as camadas, com as mesmas travas e pelo mesmo caminho da troca de layout.
4. Dois casos continuam como eram, com a troca na hora: um mosaico que ainda não tem a thread dele rodando, e o "super canvas" (um recurso de vários mosaicos, que as reuniões não usam e cuja thread não olha o tamanho anotado).

Se o agente manda o `vid-res` e o `vid-layout` um atrás do outro, como faz hoje, a thread do mosaico quase sempre aplica os dois na mesma volta: primeiro o tamanho, depois o layout. Se o `vid-layout` chega depois de a volta já ter aplicado o tamanho, ele fica para a volta seguinte, 0,04 s depois. É o mesmo estado de passagem que o FreeSWITCH sem a correção já mostrava entre um comando e o outro.

**A segunda correção: o comando da banda.** Em `conference_api.c`, do mesmo módulo. Quem achou foi o revisor de fora, lendo o código, em 19/11.

- O agente manda o `vid-bandwidth` (a banda do mosaico) logo depois do `vid-res`, no começo e no fim de todo compartilhamento de tela.
- Esse comando lia o tamanho e a imagem do mosaico só com a trava dos membros, e não com a do mosaico.
- Sem a primeira correção, isso nunca cruzava com a troca: o `vid-res` trocava a imagem na própria thread do comando, e o agente manda um comando de cada vez. Com a primeira correção, a troca passou para a thread do mosaico, até uma imagem depois, e o `vid-bandwidth` pode chegar bem nessa hora.
- No meio da troca, entre soltar a imagem antiga e pôr a nova, o ponteiro da imagem é nulo. Um `vid-bandwidth` que lesse a imagem nesse instante derrubava o processo. É raro (a janela é o tempo de alocar a imagem nova), mas é a queda de todas as salas, justamente o que esta entrega tira.
- Com a segunda correção, o comando lê o tamanho do mosaico uma vez, com a trava do mosaico, que é a que a troca segura, e não lê mais a imagem. A ordem das travas (a dos membros e, dentro dela, a do mosaico) é a que a thread do mosaico já usa a cada imagem, e com a trava do mosaico na mão o comando só copia dois números.
- Dos comandos que o agente manda (o `vid-res`, o `vid-layout`, o `vid-res-id` e o `vid-bandwidth`), este era o único que lia a imagem do mosaico sem a trava do mosaico. As threads das pessoas leem a imagem com essa trava. A gravação lê só os dois números do tamanho, e as reuniões não gravam.

## 4. O que muda no repositório

- **`video-servidor/freeswitch/patches/freeswitch/0001-mod_conference-tamanho-na-thread-do-mosaico.patch`:** a correção, no formato do `git format-patch`, contra o commit fixado. O `construir.sh` já aplica o que está nessa pasta, o pacote das fontes já a leva junto (a licença do FreeSWITCH pede o código das mudanças), e o cache do build no GitHub já olha para ela. É o primeiro arquivo da pasta.
- **`video-servidor/freeswitch/patches/freeswitch/0002-mod_conference-banda-com-a-trava-do-mosaico.patch`:** a segunda correção (seção 3), no mesmo formato. O `construir.sh` aplica os arquivos da pasta na ordem dos nomes, e o `VERSOES.txt` fica com duas linhas `patch`.
- **`video-servidor/freeswitch/construir.sh`:** o `VERSOES.txt` do pacote passa a ter uma linha para cada correção aplicada (`patch freeswitch 0001-…`, com o SHA-256 do arquivo). Assim dá para ver, num servidor, se o FreeSWITCH instalado é o corrigido. E o build para se a pasta `patches/` tiver qualquer coisa que não seja `patches/<projeto>/<nome>.patch` (uma pasta com outro nome, um arquivo com outra extensão ou fora do lugar): é o jeito de uma correção ficar de fora sem ninguém ver.
- **`video-servidor/freeswitch/conferir-pacote.sh`:** falha se as correções do `VERSOES.txt` do pacote não forem exatamente as da pasta `patches/`, pelo nome e pelo SHA-256. Um pacote montado sem a correção não passa, e um passo do GitHub prova essa recusa.
- **`video-servidor/freeswitch/LEIA-ME-FONTES.txt`:** um parágrafo dizendo que hoje há duas correções, e para quê.
- **`video-servidor/e2e/esforco.spec.ts`** e um ajudante pequeno para falar com o FreeSWITCH: dois testes novos, que ficam para sempre, cada um com duas pessoas na reunião de teste.
  - **Mil pedidos de troca seguidos,** um a cada 0,02 s; no meio deles, uma terceira pessoa entra e sai duas vezes. Com a correção, o FreeSWITCH só anota cada pedido, e a thread do mosaico aplica o último a cada imagem, 25 vezes por segundo. Por isso nem todo pedido vira uma troca, e este teste sozinho não diz quantas trocas houve.
  - **Trezentas trocas conferidas uma a uma.** O teste pede um tamanho e repete, sem pausa, o comando da banda que o agente manda (`vid-bandwidth 3mb '' 1`), até a resposta dele trazer o tamanho pedido: a resposta desse comando diz o tamanho que o mosaico tem. Assim cada troca acontece de verdade antes da seguinte, e o comando da banda corre ao lado da troca, como numa reunião.
  - Os dois falham se um comando ficar 5 s sem resposta ou derrubar a ligação com o FreeSWITCH (e dizem qual dos dois, em qual troca, e se o FreeSWITCH continua de pé), se aparecer um dos dois `VPX encode error` do defeito (o do tamanho e o do formato da imagem), se o agente tiver um comando do mosaico recusado, ou se no fim o tamanho não chegar com as duas câmeras no mosaico. O segundo falha também se um tamanho pedido não valer em 5 s.
  - Levam cerca de meio minuto cada um. No GitHub eles rodam em 4 processadores, a cada mudança. Sem a primeira correção, os dois falharam em todas as rodadas feitas (seção 5). O segundo teste não falha sem a segunda correção: a prova dela é outra (seção 5 e apêndice C).
- **`video-servidor/e2e/ambiente.ts`:** a linha `ambiente no ar`, que cada rodada de ponta a ponta escreve no começo, passa a dizer quantos processadores a máquina tem. O teste de esforço só prova a correção numa máquina com mais de 2, e nada no registro da rodada dizia quantos ela tem.
- **`.gitattributes`:** a pasta `patches/` fica com os bytes exatos, sem troca de fim de linha: são os bytes que o `git apply` lê e que o SHA-256 do pacote confere.
- **Os guias:** o bloco "Um defeito conhecido" do `docs/teste-manual.md` e a entrada "A imagem congelou para todos, ou todos caíram da reunião ao mesmo tempo" do `docs/video-servidor.md` passam a dizer que o defeito foi corrigido na `0.1.0-rc.4`, e o que fazer se algo parecido acontecer mesmo assim. O roteiro ganha a seção 27, com quatro linhas para conferir a correção na VM. A spec de 18/11 marca o risco 11 como resolvido.
- **A versão:** o servidor de vídeo `0.1.0-rc.4`. O chat não muda.

## 5. As provas

As da máquina de desenvolvimento são com o FreeSWITCH de verdade, duas pessoas na reunião de teste e o `vid-res` alternando entre 1920×1620 e 1920×1080. Para o FreeSWITCH usar as threads das pessoas numa máquina de 2 processadores, ele foi enganado para enxergar 4. As primeiras linhas são as do desenho, com um teste de bancada. As que falam do "teste novo" são do primeiro teste do `esforco.spec.ts`, o que ficou no repositório. Até a linha do GitHub, "Corrigido" é o FreeSWITCH só com a primeira correção. Nas linhas dele com um pedido a cada 0,1 s, cada pedido é uma troca (a thread do mosaico aplica o pedido em até 0,04 s); nas de um pedido a cada 0,02 s, os pedidos são mais do que as trocas (seção 4). Depois dela vêm as linhas da revisão: nelas, a prova dos processadores é lida do próprio processo do FreeSWITCH (a biblioteca que o engana e o `mod_conference` em uso), a cada segundo da rodada.

| FreeSWITCH | Processadores que ele enxerga | O que foi pedido | O que aconteceu |
|---|---|---|---|
| Original | 4 | 3.000 trocas, uma a cada 0,1 s | Congelou na troca 65. O processo continuou de pé. |
| Original | 4 | o mesmo | Congelou na troca 10. O retrato das threads mostra as três esperas da seção 1. |
| Original | 4 | o mesmo, e depois as pessoas saem | Congelou na troca 1.138, e o comando ficou 10 s sem resposta. Uma das duas pessoas saiu: a resposta chegou em 0,1 s, e uma reunião nova funcionou em seguida, sem reiniciar nada. |
| Original | 4 | 1.000 trocas, uma a cada 0,02 s (o ritmo do teste novo), em três rodadas, e depois as pessoas saem | Congelou nas trocas 323, 479 e 179, com 20 a 46 `VPX encode error` em cada rodada. Nas três, voltou a funcionar quando a pessoa certa saiu (numa delas, só quando a segunda saiu), e uma reunião nova funcionou sem reiniciar nada. |
| Original | 2 | 3.000 trocas, uma a cada 0,1 s | Em 18/11, caiu depois de 535 trocas. Em 19/11, aguentou as 3.000, com 2 `VPX encode error`. |
| Corrigido | 4 | 3.000 trocas, uma a cada 0,1 s | As 3.000 com `+OK`. Nenhum erro no registro. O mosaico vivo no fim. |
| Corrigido | 2 | 3.000 trocas, uma a cada 0,1 s | As 3.000 com `+OK`. Nenhum erro no registro. O mosaico vivo no fim. |
| Corrigido | 4 | 6.000 trocas, uma a cada 0,02 s | As 6.000 com `+OK`. Nenhum erro no registro. O mosaico vivo no fim. |
| Corrigido | 4 | 300 trocas, uma a cada 0,02 s, e o retrato das threads no fim | As 300 com `+OK`. O retrato mostra uma thread para cada pessoa rodando: o FreeSWITCH corrigido estava mesmo no caminho de mais de 2 processadores. |
| Corrigido | 4 | 1.000 trocas, uma a cada 0,02 s, com uma terceira pessoa entrando e saindo duas vezes no meio | As 1.000 com `+OK`. Nenhum erro no registro. O mosaico vivo no fim, com as duas câmeras. |
| Corrigido | 4 | a suíte inteira de ponta a ponta | Os 33 testes passaram, em 9,8 minutos. O agente não viu o FreeSWITCH cair nem recusar comando. |
| Original | não ficou registrado | o teste novo, em três rodadas | Falhou nas três. Numa, o FreeSWITCH caiu na troca 613. Nas outras duas, os mil pedidos responderam, e o registro ficou com 123 e com 103 erros do codificador. Estas rodadas foram anotadas, na hora, como rodadas com 4 processadores. Nada do que ficou guardado prova isso, e nenhuma congelou: é o resultado das rodadas com 2. As linhas da revisão, no fim da tabela, as refazem com a prova. |
| Corrigido | 4 | o teste novo | Passou, em 26 s. Nenhum erro do codificador no registro. |
| Corrigido | 2 | o teste novo | Passou, em 28 s. Nenhum erro do codificador no registro. |
| Corrigido | 4 | a suíte inteira, com o teste novo | Os 34 testes passaram, em 10,1 minutos. |
| Corrigido | 4, de verdade (as máquinas do GitHub) | os pacotes do Debian 12, do Ubuntu 24.04 e do Ubuntu 26.04 montados do zero com a correção, e a suíte inteira, com o teste novo, em três rodadas | Os três pacotes montaram com a correção, e o `conferir-pacote.sh` achou a correção em cada um e recusou um pacote sem a linha dela. Os 34 testes passaram nas três rodadas, em cerca de 10 minutos cada. Na rodada que já mostra os processadores, o registro diz `4 processadores na máquina`, e o teste novo levou 24 s. |
| Original, montado do mesmo código, com os nomes das funções | 4, com a prova do processo e o retrato das threads (as threads das pessoas estão lá) | o primeiro teste | Congelou: `a troca 167 ficou 5 s sem resposta; o FreeSWITCH continua de pé`. No fim do teste, a saída das pessoas o destravou. |
| Original (o do pacote da `0.1.0-rc.3`) | 4, com a prova do processo | o primeiro teste | Congelou: `a troca 427 ficou 5 s sem resposta; o FreeSWITCH continua de pé`. |
| Original (o do pacote) | 2, com a prova do processo | o primeiro teste | Os mil pedidos responderam. Falhou pelo registro: 231 erros do tamanho da imagem e 1 do formato. |
| Original (o do pacote) | 4, e depois 2 | o segundo teste | Falhou nas duas rodadas, pelo registro: 29 erros do tamanho com 4; 17 do tamanho e 1 do formato com 2. |
| Só com a primeira correção | 4 | o segundo teste | Passou: as 300 trocas conferidas, com 1.680 comandos da banda. Este teste não pega o defeito do comando da banda: só 5 ou 6 comandos cabem em cada troca, e a janela é o tempo de uma alocação. |
| Só com a primeira correção | 4 | a prova do depurador (apêndice C): a thread do mosaico parada no meio da troca por 3 s, e um `vid-bandwidth` chegando | Nesse ponto, o ponteiro da imagem do mosaico é nulo. O FreeSWITCH caiu: `SIGSEGV` em `conference_api_sub_vid_bandwidth`, na linha 1755 do `conference_api.c`, a que lê a imagem. |
| Com as duas correções | 4 | a mesma prova do depurador | O ponteiro é nulo nesse ponto, e nada cai. O comando fica esperando a trava do mosaico (linha 1738) e, quando a troca acaba, responde com o tamanho novo, 1920×1620, 3,0 s depois de mandado. O FreeSWITCH segue de pé. |
| Com as duas correções | 4 | os dois testes | Passaram, em 28 s e em 25 s. As 300 trocas conferidas, com 1.437 comandos da banda. Nenhum erro do defeito no registro. |
| Com as duas correções | 2 | os dois testes | Passaram, em 30 s e em 20 s. As 300 trocas conferidas, com 8.795 comandos da banda. Nenhum erro do defeito no registro. |
| Com as duas correções | 4 | a suíte inteira, com os dois testes | Os 35 testes passaram, em 10,7 minutos. No registro do FreeSWITCH, só as linhas que a suíte já aceita: as seis do banco interno dele e, 14 vezes, o `VPX encode error [8:Invalid parameter:(null)]`, o aviso que uma troca de tamanho normal pode dar (o segundo teste faz 300 trocas de verdade; só com a primeira correção, ele deixou 22). |
| Com as duas correções | 4, de verdade (as máquinas do GitHub) | os três pacotes montados do zero com as duas correções, e a suíte inteira | Os três pacotes montaram com as duas correções, e o `VERSOES.txt` de cada um tem as duas linhas `patch`. O `conferir-pacote.sh` achou as duas em cada pacote, e recusou um pacote sem as linhas delas. Os 35 testes passaram, em 10,1 minutos. O registro diz `4 processadores na máquina`. Os dois testes de esforço levaram 24 s cada um, e o segundo conferiu as 300 trocas com 1.545 comandos da banda. |

**A falha que ficou sem explicação no GitHub em 18/11** combina com a imagem congelada. Lá são 4 processadores. Um teste esperou 20 s pelo tamanho novo do mosaico, que não chegou. Na hora da falha, a página tinha recebido 1.658 pacotes de som (33 s de ligação, a 50 por segundo) e só 474 de vídeo. O mosaico manda pelo menos 25 pacotes de vídeo por segundo, também com as câmeras paradas (medido em 19/11). Então o vídeo tinha parado de chegar havia pelo menos 14 s, com o som chegando normalmente. E os testes seguintes passaram: o teste que falha tira as pessoas da reunião, e o FreeSWITCH segue. Aquela rodada não tem o retrato das threads, que seria a prova.

## 6. Os riscos

1. **A correção é nossa, e não do FreeSWITCH.** Quando o FreeSWITCH do `deps.lock` mudar de versão, a correção pode não encaixar mais. O `construir.sh` para com erro nesse caso, e o teste de esforço diz se a versão nova ainda precisa dela.
2. **O tamanho passa a mudar uma imagem depois do comando.** Nenhuma parte do agente ou da página depende do instante. A suíte inteira roda com a correção para conferir. Dentro do FreeSWITCH, um comando dependia: o `vid-bandwidth`, que o revisor de fora achou e a segunda correção resolve (seção 3).
3. **O teste na máquina de desenvolvimento enganou o FreeSWITCH** para ele enxergar 4 processadores, com 2 de verdade. **Resolvido em 19/11:** o teste de esforço e a suíte inteira passaram no GitHub, em máquinas de 4 processadores de verdade (a última linha da tabela da seção 5).
4. **A segunda correção não tem um teste automático que falhe sem ela.** A janela do defeito é pequena demais para um teste comum acertar: o segundo teste passou sem ela. A prova é a do depurador (apêndice C), para refazer quando o FreeSWITCH do `deps.lock` mudar. O `conferir-pacote.sh` continua garantindo que o pacote leva os dois arquivos.

## 7. O que fica para depois

- Avisar o projeto do FreeSWITCH do defeito e da correção. É um contato com gente de fora: só com o sim do responsável.
- O que o revisor de fora anotou como pequeno, e ficou para depois:
  - o `construir.sh` aceita, sem aplicar, um arquivo de correção com o nome começando por ponto (`.0003-x.patch`);
  - a linha dos processadores do `ambiente.ts` diz o que a máquina tem, e nada falha se um dia o GitHub rodar em 2 (os testes continuariam passando, sem cobrir a imagem congelada);
  - o guia manda rodar o `atualizar` de novo quando falta a linha `patch`; depois de um `atualizar` que terminou bem, a causa seria outra (um pacote publicado sem a correção), e o guia não diz isso;
  - as linhas 27.1 e 27.4 do roteiro são da VM, e têm as caixas do PC e do celular;
  - o GitHub prova a recusa do `conferir-pacote.sh` só para as linhas tiradas; os casos do SHA-256 errado e da linha a mais foram provados à mão, na máquina de desenvolvimento;
  - dois comentários do primeiro arquivo de correção são frouxos ("No muxing thread yet" só acontece depois de a conferência acabar; as camadas são postas com a trava, e sem trava ficam a leitura da imagem e a codificação). Mudá-los muda o arquivo e o apêndice A.

## 8. A suíte inteira com a correção

A suíte de ponta a ponta inteira rodou na máquina de desenvolvimento com o FreeSWITCH corrigido, enxergando 4 processadores: os 33 testes passaram. No registro do FreeSWITCH ficaram só as linhas que a suíte já aceita: as seis do banco interno dele e um `VPX encode error [8:Invalid parameter:(null)]`, que o guia do vídeo já explica e que não é o erro do defeito (o do defeito fala do tamanho ou do formato da imagem). Nas 13.300 trocas das rodadas de esforço com a correção, nenhum `VPX encode error` apareceu. Com o teste novo, a suíte tem 34 testes (seção 5).

## Apêndice A: a primeira correção

É o conteúdo do primeiro arquivo da seção 4, sem o cabeçalho do `git format-patch`. Aplica no commit do FreeSWITCH fixado no `video-servidor/deps.lock`.

```diff
diff --git a/src/mod/applications/mod_conference/conference_video.c b/src/mod/applications/mod_conference/conference_video.c
index 9105605..c43bddb 100644
--- a/src/mod/applications/mod_conference/conference_video.c
+++ b/src/mod/applications/mod_conference/conference_video.c
@@ -3102,6 +3102,21 @@ static void personal_attach(mcu_layer_t *layer, conference_member_t *member)
 	layer->member_id = member->id;
 }
 
+/* Gives the canvas a new size. The caller holds conference->canvas_mutex and canvas->mutex. */
+static void conference_video_apply_res(conference_obj_t *conference, mcu_canvas_t *canvas, int w, int h)
+{
+	canvas->width = w;
+	canvas->height = h;
+	switch_img_free(&canvas->img);
+	canvas->img = switch_img_alloc(NULL, SWITCH_IMG_FMT_I420, canvas->width, canvas->height, 0);
+	conference_video_init_canvas_layers(conference, canvas, canvas->vlayout, SWITCH_TRUE);
+}
+
+/* The muxing thread patches the layers into canvas->img and encodes it without holding canvas->mutex, and with
+   more than 2 CPUs the layer threads patch into it too. Freeing the image from the thread of the API command, as
+   this function used to do, let them use an image that was already freed. While the muxing thread of the canvas
+   runs, the new size is only recorded here: that thread applies it at the top of its loop
+   (conference_video_check_new_res), where nothing is using the image, the same way it applies a new layout. */
 switch_status_t conference_video_change_res(conference_obj_t *conference, int w, int h, int id)
 {
 	mcu_canvas_t *canvas = NULL;
@@ -3109,17 +3124,43 @@ switch_status_t conference_video_change_res(conference_obj_t *conference, int w,
 	switch_mutex_lock(conference->canvas_mutex);
 	canvas = conference->canvases[id];
 	switch_mutex_lock(canvas->mutex);
-	canvas->width = w;
-	canvas->height = h;
-	switch_img_free(&canvas->img);
-	canvas->img = switch_img_alloc(NULL, SWITCH_IMG_FMT_I420, canvas->width, canvas->height, 0);
-	conference_video_init_canvas_layers(conference, canvas, canvas->vlayout, SWITCH_TRUE);
+	if (canvas->video_muxing_thread && id < (int) conference->canvas_count) {
+		canvas->new_width = w;
+		canvas->new_height = h;
+	} else {
+		/* No muxing thread yet, or the super canvas, whose thread does not look for a new size. */
+		conference_video_apply_res(conference, canvas, w, h);
+	}
 	switch_mutex_unlock(canvas->mutex);
 	switch_mutex_unlock(conference->canvas_mutex);
 
 	return SWITCH_STATUS_SUCCESS;
 }
 
+/* The muxing thread calls this at the top of its loop, before it looks for a new layout: a size recorded by
+   conference_video_change_res is applied here. When the API holds conference->canvas_mutex, it waits for the
+   next frame, like the new layout does. */
+static void conference_video_check_new_res(conference_obj_t *conference, mcu_canvas_t *canvas)
+{
+	if (!canvas->new_width || !canvas->new_height) {
+		return;
+	}
+
+	if (switch_mutex_trylock(conference->canvas_mutex) != SWITCH_STATUS_SUCCESS) {
+		return;
+	}
+
+	switch_mutex_lock(canvas->mutex);
+	if (canvas->new_width && canvas->new_height) {
+		int w = canvas->new_width, h = canvas->new_height;
+
+		canvas->new_width = canvas->new_height = 0;
+		conference_video_apply_res(conference, canvas, w, h);
+	}
+	switch_mutex_unlock(canvas->mutex);
+	switch_mutex_unlock(conference->canvas_mutex);
+}
+
 
 void *SWITCH_THREAD_FUNC conference_video_muxing_thread_run(switch_thread_t *thread, void *obj)
 {
@@ -3162,6 +3203,8 @@ void *SWITCH_THREAD_FUNC conference_video_muxing_thread_run(switch_thread_t *thr
 		int j = 0, personal = conference_utils_test_flag(conference, CFLAG_PERSONAL_CANVAS) ? 1 : 0;
 		int video_count = 0;
 
+		conference_video_check_new_res(conference, canvas);
+
 		if (!personal) {
 			if (canvas->new_vlayout && switch_mutex_trylock(conference->canvas_mutex) == SWITCH_STATUS_SUCCESS) {
 				conference_video_init_canvas_layers(conference, canvas, NULL, SWITCH_TRUE);
diff --git a/src/mod/applications/mod_conference/mod_conference.h b/src/mod/applications/mod_conference/mod_conference.h
index e45a921..247d857 100644
--- a/src/mod/applications/mod_conference/mod_conference.h
+++ b/src/mod/applications/mod_conference/mod_conference.h
@@ -574,6 +574,9 @@ typedef struct mcu_canvas_s {
 	codec_set_t *write_codecs[MAX_MUX_CODECS];
 	int write_codecs_count;
 	switch_bool_t disable_auto_clear;
+	/* The size asked by conference_video_change_res that the muxing thread has not applied yet (0: none). */
+	int new_width;
+	int new_height;
 } mcu_canvas_t;
 
 /* Record Node */
```

## Apêndice B: a segunda correção

É o conteúdo do segundo arquivo da seção 4, sem o cabeçalho do `git format-patch`. Aplica depois do primeiro.

```diff
diff --git a/src/mod/applications/mod_conference/conference_api.c b/src/mod/applications/mod_conference/conference_api.c
index 6b76cc4..5f60deb 100644
--- a/src/mod/applications/mod_conference/conference_api.c
+++ b/src/mod/applications/mod_conference/conference_api.c
@@ -1730,9 +1730,18 @@ switch_status_t conference_api_sub_vid_bandwidth(conference_obj_t *conference, s
 		if (conference->canvases[i]) {
 			mcu_canvas_t *canvas = conference->canvases[i];
 			int j;
+			int canvas_w, canvas_h;
+
+			/* The muxing thread may be giving the canvas a new size right now (conference_video_check_new_res):
+			   holding canvas->mutex, it frees canvas->img and allocates another one, and in between the pointer
+			   is NULL. So the size is taken once, under that mutex, and canvas->img is not read here. */
+			switch_mutex_lock(canvas->mutex);
+			canvas_w = canvas->width;
+			canvas_h = canvas->height;
+			switch_mutex_unlock(canvas->mutex);
 
 			for (j = 0; j < canvas->write_codecs_count; j++) {
-				int w = canvas->width, h = canvas->height;
+				int w = canvas_w, h = canvas_h;
 				
 				if ((zstr(group) || !strcmp(group, switch_str_nil(canvas->write_codecs[j]->video_codec_group)))) {
 					switch_core_codec_control(&canvas->write_codecs[j]->codec, SCC_VIDEO_BANDWIDTH,
@@ -1752,13 +1761,13 @@ switch_status_t conference_api_sub_vid_bandwidth(conference_obj_t *conference, s
 
 					if (w && h) {
 						switch_img_free(&canvas->write_codecs[j]->scaled_img);
-						if (w != canvas->img->d_w || h != canvas->img->d_h) {
+						if (w != canvas_w || h != canvas_h) {
 							canvas->write_codecs[j]->scaled_img = switch_img_alloc(NULL, SWITCH_IMG_FMT_I420, w, h, 16);
 						}
 					}
 
 					if (!sdiv && w) {
-						sdiv = (float)canvas->img->d_w / w;
+						sdiv = (float)canvas_w / w;
 					}
 
 					
```

## Apêndice C: a prova do depurador

A prova da segunda correção, para refazer à mão. Precisa do `gdb` e de um `mod_conference` montado com os nomes das funções (o do pacote não os tem).

1. Uma reunião de teste com duas pessoas, no ambiente de ponta a ponta.
2. O `gdb` no processo do FreeSWITCH, com uma parada na linha que põe a imagem nova do mosaico, dentro de `conference_video_apply_res` (a linha 3111 do `conference_video.c` com a primeira correção): nela, a imagem antiga já foi solta e a nova ainda não foi posta.
3. Um `vid-res 1920x1620` pelo ESL. A thread do mosaico para nessa linha, e o `print canvas->img` mostra `0x0`.
4. Um `vid-bandwidth 3mb '' 1` pelo ESL, e o `call (int)usleep(3000000)` no `gdb`: a thread do mosaico fica nesse ponto por 3 s, com as travas dela, e todas as outras threads rodam.
5. Sem a segunda correção, o `gdb` mostra o `SIGSEGV` em `conference_api_sub_vid_bandwidth`. Com ela, os 3 s passam sem sinal nenhum, a thread do comando aparece esperando a trava (`pthread_mutex_lock`, chamado por `conference_api_sub_vid_bandwidth`), e, quando o `gdb` solta o processo, o comando responde com `1920x1620`.

Os sinais de todo dia do FreeSWITCH têm de passar direto pelo `gdb` (`handle all nostop noprint pass`, e depois `handle SIGSEGV stop print`): sem isso, ele para no primeiro `SIGPIPE` de uma ligação do ESL que fechou.
