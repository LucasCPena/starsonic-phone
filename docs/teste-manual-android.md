# Teste manual do Starsonic Phone (Android)

Faça este roteiro antes de cada versão estável (spec §11.3), com a versão candidata (`android-vX.Y.Z-rc.N`). Use pelo menos dois celulares de marcas diferentes (ex.: Samsung e Motorola; um Xiaomi, se houver), com o Android 9 ou mais novo (de preferência um deles com o Android 14 ou mais novo), e dois ramais de teste: um num servidor por UDP e outro num servidor por TCP. Para as seções 11 a 15 (a 0.2), mais dois ramais de teste na mesma central do ramal do celular (veja a seção 11). Ramais e senhas de teste ficam fora do repositório. Para as ligações, tenha à mão outro telefone (o outro ramal, o Starsonic Phone no PC ou um celular comum).

Marque cada linha nas colunas A1 e A2 (um celular em cada); na seção 3, faça cada linha no Wi-Fi e no 4G (desligue o Wi-Fi para o 4G). Se algo não sair como o esperado, anote a versão, o celular, o passo e o que apareceu (de preferência com um print da tela) e mande o diagnóstico (Menu → Sobre → Enviar diagnóstico).

Versão testada: `__________`  Data: `__________`  Quem testou: `__________`

A1 (marca, modelo, Android): `__________`  A2: `__________`

## 1. Instalação pelo link e permissões

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 1.1 | No navegador do celular, abra a página do release no GitHub (`…/releases/tag/android-v<versão>`), baixe `StarsonicPhone-android-<versão>.apk` e abra o arquivo. | O Android avisa que o app vem de fora da loja e pede para permitir que o navegador instale apps ("Instalar apps desconhecidos"); depois de permitir, pede a confirmação da instalação. Se o Play Protect avisar que não conhece o app, "Mais detalhes" → "Instalar assim mesmo". | ☐ | ☐ |
| 1.2 | Termine a instalação e procure o app na tela inicial e na lista de apps. | Ícone azul com o fone branco e o anel ciano, com "Starsonic" embaixo. Em Configurações → Apps, o nome é "Starsonic Phone". | ☐ | ☐ |
| 1.3 | Abra o app. | Abertura azul com o ícone e depois a tela Entrar, em pé, com o logo no cartão branco. | ☐ | ☐ |
| 1.4 | Depois do primeiro Entrar (seção 2), siga a tela Permissões: "Permitir" em cada item e, no fim, "Continuar". | Notificações, microfone, tela cheia (Android 14 ou mais novo, quando o Android pedir) e uso de bateria sem restrição, cada um pela janela do próprio Android. Depois, o Teclado. | ☐ | ☐ |
| 1.5 | Num Xiaomi, Redmi ou POCO, ou num Samsung: siga o passo a passo da tela Permissões com "Abrir ajustes". | Xiaomi: ativar "Início automático" e, em "Economia de bateria", escolher "Sem restrições". Samsung: "Bateria" → "Sem restrições". Os nomes batem com os do MIUI/HyperOS ou do One UI do aparelho (anote os que não baterem). | ☐ | ☐ |
| 1.6 | Nas configurações do Android, tire uma de cada vez: as notificações, o microfone, a tela cheia e a isenção de bateria; volte ao app depois de cada uma. No fim, conceda tudo de novo. | A faixa mostra um aviso por vez, nesta ordem: "Permita as notificações para receber ligações.", "Permita o microfone para fazer e receber ligações.", "Permita a tela cheia para ver as ligações com o celular bloqueado.", "Libere o uso de bateria para receber ligações com o app fechado.". O botão "Abrir ajustes" abre o ajuste certo. | ☐ | ☐ |

## 2. Entrar

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 2.1 | Olhe a tela Entrar. | "Servidor (endereço ou IP)" com o "Protocolo" ao lado (UDP marcado), "Ramal", "Senha" (com o botão de mostrar), "Entrar" e "Precisa de ajuda? (11) 5060-3000". Nenhum outro campo técnico (porta, proxy, codecs etc.). | ☐ | ☐ |
| 2.2 | Toque em "Precisa de ajuda? (11) 5060-3000". | O discador do celular abre com o número. | ☐ | ☐ |
| 2.3 | Toque em Entrar: com o Servidor vazio; com o endereço e a porta (ex.: `starcloud1-starsonic.com.br:5060`); com o ramal com espaço no meio (ex.: `20 01`); e com a senha vazia. | "Digite o endereço do servidor."; "Digite só o endereço do servidor, como starcloud1-starsonic.com.br."; "Digite só o número do ramal."; "Digite a senha." | ☐ | ☐ |
| 2.4 | Ramal certo com a senha errada. | "Ramal ou senha incorretos." e a tela continua aberta. | ☐ | ☐ |
| 2.5 | Endereço que não existe (ex.: `starcloud9-starsonic.com.br`). | "Não foi possível falar com o servidor. Confira o endereço e a sua internet." | ☐ | ☐ |
| 2.6 | No modo avião, tente entrar. | Uma mensagem de erro da tabela 11.1 (em geral "Não foi possível falar com o servidor. Confira o endereço e a sua internet."), sem código técnico além do "(código n)" previsto. | ☐ | ☐ |
| 2.7 | Internet de volta: entre com o ramal do servidor por UDP (Protocolo UDP), com espaços nas pontas e letras maiúsculas no endereço (ex.: ` Starcloud1-Starsonic.com.br `). | A tela Permissões (no primeiro Entrar) e depois o Teclado, com "Conectado · <ramal>" na faixa. Na gaveta de notificações, a notificação fixa "Conectado (ramal <ramal>)", com "Starsonic Phone" no cabeçalho. | ☐ | ☐ |
| 2.8 | Menu (⋮) → Editar conta: entre com o ramal do servidor por TCP, com o Protocolo TCP. Depois, abra o Editar conta de novo e volte. | O Editar abre com o servidor, o protocolo e o ramal preenchidos e a senha vazia. Depois de Entrar: "Conectado · <ramal TCP>". No Editar seguinte, o Protocolo aparece como TCP. | ☐ | ☐ |
| 2.9 | No PABX (ou com o fornecedor), confira o User-Agent do registro. | `Starsonic Phone Android/<versão>`, e o servidor aceita o registro. Se a plataforma filtrar esse User-Agent, anote (o plano B é usar o do Windows). | ☐ | ☐ |

## 3. Ligar e receber

Faça cada linha no Wi-Fi e no 4G. A conta fica conectada com o processador acordado (decisão 6 da spec), também com a tela apagada.

| # | Passo | Resultado esperado | A1 Wi-Fi | A1 4G | A2 Wi-Fi | A2 4G |
|---|-------|--------------------|----------|-------|----------|-------|
| 3.1 | Com o app aberto, ligue pelo Teclado para outro ramal e para um número externo. | Chama, completa e o áudio passa nos dois sentidos. O botão Ligar é verde. A tela apaga ao encostar no rosto e volta ao afastar. | ☐ | ☐ | ☐ | ☐ |
| 3.2 | Com o app aberto, receba uma ligação. | Toca e mostra o nome do contato do celular, ou o número (e o nome, se o PABX mandar), com "Recusar" em vermelho e "Atender" em verde. Atende, e o áudio passa. | ☐ | ☐ | ☐ | ☐ |
| 3.3 | Saia do app (botão de início), use o celular e receba uma ligação. | A notificação de ligação aparece no alto da tela, com "Atender" e "Recusar"; atender abre a tela de chamada. | ☐ | ☐ | ☐ | ☐ |
| 3.4 | Tire o app da lista de apps recentes e receba uma ligação. | Toca do mesmo jeito; a notificação fixa continua. | ☐ | ☐ | ☐ | ☐ |
| 3.5 | Com a tela bloqueada, e depois com a tela apagada, receba uma ligação. | Tela cheia por cima da tela bloqueada, com "Atender" e "Recusar"; atende sem desbloquear. | ☐ | ☐ | ☐ | ☐ |
| 3.6 | Deixe o celular parado, com a tela apagada, por 1 hora, sem abrir o app. Ligue para o ramal. | Toca. | ☐ | ☐ | ☐ | ☐ |
| 3.7 | Reinicie o celular e desbloqueie, sem abrir o app. Ligue para o ramal. | A notificação fixa volta sozinha depois do primeiro desbloqueio, e a ligação toca. | ☐ | ☐ | ☐ | ☐ |
| 3.8 | Receba uma ligação com o celular no modo normal, no vibrar, no silencioso e no Não perturbe. | Toca e vibra conforme o modo do celular, como uma ligação comum. | ☐ | ☐ | ☐ | ☐ |
| 3.9 | Com uma ligação tocando, aperte o botão de volume. | O toque para, e o aviso no alto da tela continua. | ☐ | ☐ | ☐ | ☐ |
| 3.10 | Com uma ligação tocando, abra a cortina de notificações. | Anote se o toque para. | ☐ | ☐ | ☐ | ☐ |
| 3.11 | Deixe uma ligação tocar até o outro lado desistir. | Notificação "Ligação perdida de <contato ou número>" e a ligação no Recentes como perdida. | ☐ | ☐ | ☐ | ☐ |
| 3.12 | Recuse uma ligação. | Quem liga ouve ocupado; a ligação entra no Recentes como perdida. | ☐ | ☐ | ☐ | ☐ |
| 3.13 | No Recentes, toque numa ligação. | Liga de volta. O Recentes mostra número, data, hora e duração, das mais novas para as mais antigas. | ☐ | ☐ | ☐ | ☐ |
| 3.14 | Durante uma ligação, toque em "Transferir" e digite outro ramal do mesmo PABX com separadores (ex.: para o 2003, `20.03`, `20-03` ou `(20) 03`; dá para colar também). Toque em "Transferir". | A ligação passa para o ramal digitado: o app manda só o que importa (sem espaços, traços, pontos e parênteses). Se o PABX do teste não aceitar transferência, anote e pule. | ☐ | ☐ | ☐ | ☐ |
| 3.15 | Ligue para um ramal ocupado, para um número que não existe e para um que não atende. | A tela de chamada mostra por 2 s "Ocupado", "Número não encontrado" ou "Não atendeu" (outros códigos: "Não foi possível completar a ligação (código <n>)."). | ☐ | ☐ | ☐ | ☐ |
| 3.16 | Android 14 ou mais novo: com a tela apagada, atenda uma ligação pelo botão do fone Bluetooth, sem abrir a tela de chamada. | Anote se o outro lado ouve (o Android pode recusar o microfone com o app em segundo plano). | ☐ | ☐ | ☐ | ☐ |

## 4. Troca de rede e sem internet

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 4.1 | Sem ligação, troque do Wi-Fi para o 4G e depois de volta; em cada rede, ligue para o ramal. | O status volta a "Conectado · <ramal>" sozinho, e a ligação toca nas duas redes. | ☐ | ☐ |
| 4.2 | Com uma ligação em andamento, troque do Wi-Fi para o 4G. | Anote o que acontece (a ligação pode cair, o que é aceito na etapa 1). O registro volta sozinho. | ☐ | ☐ |
| 4.3 | Ligue o modo avião por 1 minuto e desligue. | Durante: a faixa e a notificação fixa mostram "Sem internet". Depois: "Conectado · <ramal>", sem fazer nada. | ☐ | ☐ |
| 4.4 | Com o modo avião ligado, tente ligar. | "Sem conexão com o servidor. Tente de novo em instantes." e o app não liga. | ☐ | ☐ |

## 5. Durante a ligação

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 5.1 | Mudo; depois, tire o mudo. | O outro lado deixa de ouvir e volta a ouvir. | ☐ | ☐ |
| 5.2 | Viva-voz. Com um fone Bluetooth conectado, escolha "Celular", "Viva-voz" e "Bluetooth". | O áudio sai por onde foi escolhido; no Bluetooth, os dois lados se ouvem. | ☐ | ☐ |
| 5.3 | Espera; depois, Retomar. | O outro lado ouve a espera; o áudio volta ao retomar. | ☐ | ☐ |
| 5.4 | Transferir para outro ramal (digite o número). | A ligação passa para o outro ramal; no app, ela termina quando o PABX aceita a transferência. | ☐ | ☐ |
| 5.5 | Ligue para uma URA e use o Teclado da ligação. | A URA reconhece as teclas. | ☐ | ☐ |
| 5.6 | Desligar. | A ligação termina e entra no Recentes com a duração. | ☐ | ☐ |

## 6. Duas ligações por vez e as ligações do celular

A partir da 0.2 o ramal recebe uma segunda ligação (seção 11); a terceira ouve ocupado. Com uma ligação do celular (da operadora) em andamento, o ramal continua dando ocupado.

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 6.1 | Durante uma ligação do ramal, ligue para o ramal de outro telefone. | Toca como segunda ligação (a faixa, seção 11); a primeira continua. Com duas ligações já no celular, a terceira ouve ocupado (11.12). | ☐ | ☐ |
| 6.2 | Durante uma ligação do celular (da operadora), ligue para o ramal. | Quem liga ouve ocupado; a ligação entra no Recentes como perdida. | ☐ | ☐ |
| 6.3 | Durante uma ligação do ramal, receba uma ligação do celular. | Anote o que acontece. | ☐ | ☐ |
| 6.4 | Com uma ligação do ramal tocando, receba uma ligação do celular. | Anote o que acontece. | ☐ | ☐ |
| 6.5 | Atenda a ligação do celular durante uma do ramal. | A do ramal vai para a espera ("Em espera"; o outro lado ouve a espera) e continua. Quando a do celular acaba: anote se ela volta sozinha ou se precisa de Retomar (15.4). | ☐ | ☐ |
| 6.6 | Com uma ligação do celular em andamento, tente ligar pelo app. | "Termine a ligação do celular para ligar pelo ramal." por 2 s, e o app não liga. | ☐ | ☐ |

## 7. Atualização de uma versão de teste para a seguinte

Use duas rc seguidas: a anterior, já publicada (ex.: `android-v0.1.0-rc.1`), e a seguinte (ex.: `android-v0.1.0-rc.2`). As rc procuram atualização no pre-release fixo `canal-teste-android`, que o workflow `android-release` atualiza a cada rc. Faça num Android 11 ou mais novo e, se houver, num Android 9 ou 10.

A ordem dos passos importa, por causa da regra das 24 h:

- Ao abrir, o app só confere o canal se a última verificação tem mais de 24 h. A primeira abertura depois de instalar sempre confere.
- A verificação conta (e o aviso só volta 24 h depois) quando o canal responde sem versão nova, quando a pessoa toca em "Agora não" (ou fecha o aviso) e quando toca em "Atualizar" com uma ligação em andamento ou com o download começando.
- Por isso, publique a rc seguinte **antes** de instalar a anterior: aberta com o canal ainda na anterior, ela só veria o aviso 24 h depois.
- Cada vez que o roteiro pede o aviso de novo, desinstale o app e instale a rc anterior outra vez. Isso zera a verificação, mas também apaga a conta (entre de novo), tira as permissões do app (depois de entrar, siga a tela Permissões de novo: sem a de notificações, por exemplo, a notificação do 7.11 não sai) e tira a permissão de instalar apps (o primeiro "Atualizar" depois disso leva de novo ao ajuste do Android).

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 7.1 | Publique a rc seguinte (tag `android-v…-rc.N+1`, ou Actions → android-release → Run workflow) e espere o workflow terminar. | O release da rc nova e o `canal-teste-android` têm o APK e o `versao-android.json` dela. | ☐ | ☐ |
| 7.2 | Desinstale o app (se estiver instalado) e instale a rc anterior pelo link da página dela (`…/releases/tag/android-v…-rc.N`). Abra, entre com o ramal e siga a tela Permissões. | Na tela principal, o aviso "Nova versão do Starsonic Phone disponível (<rc nova>). Atualizar agora?", com as notas, "Atualizar" e "Agora não". | ☐ | ☐ |
| 7.3 | Toque em "Agora não". Tire o app da lista de apps recentes e abra de novo. | O aviso sai e não volta (só 24 h depois). Menu → Sobre mostra a rc anterior. | ☐ | ☐ |
| 7.4 | Desinstale o app, instale a rc anterior de novo, abra, entre e siga a tela Permissões. Com o aviso na tela, receba uma ligação no ramal e atenda; com ela em andamento, volte ao app pelo ícone e toque em "Atualizar". Depois, desligue. | O aviso aparece de novo depois da reinstalação. Com a ligação: "Termine a chamada para atualizar." e nada mais acontece; depois da ligação, o aviso não volta. | ☐ | ☐ |
| 7.5 | Desinstale o app, instale a rc anterior de novo, abra, entre e siga a tela Permissões. Toque em "Atualizar". | O Android abre "Instalar apps desconhecidos" do Starsonic Phone (a reinstalação tirou a permissão). | ☐ | ☐ |
| 7.6 | Permita. No Android 11 ou mais novo, o app fecha: abra-o de novo. No Android 9 ou 10, volte ao app. | O aviso continua (no Android 11 ou mais novo, ele volta quando o app abre). | ☐ | ☐ |
| 7.7 | Ligue o modo avião e toque em "Atualizar". Depois, desligue o modo avião. | "Não foi possível baixar a atualização. Tentaremos de novo mais tarde.", e o app continua funcionando. O aviso não volta. | ☐ | ☐ |
| 7.8 | Desinstale o app, instale a rc anterior de novo, abra, entre e siga a tela Permissões. Toque em "Atualizar", permita a instalação de apps (como em 7.5 e 7.6) e, com o aviso de volta, toque em "Atualizar" de novo. | "Baixando atualização…" e depois a confirmação do Android; confirme a atualização. | ☐ | ☐ |
| 7.9 | Sem abrir o app, ligue para o ramal. Depois, abra o app e o Menu → Sobre. | A notificação fixa voltou sozinha depois da atualização, e a ligação toca. O Sobre mostra a rc nova; a conta continua lá, sem pedir a senha. | ☐ | ☐ |
| 7.10 | Menu → Sobre → Enviar diagnóstico. | As linhas "atualização:" estão no arquivo, sem endereços assinados (nada de `X-Amz-` ou `token=`). | ☐ | ☐ |
| 7.11 | (Opcional) Desinstale o app, instale a rc anterior de novo, abra, entre e siga a tela Permissões (a de notificações é a que importa aqui); sem responder ao aviso, saia do app (botão de início) e espere mais de 24 h. | A notificação "Atualizações" com a pergunta; tocar nela abre o app com o aviso. | ☐ | ☐ |
| 7.12 | (Quando houver versão estável) Com uma versão estável instalada (ex.: `0.1.0`), publique uma rc. | Nenhum aviso: a versão estável só olha o `canal-android`. | ☐ | ☐ |

## 8. Bateria

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 8.1 | Com a conta conectada e tudo concedido, carregue até 100 % e deixe o celular 24 h em espera, no uso normal do dia. Anote a carga no começo e no fim e o consumo do Starsonic Phone em Configurações → Bateria. | A1: `____` % em 24 h (app: `____` %). A2: `____` % em 24 h (app: `____` %). O responsável aprova o consumo (spec §3). | ☐ | ☐ |

## 9. Conta, menu e Sobre

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 9.1 | Toque no menu (⋮) da faixa. | "Editar conta", "Sair da conta" e "Sobre". | ☐ | ☐ |
| 9.2 | Abra o Sobre. | "Starsonic Phone <versão>", "Licença GPL v3", "Usa o PJSIP (GPL v2 ou posterior) e o Opus (BSD).", o site, o WhatsApp, o telefone de suporte, o link do código-fonte e "Enviar diagnóstico". | ☐ | ☐ |
| 9.3 | No Sobre, toque no site, no WhatsApp, no telefone e no link do código-fonte. | O site abre no navegador; o wa.me abre o WhatsApp; o discador abre com (11) 5060-3000; o código-fonte abre no GitHub. | ☐ | ☐ |
| 9.4 | "Enviar diagnóstico" para o WhatsApp e, depois, para o Gmail. | O anexo chega e abre; a senha do ramal não aparece nele. | ☐ | ☐ |
| 9.5 | Durante uma ligação, Menu → Editar conta e toque em Entrar. | A ligação cai e vai para o Recentes; a conta registra de novo. | ☐ | ☐ |
| 9.6 | Menu → Sair da conta; toque em "Cancelar"; depois, Sair da conta de novo e "Sair". | Pede confirmação: "Sair da conta?" — "Este celular deixa de receber as ligações do ramal. Para entrar de novo, você vai precisar da senha.". "Cancelar" não muda nada; "Sair" volta à tela Entrar, a notificação fixa some e o Recentes continua. | ☐ | ☐ |
| 9.7 | Durante uma ligação, Menu → Sair da conta → "Sair". | A ligação termina, e o app volta à tela Entrar. | ☐ | ☐ |
| 9.8 | Troque a senha do ramal no PABX com o app na frente; repita com o app em segundo plano (a recusa chega na renovação do registro, em até 5 min). | A tela Entrar abre com "Ramal ou senha incorretos." (com o app em segundo plano, quando ele é aberto). | ☐ | ☐ |
| 9.9 | Android 12 ou mais novo: transfira os dados para um celular novo (pela cópia do Android/Google ou pelo cabo do fabricante) e abra o app no celular novo. | A conta não vai junto: o app abre na tela Entrar. | ☐ | ☐ |

## 10. Marca

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 10.1 | Passe por todas as telas, avisos e notificações. | "MicroSIP" não aparece em lugar nenhum. | ☐ | ☐ |
| 10.2 | Use o app com o celular no modo claro e no escuro. | O app segue o modo do celular; a faixa azul com "starsonic" em branco e ciano e o logo da tela Entrar não mudam. Ligar e Atender em verde; Recusar e Desligar em vermelho. | ☐ | ☐ |
| 10.3 | Com os ícones temáticos ligados (Android 13 ou mais novo), olhe o ícone na tela inicial; olhe também o ícone da notificação fixa. | O ícone temático (de uma cor só) e o da notificação (só branco) aparecem completos. | ☐ | ☐ |

## 11. Segunda ligação (0.2)

Para as seções 11 a 15, mais dois ramais de teste na mesma central do ramal do celular, cada um num telefone à mão (o Starsonic Phone no PC, um ATA ou outro celular): um faz de **cliente** e o outro de **colega**. Antes de começar, confirme com a Starsonic que a central entrega uma segunda ligação a um ramal que já está numa ligação (o limite de chamadas do ramal precisa ser 2 ou mais); se a central der ocupado na segunda, nada desta seção é do app — anote e peça o ajuste na central.

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 11.1 | Com o app aberto, numa ligação com o cliente, receba a ligação do colega. | A faixa "Ligação de <nome ou número>" no alto da tela de chamada, com Atender e Recusar; em vez do toque, um bipe curto repetido (chamada em espera) e a vibração. A conversa com o cliente continua. | ☐ | ☐ |
| 11.2 | Toque em Atender na faixa. | O colega vira a ligação de cima (com o tempo); o cliente fica no cartão de baixo, "Em espera", e ouve a espera. Os botões passam a ser Mudo, Teclado, Viva-voz, Espera, Transferir, Alternar e Juntar; Nova ligação não aparece com duas ligações. | ☐ | ☐ |
| 11.3 | Toque em Alternar, duas vezes. | Os cartões trocam de lugar; quem está em cima tem o som e o outro ouve a espera. | ☐ | ☐ |
| 11.4 | Toque em Desligar com o colega em cima. | A ligação do colega acaba e a do cliente volta sozinha: o cartão "Em espera" some, o cliente fica em cima e o áudio volta sem tocar em nada. | ☐ | ☐ |
| 11.5 | Numa ligação, receba a segunda e toque em Recusar na faixa. | O colega ouve ocupado; a ligação entra no Recentes como perdida, sem notificação; a do cliente continua sem mudança. | ☐ | ☐ |
| 11.6 | Numa ligação, receba a segunda e deixe o colega desistir. | A faixa some; notificação "Ligação perdida de <contato ou número>" e a ligação no Recentes como perdida. | ☐ | ☐ |
| 11.7 | Saia do app (botão de início) numa ligação e receba a segunda. | A notificação de ligação aparece no alto (sem tela cheia, porque já há uma ligação), com o bipe de chamada em espera; Atender abre a tela de chamada com os dois cartões. | ☐ | ☐ |
| 11.8 | Numa ligação, receba a segunda e, com ela ainda tocando, o cliente desliga. | A segunda passa a tocar como uma ligação normal (toque completo e, com o app fora da tela, a tela cheia). | ☐ | ☐ |
| 11.9 | Numa ligação com o cliente, toque em Nova ligação, digite o ramal do colega (ou toque numa sugestão de contato) e toque em Ligar. | O cliente vai para a espera ("Em espera"); o teclado abre com as sugestões de contatos ao digitar; o cartão de cima mostra "Chamando…" até o colega atender. Enquanto chama, Alternar fica desabilitado. | ☐ | ☐ |
| 11.10 | Com as duas em andamento, o cliente (o de baixo, em espera) desliga. | O cartão de baixo some com "<nome ou número> desligou" por 2 s; a ligação de cima continua. | ☐ | ☐ |
| 11.11 | Com as duas em andamento, o colega (o de cima, ativo) desliga. | A ligação de cima acaba e a de baixo volta sozinha, com o áudio. | ☐ | ☐ |
| 11.12 | Com as duas em andamento, ligue para o ramal de um terceiro telefone. | O terceiro ouve ocupado; a ligação entra no Recentes como perdida e as duas continuam. | ☐ | ☐ |
| 11.13 | Com uma ligação só, em espera (botão Espera), receba a segunda. | A faixa aparece e Atender funciona: a nova fica em cima, a outra continua em espera. | ☐ | ☐ |
| 11.14 | Com uma ligação chamando (antes de o outro lado atender), receba uma ligação. | Quem liga ouve ocupado e a ligação entra no Recentes como perdida; a que chama continua. | ☐ | ☐ |

## 12. Transferência com consulta (0.2)

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 12.1 | Numa ligação com o cliente, toque em Transferir. | O campo do número com a busca nos contatos e os botões Consultar e Transferir agora. | ☐ | ☐ |
| 12.2 | Digite o ramal do colega e toque em Consultar. | O cliente vai para o cartão de baixo, "Em espera · transferência", e ouve a espera; o colega chama em cima ("Chamando…"); os botões são Cancelar e Alternar (Alternar desabilitado até o colega atender). | ☐ | ☐ |
| 12.3 | O colega atende. Fale com ele e toque em Concluir transferência. | Com o colega em cima, os botões são Concluir transferência, Alternar e Cancelar. Ao concluir, as duas ligações saem do celular e a tela de chamada fecha; na central (ou nos dois telefones), o cliente e o colega ficam falando entre si. Anote se "<nome ou número> desligou" piscar por um instante antes de a tela fechar (depende da ordem em que a central desliga as duas; o resultado final tem de ser o mesmo). | ☐ | ☐ |
| 12.4 | Repita a consulta e toque em Alternar com o colega em cima; depois, Concluir transferência com o cliente em cima. | Alternar volta a falar com o cliente (o colega fica "Em espera"); Concluir funciona de qualquer um dos dois lados. | ☐ | ☐ |
| 12.5 | Repita a consulta e toque em Cancelar com o colega em linha. | A ligação do colega acaba e o cliente volta sozinho, sem o rótulo de transferência. | ☐ | ☐ |
| 12.6 | Repita a consulta e deixe o colega não atender (ou recuse no telefone dele). | O app volta ao cliente sozinho e mostra "<nome ou número do colega>: Não atendeu" (ou "Ocupado") por 2 s. | ☐ | ☐ |
| 12.7 | Repita a consulta e, com o colega em linha, o cliente desliga. | A consulta vira uma ligação normal com o colega: o rótulo sai, "<nome ou número> desligou" por 2 s, e a conversa com o colega continua. | ☐ | ☐ |
| 12.8 | Transferir → Transferir agora para um ramal que exista; depois, para um que não exista (ou que a central recuse). | O primeiro passa como na etapa 1 (a ligação sai do celular). O segundo: "O servidor não aceitou a transferência." por 2 s e a ligação continua. | ☐ | ☐ |
| 12.9 | Com duas ligações em andamento (sem consulta), toque em Transferir. | Só Transferir agora: Consultar fica desabilitado (já há duas ligações). | ☐ | ☐ |
| 12.10 | Repita a consulta e, com o colega chamando (sem atender), toque em Cancelar. | O colega para de chamar e o cliente volta sozinho. | ☐ | ☐ |

## 13. Conferência (0.2)

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 13.1 | Com o cliente e o colega em andamento (um em espera), toque em Juntar. | A tela vira "Conferência", com os dois nomes ou números e o tempo desde o Juntar; os três se ouvem. Os botões: Mudo, Teclado, Viva-voz, Separar e Desligar. | ☐ | ☐ |
| 13.2 | Fale os três por um minuto. Toque em Mudo e fale. | Ninguém ouve o celular enquanto está no mudo; os outros dois continuam se ouvindo. | ☐ | ☐ |
| 13.3 | Toque em Separar. | A tela volta aos dois cartões: a última ligação que entrou fica "Em espera" e a outra em cima, com o som. Juntar de novo refaz a conferência. | ☐ | ☐ |
| 13.4 | Na conferência, o colega desliga. | "<nome ou número> desligou" por 2 s e a ligação com o cliente continua como uma ligação normal, com o som. | ☐ | ☐ |
| 13.5 | Na conferência, toque em Desligar. | As duas ligações acabam (os dois telefones ouvem o fim) e a tela de chamada fecha; as duas entram no Recentes com a duração. | ☐ | ☐ |
| 13.6 | Na conferência, use o Teclado da ligação numa URA (um dos dois é uma URA). | Anote o que acontece: as teclas vão só para a ligação de cima. | ☐ | ☐ |
| 13.7 | Durante uma consulta (seção 12), procure o botão Juntar. | Não aparece: antes, Cancelar ou Concluir transferência. | ☐ | ☐ |
| 13.8 | Na conferência, olhe a notificação na gaveta. | A notificação fixa continua "Conectado (ramal <ramal>)"; nenhuma notificação do app Telefone do celular aparece por causa da conferência. | ☐ | ☐ |

## 14. Contatos (0.2)

Antes: grave no celular um contato com o número de um ramal de teste (sem DDD), um com um número externo com DDD (ex.: `(11) 5060-3000`) e um com o mesmo número externo com "+55" (ex.: `+55 11 5060-3000`), e um contato com dois números.

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 14.1 | Abra a aba Contatos pela primeira vez e negue a permissão. | A janela do Android pede a permissão de contatos. Negada: o aviso "Permita o acesso aos contatos para ligar pelo nome." com o botão Permitir. Teclado e Recentes continuam funcionando só com números. | ☐ | ☐ |
| 14.2 | Toque em Permitir e conceda. (Se o Android não perguntar mais, o botão abre os ajustes do app: conceda lá e volte.) | A lista dos contatos do celular em ordem alfabética, com nome e números, e o campo "Buscar contato" em cima. | ☐ | ☐ |
| 14.3 | Busque por parte do nome e por parte do número. | A lista filtra nos dois casos. | ☐ | ☐ |
| 14.4 | Toque no contato do ramal de teste. | Liga para o ramal, sem prefixo (número curto). | ☐ | ☐ |
| 14.5 | Toque no contato externo com DDD e, depois, no com "+55". | Os dois ligam para o mesmo número: o "+55" sai e fica DDD + número (e o prefixo de linha externa na frente, se a central da Starsonic exigir e ele estiver no perfil). Confira na central o número discado. | ☐ | ☐ |
| 14.6 | Toque no contato com dois números. | A escolha do número; cada um liga. | ☐ | ☐ |
| 14.7 | Receba uma ligação do ramal gravado como contato, com o app na frente e com o app fora da tela; deixe uma tocar até perder. | O nome do contato (no lugar do número) na tela de chamada, na notificação de ligação, na notificação "Ligação perdida de <contato>" e no Recentes. | ☐ | ☐ |
| 14.8 | No Teclado, digite os primeiros dígitos do número de um contato. | Até três sugestões (nome e número) abaixo do número; um toque preenche o número já pronto para discar (sem o "+55"). | ☐ | ☐ |
| 14.9 | Numa ligação, receba a segunda do ramal gravado como contato. | A faixa "Ligação de <nome do contato>". | ☐ | ☐ |
| 14.10 | Nas configurações do Android, tire a permissão de contatos e volte ao app. | A aba Contatos mostra o aviso e o botão de novo; o resto do app segue; os Recentes voltam a mostrar os números. | ☐ | ☐ |
| 14.11 | Menu → Sobre → Enviar diagnóstico depois de usar os contatos. | Nenhum nome da agenda no arquivo (os números das ligações aparecem, como na etapa 1). | ☐ | ☐ |

## 15. Fone Bluetooth, viva-voz, ligações do celular, bateria e dados (0.2)

Repita as seções 11 a 13 com um fone Bluetooth conectado e, depois, no viva-voz. Além disso:

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 15.1 | Na conferência, aperte o botão de desligar do fone Bluetooth. | As duas ligações acabam (como o Desligar da tela): nenhum dos dois continua na linha. | ☐ | ☐ |
| 15.2 | Com duas ligações em andamento, use o comando de alternar do fone ou do kit do carro (segurar o botão, ou "trocar chamada"). | Os cartões trocam de lugar e o som passa para a outra ligação. Depois, Desligar a de cima: a outra volta sozinha. | ☐ | ☐ |
| 15.3 | Com duas ligações em andamento, receba e atenda uma ligação do celular (da operadora). Desligue a do celular. Toque em Alternar e depois em Juntar. | Durante a ligação do celular, as duas do ramal ficam em espera (os dois ouvem a espera) e nenhuma volta sozinha. Depois dela: Alternar dá o som a uma delas, e Juntar faz a conferência normalmente. | ☐ | ☐ |
| 15.4 | Numa ligação do ramal, atenda uma ligação do celular; desligue a do celular. | A do ramal vai para "Em espera" e continua. Quando a do celular acaba: anote se ela volta sozinha ou se precisa de Retomar; o áudio volta ao retomar. | ☐ | ☐ |
| 15.5 | Com duas ligações no celular e uma ligação do celular tocando, recuse a do celular. | As duas do ramal continuam como estavam. | ☐ | ☐ |
| 15.6 | Faça uma conferência de 10 minutos no 4G, com o celular carregado e a tela apagada a maior parte do tempo. Anote a carga e os dados do app antes e depois (Configurações → Bateria e → Uso de dados). | A1: `____` % e `____` MB em 10 min. A2: `____` % e `____` MB. O responsável aprova. | ☐ | ☐ |
| 15.7 | No viva-voz, na conferência, troque para "Celular" e para o fone Bluetooth pela escolha de áudio. | O áudio dos dois sai por onde foi escolhido. | ☐ | ☐ |

## Onde cada critério de sucesso é verificado

| Critério (spec §3) | Automático (a cada build) | Neste roteiro |
|--------------------|---------------------------|---------------|
| Instalar o APK pelo link, digitar o servidor, o ramal e a senha e completar uma ligação sem mexer em outro campo técnico | `LoginScreenTest` (emulador, contra o registrador falso), testes do motor no Linux, `check_apk.py` | 1, 2, 3.1 |
| Com o app fechado, a ligação toca (em tela cheia ou no alto da tela) no Wi-Fi e no 4G, depois de 1 hora parado e depois de reiniciar, em duas marcas | `ServiceTest`, `check-boot.sh` e `CallFlowTest` (emulador); `SipEngine` no Linux (registro de novo na troca de rede) | 3, 4 |
| Áudio nos dois sentidos; mudo, viva-voz, Bluetooth, espera, transferir e teclado (DTMF) | `CallFlowTest` (emulador) e os testes do motor no Linux, sem áudio de verdade | 3.1, 5 |
| Nenhum "MicroSIP"; o suporte identifica o app e a versão pelo Sobre e pelo User-Agent | `check_apk.py` (todo arquivo do APK), `AboutAndAccountTest` (versão), User-Agent recebido pelo registrador falso | 2.9, 9.2, 10.1 |
| Nada técnico além do servidor, do protocolo, do ramal e da senha | testes do núcleo (perfil e conta montada a partir dele), `LoginScreenTest` | 2.1 |
| Uma versão de teste nova chega como aviso e instala com a confirmação do Android | `UpdateDeciderTest` e `UpdaterTest` (JVM), `UpdatePromptTest` (emulador) | 7 |
| Consumo de bateria num dia em espera, medido e aprovado | — | 8 |
| Código-fonte completo junto de cada APK publicado | workflow `android-release` (APK, `versao-android.json` e código-fonte completo em cada release) | 7.1 |

### Critérios da 0.2 (spec da 0.2, §3)

| Critério | Automático (a cada build) | Neste roteiro |
|----------|---------------------------|---------------|
| Numa ligação, a segunda toca na tela de chamada, é atendida (a primeira vai para a espera), a pessoa alterna, e ao desligar a ativa a outra volta sozinha | `test_engine_calls` (motor, segunda ligação e `Activate`), `CallManagerTest` (JVM), `CallFlowTest` (emulador) | 11 |
| Transferência com consulta: concluir (as duas saem), cancelar, o colega não atende | `test_engine_calls` (REFER com Replaces, NOTIFY 200 e 603), `CallManagerTest`, `CallFlowTest` | 12 |
| Conferência: juntar, separar, desligar; um sai e a ligação continua com o outro | `test_engine_calls` (`Join`/`Split` na mesa), `CallManagerTest`, `CallFlowTest` | 13 |
| Contatos do celular: a aba, ligar pelo nome, o nome na ligação recebida, na tela, na notificação e nos Recentes; sem a permissão, só números | `ContactsTest` e `CallManagerTest` (JVM), `ContactsFlowTest` (emulador), `test_call_messages` (`ContactDialString`), `check_apk.py` (`READ_CONTACTS` e nenhuma outra permissão nova) | 14 |
| A terceira ligação recebe ocupado; uma ligação da operadora em andamento continua bloqueando | `test_engine_calls` (486), `CallManagerTest` | 6, 11.12, 15 |
| Tudo acima com fone Bluetooth e viva-voz; bateria e dados numa conferência de 10 minutos | — | 15 |
