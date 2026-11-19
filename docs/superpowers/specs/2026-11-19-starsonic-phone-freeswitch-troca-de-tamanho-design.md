# Starsonic Phone — a correção do FreeSWITCH na troca de tamanho do mosaico — desenho curto

- **Data:** 19/11/2026
- **Status:** para o responsável aprovar. Ele escolheu, em 18/11 às 15:37, receber a `0.1.0-rc.3` do servidor de vídeo para testar as telas, com esta correção em seguida, e deu o "pode seguir" dela em 19/11 às 00:24.
- **Base:** o risco 11 da spec de 18/11 (`2026-11-18-starsonic-phone-reunioes-palco-design.md`). Este desenho resolve aquele risco.
- **Tamanho:** uma mudança pequena. Um arquivo de correção para o FreeSWITCH, um teste novo, e os guias.

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
- A queda só foi vista com 2 processadores. Com 4, os mesmos erros de imagem apareceram, mas a imagem congelou antes de o processo cair.

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

Se o agente manda o `vid-res` e o `vid-layout` um atrás do outro, como faz hoje, a thread do mosaico aplica os dois na mesma volta: primeiro o tamanho, depois o layout.

## 4. O que muda no repositório

- **`video-servidor/freeswitch/patches/freeswitch/0001-mod_conference-tamanho-na-thread-do-mosaico.patch`:** a correção, no formato do `git format-patch`, contra o commit fixado. O `construir.sh` já aplica o que está nessa pasta, o pacote das fontes já a leva junto (a licença do FreeSWITCH pede o código das mudanças), e o cache do build no GitHub já olha para ela. É o primeiro arquivo da pasta.
- **`video-servidor/freeswitch/construir.sh`:** o `VERSOES.txt` do pacote passa a ter uma linha para cada correção aplicada (`patch freeswitch 0001-…`). Assim dá para ver, num servidor, se o FreeSWITCH instalado é o corrigido.
- **`video-servidor/freeswitch/conferir-pacote.sh`:** falha se as correções do `VERSOES.txt` do pacote não forem exatamente as da pasta `patches/`. Um pacote montado sem a correção não passa.
- **`video-servidor/freeswitch/LEIA-ME-FONTES.txt`:** uma frase dizendo que hoje há uma correção, e para quê.
- **`video-servidor/e2e/esforco.spec.ts`** e um ajudante pequeno para falar com o FreeSWITCH: um teste novo, que fica para sempre. Duas pessoas na reunião de teste, e 1.000 trocas de tamanho seguidas, uma a cada 0,02 s. Ele falha se um comando ficar 5 s sem resposta (e diz em qual troca, e se o FreeSWITCH continua de pé), se uma resposta não for `+OK`, se aparecer um `VPX encode error`, ou se no fim os dois tamanhos não chegarem com as duas câmeras no mosaico. Leva cerca de meio minuto. No GitHub ele roda em 4 processadores, a cada mudança. Sem a correção, nesse ritmo e com 4 processadores, o FreeSWITCH congelou nas três rodadas feitas, antes da troca 500 (seção 5).
- **Os guias:** o bloco "Um defeito conhecido" do `docs/teste-manual.md` e a entrada "A imagem congelou para todos, ou todos caíram da reunião ao mesmo tempo" do `docs/video-servidor.md` passam a dizer que o defeito foi corrigido na `0.1.0-rc.4`, e o que fazer se algo parecido acontecer mesmo assim. A spec de 18/11 marca o risco 11 como resolvido.
- **A versão:** o servidor de vídeo `0.1.0-rc.4`. O chat não muda.

## 5. As provas

Todas na máquina de desenvolvimento, com o FreeSWITCH de verdade, duas pessoas na reunião de teste e o `vid-res` alternando entre 1920×1620 e 1920×1080. Para o FreeSWITCH usar as threads das pessoas numa máquina de 2 processadores, ele foi enganado para enxergar 4.

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
| Corrigido | 4 | a suíte inteira de ponta a ponta | Os 33 testes passaram, em 9,8 minutos. O agente não viu o FreeSWITCH cair nem recusar comando. |

**A falha que ficou sem explicação no GitHub em 18/11** combina com a imagem congelada. Lá são 4 processadores. Um teste esperou 20 s pelo tamanho novo do mosaico, que não chegou. Na hora da falha, a página tinha recebido 1.658 pacotes de som (33 s de ligação, a 50 por segundo) e só 474 de vídeo. O mosaico manda pelo menos 25 pacotes de vídeo por segundo, também com as câmeras paradas (medido em 19/11). Então o vídeo tinha parado de chegar havia pelo menos 14 s, com o som chegando normalmente. E os testes seguintes passaram: o teste que falha tira as pessoas da reunião, e o FreeSWITCH segue. Aquela rodada não tem o retrato das threads, que seria a prova.

## 6. Os riscos

1. **A correção é nossa, e não do FreeSWITCH.** Quando o FreeSWITCH do `deps.lock` mudar de versão, a correção pode não encaixar mais. O `construir.sh` para com erro nesse caso, e o teste de esforço diz se a versão nova ainda precisa dela.
2. **O tamanho passa a mudar uma imagem depois do comando.** Nenhuma parte do agente ou da página depende do instante. A suíte inteira roda com a correção para conferir.
3. **O teste na máquina de desenvolvimento enganou o FreeSWITCH** para ele enxergar 4 processadores, com 2 de verdade. A prova em 4 processadores de verdade é o teste de esforço rodando no GitHub, antes de a versão ser publicada.

## 7. O que fica para depois

- Avisar o projeto do FreeSWITCH do defeito e da correção. É um contato com gente de fora: só com o sim do responsável.

## 8. A suíte inteira com a correção

A suíte de ponta a ponta inteira rodou na máquina de desenvolvimento com o FreeSWITCH corrigido, enxergando 4 processadores: os 33 testes passaram. No registro do FreeSWITCH ficaram só as linhas que a suíte já aceita: as seis do banco interno dele e um `VPX encode error [8:Invalid parameter:(null)]`, que o guia do vídeo já explica e que não é o erro do defeito (o do defeito fala do tamanho ou do formato da imagem). Nas 12.300 trocas das rodadas de esforço com a correção, nenhum `VPX encode error` apareceu.

## Apêndice: a correção

É o conteúdo do arquivo da seção 4, sem o cabeçalho do `git format-patch`. Aplica no commit do FreeSWITCH fixado no `video-servidor/deps.lock`.

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
