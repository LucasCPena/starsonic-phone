# Teste manual do Starsonic Phone (Android)

Faça este roteiro antes de cada versão estável (spec §11.3), com a versão candidata (`android-vX.Y.Z-rc.N`). Use pelo menos dois celulares de marcas diferentes (ex.: Samsung e Motorola; um Xiaomi, se houver), com o Android 9 ou mais novo (de preferência um deles com o Android 14 ou mais novo), e dois ramais de teste: um num servidor por UDP e outro num servidor por TCP. Para as seções 11 a 17 (a 0.2, a 0.2.0-rc.2 e a 0.2.0-rc.3), mais dois ramais de teste na mesma central do ramal do celular (veja a seção 11). Ramais e senhas de teste ficam fora do repositório. Para as ligações, tenha à mão outro telefone (o outro ramal, o Starsonic Phone no PC ou um celular comum).

Marque cada linha nas colunas A1 e A2 (um celular em cada); na seção 3, faça cada linha no Wi-Fi e no 4G (desligue o Wi-Fi para o 4G). Se algo não sair como o esperado, anote a versão, o celular, o passo e o que apareceu (de preferência com um print da tela) e mande o diagnóstico (Menu → Sobre → Enviar diagnóstico).

Versão testada: `__________`  Data: `__________`  Quem testou: `__________`

A1 (marca, modelo, Android): `__________`  A2: `__________`

## 1. Instalação pelo link e permissões

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 1.1 | No navegador do celular, abra a página do release no GitHub (`…/releases/tag/android-v<versão>`), baixe `StarsonicPhone-android-<versão>.apk` e abra o arquivo. | O Android avisa que o app vem de fora da loja e pede para permitir que o navegador instale apps ("Instalar apps desconhecidos"); depois de permitir, pede a confirmação da instalação. Se o Play Protect avisar que não conhece o app, "Mais detalhes" → "Instalar assim mesmo". | ☐ | ☐ |
| 1.2 | Termine a instalação e procure o app na tela inicial e na lista de apps. | Ícone azul com o fone branco e o anel ciano, com "Starsonic" embaixo. Em Configurações → Apps, o nome é "Starsonic Phone". | ☐ | ☐ |
| 1.3 | Abra o app. | Abertura azul com o ícone e depois a tela Entrar, em pé, com o logo no cabeçalho escuro (rc.2; o desenho está em 16.1). | ☐ | ☐ |
| 1.4 | Depois do primeiro Entrar (seção 2), siga a tela Permissões: "Permitir" em cada item e, no fim, "Continuar". | Notificações, microfone, tela cheia (Android 14 ou mais novo, quando o Android pedir) e uso de bateria sem restrição, cada um pela janela do próprio Android. Depois, o Teclado. | ☐ | ☐ |
| 1.5 | Num Xiaomi, Redmi ou POCO, ou num Samsung: siga o passo a passo da tela Permissões com "Abrir ajustes". | Xiaomi: ativar "Início automático" e, em "Economia de bateria", escolher "Sem restrições". Samsung: "Bateria" → "Sem restrições". Os nomes batem com os do MIUI/HyperOS ou do One UI do aparelho (anote os que não baterem). | ☐ | ☐ |
| 1.6 | Nas configurações do Android, tire uma de cada vez: as notificações, o microfone, a tela cheia e a isenção de bateria; volte ao app depois de cada uma. No fim, conceda tudo de novo. | A faixa mostra um aviso por vez, nesta ordem: "Permita as notificações para receber ligações.", "Permita o microfone para fazer e receber ligações.", "Permita a tela cheia para ver as ligações com o celular bloqueado.", "Libere o uso de bateria para receber ligações com o app fechado.". O botão "Abrir ajustes" abre o ajuste certo. | ☐ | ☐ |

## 2. Entrar

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 2.1 | Olhe a tela Entrar. | "Servidor (endereço ou IP)", "Protocolo" (UDP marcado), "Ramal", "Senha" (com o botão de mostrar), "Entrar" e "Precisa de ajuda? (11) 5060-3000" (rc.2: o desenho está em 16.1). Nenhum outro campo técnico (porta, proxy, codecs etc.). | ☐ | ☐ |
| 2.2 | Toque em "Precisa de ajuda? (11) 5060-3000". | O discador do celular abre com o número. | ☐ | ☐ |
| 2.3 | Toque em Entrar: com o Servidor vazio; com o endereço e a porta (ex.: `starcloud1-starsonic.com.br:5060`); com o ramal com espaço no meio (ex.: `20 01`); e com a senha vazia. | "Digite o endereço do servidor."; "Digite só o endereço do servidor, como starcloud1-starsonic.com.br."; "Digite só o número do ramal."; "Digite a senha." | ☐ | ☐ |
| 2.4 | Ramal certo com a senha errada. | "Ramal ou senha incorretos." e a tela continua aberta. | ☐ | ☐ |
| 2.5 | Endereço que não existe (ex.: `starcloud9-starsonic.com.br`). | "Não foi possível falar com o servidor. Confira o endereço e a sua internet." | ☐ | ☐ |
| 2.6 | No modo avião, tente entrar. | Uma mensagem de erro da tabela 11.1 (em geral "Não foi possível falar com o servidor. Confira o endereço e a sua internet."), sem código técnico além do "(código n)" previsto. | ☐ | ☐ |
| 2.7 | Internet de volta: entre com o ramal do servidor por UDP (Protocolo UDP), com espaços nas pontas e letras maiúsculas no endereço (ex.: ` Starcloud1-Starsonic.com.br `). | A tela Permissões (no primeiro Entrar) e depois o Teclado, com "Conectado · <servidor>" no cartão da conta (rc.2; antes, "<ramal>" na faixa). Na gaveta de notificações, a notificação fixa "Conectado (ramal <ramal>)", com "Starsonic Phone" no cabeçalho. | ☐ | ☐ |
| 2.8 | Menu → Configurações → o lápis de Editar conta (rc.2; antes, Menu (⋮) → Editar conta): entre com o ramal do servidor por TCP, com o Protocolo TCP. Depois, abra o Editar conta de novo e volte. | O Editar abre com o servidor, o protocolo e o ramal preenchidos e a senha vazia. Depois de Entrar: "Conectado · <servidor TCP>" (rc.2; antes, "<ramal TCP>"). No Editar seguinte, o Protocolo aparece como TCP. | ☐ | ☐ |
| 2.9 | No PABX (ou com o fornecedor), confira o User-Agent do registro. | `Starsonic Phone Android/<versão>`, e o servidor aceita o registro. Se a plataforma filtrar esse User-Agent, anote (o plano B é usar o do Windows). | ☐ | ☐ |

## 3. Ligar e receber

Faça cada linha no Wi-Fi e no 4G. A conta fica conectada com o processador acordado (decisão 6 da spec), também com a tela apagada.

| # | Passo | Resultado esperado | A1 Wi-Fi | A1 4G | A2 Wi-Fi | A2 4G |
|---|-------|--------------------|----------|-------|----------|-------|
| 3.1 | Com o app aberto, ligue pelo Teclado para outro ramal e para um número externo. | Chama, completa e o áudio passa nos dois sentidos. O botão Ligar é ciano (rc.2; antes, verde). A tela apaga ao encostar no rosto e volta ao afastar. | ☐ | ☐ | ☐ | ☐ |
| 3.2 | Com o app aberto, receba uma ligação. | Toca e mostra o nome do contato do celular, ou o número (e o nome, se o PABX mandar), com "Recusar" em vermelho e "Atender" em verde (rc.2: na tela cheia da recebida, o Atender é ciano; veja 16.16). Atende, e o áudio passa. | ☐ | ☐ | ☐ | ☐ |
| 3.3 | Saia do app (botão de início), use o celular e receba uma ligação. | A notificação de ligação aparece no alto da tela, com "Atender" e "Recusar"; atender abre a tela de chamada. | ☐ | ☐ | ☐ | ☐ |
| 3.4 | Tire o app da lista de apps recentes e receba uma ligação. | Toca do mesmo jeito; a notificação fixa continua. | ☐ | ☐ | ☐ | ☐ |
| 3.5 | Com a tela bloqueada, e depois com a tela apagada, receba uma ligação. | Tela cheia por cima da tela bloqueada, com "Atender" e "Recusar"; atende sem desbloquear. | ☐ | ☐ | ☐ | ☐ |
| 3.6 | Deixe o celular parado, com a tela apagada, por 1 hora, sem abrir o app. Ligue para o ramal. | Toca. | ☐ | ☐ | ☐ | ☐ |
| 3.7 | Reinicie o celular e desbloqueie, sem abrir o app. Ligue para o ramal. | A notificação fixa volta sozinha depois do primeiro desbloqueio, e a ligação toca. | ☐ | ☐ | ☐ | ☐ |
| 3.8 | Receba uma ligação com o celular no modo normal, no vibrar, no silencioso e no Não perturbe do Android (rc.2: não é o Não perturbe do app, da seção 16). | Toca e vibra conforme o modo do celular, como uma ligação comum. | ☐ | ☐ | ☐ | ☐ |
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
| 4.1 | Sem ligação, troque do Wi-Fi para o 4G e depois de volta; em cada rede, ligue para o ramal. | O status volta a "Conectado · <servidor>" sozinho (rc.2; antes, "<ramal>"), e a ligação toca nas duas redes. | ☐ | ☐ |
| 4.2 | Com uma ligação em andamento, troque do Wi-Fi para o 4G. | Anote o que acontece (a ligação pode cair, o que é aceito na etapa 1). O registro volta sozinho. | ☐ | ☐ |
| 4.3 | Ligue o modo avião por 1 minuto e desligue. | Durante: o cartão da conta e a notificação fixa mostram "Sem internet · tentando de novo" (rc.2; antes, "Sem internet" na faixa). Depois: "Conectado · <servidor>", sem fazer nada. | ☐ | ☐ |
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
| 9.1 | Toque no botão do menu, no canto direito do cabeçalho (rc.2; antes, o menu ⋮ da faixa). | "Configurações" e "Sobre" (rc.2: "Editar conta" e "Sair da conta" passaram para Configurações → Conta; veja 16.9). | ☐ | ☐ |
| 9.2 | Abra o Sobre. | "Starsonic Phone <versão>", "Licença GPL v3", "Usa o PJSIP (GPL v2 ou posterior) e o Opus (BSD).", o site, o WhatsApp, o telefone de suporte, o link do código-fonte e "Enviar diagnóstico". | ☐ | ☐ |
| 9.3 | No Sobre, toque no site, no WhatsApp, no telefone e no link do código-fonte. | O site abre no navegador; o wa.me abre o WhatsApp; o discador abre com (11) 5060-3000; o código-fonte abre no GitHub. | ☐ | ☐ |
| 9.4 | "Enviar diagnóstico" para o WhatsApp e, depois, para o Gmail. | O anexo chega e abre; a senha do ramal não aparece nele. | ☐ | ☐ |
| 9.5 | Durante uma ligação, Menu → Configurações → o lápis de Editar conta (rc.2) e toque em Entrar. | A ligação cai e vai para o Recentes; a conta registra de novo. | ☐ | ☐ |
| 9.6 | Menu → Configurações → Sair da conta (rc.2); toque em "Cancelar"; depois, Sair da conta de novo e "Sair". | Pede confirmação: "Sair da conta?" — "Este celular deixa de receber as ligações do ramal. Para entrar de novo, você vai precisar da senha.". "Cancelar" não muda nada; "Sair" volta à tela Entrar, a notificação fixa some e o Recentes continua. | ☐ | ☐ |
| 9.7 | Durante uma ligação, Menu → Configurações → Sair da conta (rc.2) → "Sair". | A ligação termina, e o app volta à tela Entrar. | ☐ | ☐ |
| 9.8 | Troque a senha do ramal no PABX com o app na frente; repita com o app em segundo plano (a recusa chega na renovação do registro, em até 5 min). | A tela Entrar abre com "Ramal ou senha incorretos." (com o app em segundo plano, quando ele é aberto). | ☐ | ☐ |
| 9.9 | Android 12 ou mais novo: transfira os dados para um celular novo (pela cópia do Android/Google ou pelo cabo do fabricante) e abra o app no celular novo. | A conta não vai junto: o app abre na tela Entrar. | ☐ | ☐ |

## 10. Marca

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 10.1 | Passe por todas as telas, avisos e notificações. | "MicroSIP" não aparece em lugar nenhum. | ☐ | ☐ |
| 10.2 | Use o app com o celular no modo claro e no escuro. | O app segue o modo do celular; o cabeçalho escuro com o logo "starsonic" em branco e ciano e o logo da tela Entrar não mudam. Ligar e Atender em ciano; Recusar e Desligar em vermelho (rc.2; antes, a faixa azul e o Ligar e o Atender em verde). O visual completo está na seção 16. | ☐ | ☐ |
| 10.3 | Com os ícones temáticos ligados (Android 13 ou mais novo), olhe o ícone na tela inicial; olhe também o ícone da notificação fixa. | O ícone temático (de uma cor só) e o da notificação (só branco) aparecem completos. | ☐ | ☐ |

## 11. Segunda ligação (0.2)

Para as seções 11 a 15, mais dois ramais de teste na mesma central do ramal do celular, cada um num telefone à mão (o Starsonic Phone no PC, um ATA ou outro celular): um faz de **cliente** e o outro de **colega**. Antes de começar, confirme com a Starsonic que a central entrega uma segunda ligação a um ramal que já está numa ligação (o limite de chamadas do ramal precisa ser 2 ou mais); se a central der ocupado na segunda, nada desta seção é do app — anote e peça o ajuste na central.

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 11.1 | Com o app aberto, numa ligação com o cliente, receba a ligação do colega. | A faixa "Ligação de <nome ou número>" no alto da tela de chamada, com Atender e Recusar; em vez do toque, um bipe curto repetido (chamada em espera) e a vibração. A conversa com o cliente continua. | ☐ | ☐ |
| 11.2 | Toque em Atender na faixa. | O colega vira a ligação de cima (com o tempo); o cliente fica no cartão de baixo, "Em espera", e ouve a espera. Os botões passam a ser Mudo, Teclado, Viva-voz, Alternar, Juntar e Transferir (rc.2; antes, também o Espera); Nova ligação não aparece com duas ligações. | ☐ | ☐ |
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
| 12.2 | Digite o ramal do colega e toque em Consultar. | O cliente vai para o cartão de baixo, "Em espera · transferência", e ouve a espera; o colega chama em cima ("Chamando…"); os botões são Concluir transferência, Alternar e Cancelar (rc.2; Concluir transferência e Alternar apagados até o colega atender). | ☐ | ☐ |
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
| 13.8 | Na conferência, olhe a notificação na gaveta. | A notificação fixa mostra "Ocupado · em ligação" (rc.2; antes, "Conectado (ramal <ramal>)"); nenhuma notificação do app Telefone do celular aparece por causa da conferência. | ☐ | ☐ |

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

## 16. Visual do Windows, Não perturbe, Atender automático, Rediscar, bolinha e bipe (0.2.0-rc.2)

Compare com os 19 quadros do canvas "Starsonic Phone Android — visual do Windows e funções novas" (claude.ai), aberto ao lado: Teclado, Recentes, Contatos, Configurações, Sobre, Entrar e Permissões, claros e escuros; mais Em ligação, Duas ligações, Ligação recebida (tela cheia), Menu aberto e Bolinha de status e notificação fixa. A consulta, a conferência e a Nova ligação não têm quadro: compare com o quadro "Duas ligações" e com o app do Windows.

Para as ligações, tenha à mão os dois ramais da seção 11 (o cliente e o colega), outro celular com chip (para ligar para o número deste celular: a ligação da operadora), um fone com fio e um fone Bluetooth. O tema escuro é o de Configurações do Android → Tela → Tema escuro. A letra grande é a de Configurações do Android → Tela → Tamanho da fonte, no máximo. Entre uma linha e outra, deixe as chaves como vêm de fábrica (Não perturbe e Atender automático desligados, tempo de 3 s, bipe ligado), a não ser que a linha diga outra coisa. "Configurações → Ligações" quer dizer: menu → Configurações e, na tela, a parte "Ligações".

Na tela, os rótulos de seção (como CONTA e EM LIGAÇÃO) e os selos (como ATIVA, EM ESPERA e ATENDER AUTOMÁTICO · EM 3 S) aparecem em maiúsculas. Aqui eles estão como o leitor de tela os lê.

### Primeiro uso, com o app recém-instalado

Faça estas linhas na instalação nova (seções 1 e 2), no tema claro e com a letra normal. Se você já passou dessa parte, desinstale o app, instale de novo pelo link (1.1) e abra.

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 16.1 | Olhe a tela Entrar. Compare com o quadro "Entrar · claro". | O cabeçalho escuro com o logo, "Ramal no celular" em ciano e "Entre com o seu ramal". Embaixo: "Servidor (endereço ou IP)"; "Protocolo", com UDP e TCP lado a lado e o escolhido em destaque (de início, o UDP); "Ramal"; "Senha", com o olho para mostrar; o botão "Entrar" ciano, com a seta; e, no pé da tela, "Precisa de ajuda? (11) 5060-3000". | ☐ | ☐ |
| 16.2 | Entre com o ramal do servidor por UDP (2.7). Olhe a tela Permissões. Compare com o quadro "Permissões · claro". Toque em "Permitir" num dos avisos e dê a permissão. | A barra escura com o Voltar e "Permissões"; "Para as ligações chegarem" e os quatro avisos (notificações, microfone, tela cheia e uso da bateria), cada um com o ícone, o texto e o botão azul "Permitir"; "Continuar" ciano no fim da tela. O aviso que você deu troca o botão por um sinal de feito verde. Num Samsung, Xiaomi, Redmi ou POCO, também o cartão do fabricante, com "Nos celulares Samsung, libere também o app nos ajustes:" (ou "Nos celulares Xiaomi, Redmi e POCO, libere também o app nos ajustes:"), os passos numerados e "Abrir ajustes"; nas outras marcas, o cartão não aparece. | ☐ | ☐ |
| 16.3 | Com pelo menos uma permissão ainda sem dar, aperte a tecla Voltar do celular. | A tela principal (o Teclado) abre, e o app não fecha. O Voltar da barra escura da tela faz o mesmo. | ☐ | ☐ |
| 16.4 | Na tela principal, antes de qualquer ligação, olhe o Rediscar e as duas pílulas do cabeçalho. Depois, abra o menu → Configurações e olhe a parte "Ligações". | O Rediscar fica apagado, e tocar nele não faz nada. "Não perturbe" e "Atender automático" estão desligados (só o contorno branco, sem o ciano). Em Ligações: o bipe ligado; "Atender automaticamente" desligado, com "Depois de 3 segundos tocando" embaixo; "Tempo para atender" em "3 s". | ☐ | ☐ |

### Visual: tema claro, letra normal

Volte o celular ao tema claro e à letra normal, se tiver mudado.

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 16.5 | Olhe o Teclado. Compare com o quadro "Teclado · claro". | O cabeçalho escuro vai até o topo da tela, por trás da barra de status do Android, com o logo e o botão do menu. Embaixo, o cartão da conta (a bolinha, o ramal e a linha de status) e as pílulas "Não perturbe" e "Atender automático". Depois, o número grande com o Apagar, as 12 teclas quadradas com as letras e, na última linha, o Rediscar (redondo, com contorno) e o Ligar (pílula ciano). A navegação de baixo tem "Teclado", "Recentes" e "Contatos", com a aba ativa numa pílula ciano clara, e deixa o respiro da barra de gestos. | ☐ | ☐ |
| 16.6 | Toque em "Recentes" (com ligações feitas, recebidas e perdidas). Compare com o quadro "Recentes · claro". | Os filtros "Todas" e "Perdidas · <n>" (só "Perdidas", se não há nenhuma). As ligações em grupos por dia ("Hoje", "Ontem" ou a data, como "24 de outubro"). Cada linha tem o ícone do tipo num quadrado (o da perdida em vermelho claro), o nome ou o número (o ramal vem ao lado do nome, como "Marcos Lima · 2005"), o tipo ("Feita", "Recebida" ou "Perdida") com a hora e, se foi atendida, a duração (ex.: "Feita · 14:32 · 2 min 05 s"), e o botão redondo de ligar. | ☐ | ☐ |
| 16.7 | Toque em "Contatos" (com a permissão dada, 14.2). Compare com o quadro "Contatos · claro". | A busca em pílula ("Buscar contato"); os grupos pela letra; cada contato com o avatar das iniciais, o nome, os números e o botão redondo de ligar. | ☐ | ☐ |
| 16.8 | Toque no botão do menu (os dois controles deslizantes), no canto direito do cabeçalho. Compare com o quadro "Menu aberto". | O menu abre debaixo do botão, só com "Configurações" e "Sobre", e a tela por trás escurece. Tocar fora do menu, ou apertar a tecla Voltar do celular, fecha o menu. | ☐ | ☐ |
| 16.9 | No menu, toque em "Configurações". Compare com o quadro "Configurações · claro (nova)". | A barra escura com o Voltar e "Configurações". Três partes, cada uma com o rótulo em maiúsculas e o traço ciano. "Conta": a bolinha, o ramal e "servidor · protocolo", o lápis de "Editar conta" e "Sair da conta" (ícone vermelho), com "O celular deixa de receber as ligações do ramal.". "Ligações": "Bipe quando a ligação cai ou termina" (com "Vem ligado. Um bipe curto no fone quando a outra pessoa desliga ou a ligação cai."), "Atender automaticamente" e "Tempo para atender", com as chaves ciano. "Celular": "Permissões e bateria" (com "Notificações, microfone e o uso da bateria, para as ligações chegarem com a tela apagada"). | ☐ | ☐ |
| 16.10 | Menu → Sobre. Compare com o quadro "Sobre · claro". | A barra escura com o Voltar e "Sobre"; o logo principal (colorido); "Starsonic Phone <versão>", "Licença GPL v3" e "Usa o PJSIP (GPL v2 ou posterior) e o Opus (BSD)."; o cartão com o site ("starsonic.com.br"), o telefone de suporte ("(11) 5060-3000") com o link "WhatsApp" ao lado e o código-fonte; e "Enviar diagnóstico" no pé da tela. | ☐ | ☐ |
| 16.11 | Ligue para o cliente (3.1) e olhe a tela de chamada. Compare com o quadro "Em ligação". Depois, aperte Voltar e olhe a tela principal. | A tela escura. No alto, a bolinha vermelha com "Ocupado · em ligação" e o seu ramal à direita. Depois, "Em ligação" em ciano, o avatar com as iniciais (sem nome, o fone), o nome (ou o número) e, embaixo do nome, "Ramal <n>" (ou o número, se não for um ramal); "Chamando…", que vira o tempo em ciano. Os controles redondos em grade de 3 (Mudo, Teclado, Viva-voz; Espera, Transferir, Nova ligação; com um fone Bluetooth ligado, o áudio ganha também Celular e Bluetooth), o ligado em ciano, e o Desligar vermelho. Na tela principal, a faixa ciano "Ligação em andamento. Toque para voltar." embaixo do cabeçalho; tocar nela volta para a ligação. | ☐ | ☐ |
| 16.12 | Com a ligação do cliente em andamento, receba a do colega e atenda (11.1 e 11.2). Olhe a faixa antes de atender e a tela depois. Compare com o quadro "Duas ligações". | Antes de atender, a faixa "Ligação de <nome ou número>", com Recusar (vermelho) e Atender (ciano) redondos. Depois, "Duas ligações" em ciano; o cartão da ativa (borda ciano, com "Ativa") e o da outra ("Em espera"), cada um com o avatar, o nome, o número ("Ramal <n>" num ramal) e o tempo. Os controles: Mudo, Teclado, Viva-voz, Alternar, Juntar e Transferir; o Desligar vermelho. | ☐ | ☐ |
| 16.13 | Numa ligação, toque em Transferir, digite o ramal do colega e toque em Consultar; olhe a tela com o colega chamando e, depois, com ele em linha (12.2 e 12.3). | O colega em cima ("Chamando…" e depois o tempo); o cliente num cartão embaixo, "Em espera · transferência". Os controles: Mudo, Teclado, Viva-voz, Concluir transferência, Alternar e Cancelar; Concluir transferência e Alternar ficam apagados enquanto o colega chama. O desenho é o dos cartões do quadro "Duas ligações". | ☐ | ☐ |
| 16.14 | Junte as duas ligações (13.1) e olhe a tela. | "Conferência" em ciano e o tempo desde o Juntar; um cartão para cada um dos dois, com o alto-falante; os controles Mudo, Teclado, Viva-voz e Separar; o Desligar vermelho. | ☐ | ☐ |
| 16.15 | Numa ligação só, toque em "Nova ligação" e digite um número. | O painel "Nova ligação": o campo "Número", o Rediscar (redondo, com contorno) à esquerda do Ligar (ciano), as sugestões de contatos ao digitar e "Cancelar" embaixo. | ☐ | ☐ |
| 16.16 | Com o Atender automático desligado, bloqueie o celular e receba uma ligação do cliente. Compare com o quadro "Ligação recebida (tela cheia)". | O fundo escuro; "Ligação recebida · <seu ramal>" em ciano; o avatar com os anéis; o nome (ou o número) e, embaixo do nome, o número; Recusar (vermelho) e Atender (ciano), afastados um do outro. Sem o selo "Atender automático". | ☐ | ☐ |

### Visual: tema escuro

Ponha o celular no tema escuro.

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 16.17 | Repita o Teclado, o Recentes, o Contatos e o menu (16.5 a 16.8). Compare com os quadros "Teclado · escuro", "Recentes · escuro" e "Contatos · escuro". | O mesmo desenho do tema claro, com o fundo, os cartões, os campos, as teclas e a navegação nas cores escuras (o menu aberto não tem quadro escuro). O cabeçalho é o mesmo nos dois temas; as pílulas ligadas e a aba ativa continuam ciano. Nenhum texto some no fundo. | ☐ | ☐ |
| 16.18 | Repita as Configurações, o Sobre, o Entrar (pelo lápis de Editar conta, em Configurações → Conta) e as Permissões (por Configurações → Permissões e bateria). Compare com os quadros escuros. | O mesmo desenho do tema claro, nas cores escuras. No Sobre, o logo é o negativo (claro). As chaves ligadas, o "Entrar" e o "Continuar" continuam ciano; o "Permitir" continua azul. Num Samsung ou Xiaomi, o cartão do fabricante também fica escuro e legível. | ☐ | ☐ |
| 16.19 | Olhe a ligação, as duas ligações, a consulta, a conferência, a Nova ligação e a recebida (16.11 a 16.16), com o celular nos dois temas. | São iguais nos dois temas: a tela da ligação é sempre escura. No tema claro, a tela de chamada não pisca em branco ao abrir, nem por cima da tela bloqueada. | ☐ | ☐ |

### Visual: letra no máximo

Volte ao tema claro. Ponha a letra do celular no máximo.

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 16.20 | Na tela principal, percorra o Teclado (digite um número bem longo), o Recentes (com várias ligações), o Contatos e o menu. | Nada fica cortado, escondido ou sobreposto, e dá para chegar ao cabeçalho, às 12 teclas, ao Rediscar, ao Ligar e à navegação, rolando onde preciso. Quando o cabeçalho (com a faixa de aviso e a da ligação em andamento, se houver) toma mais da metade da tela, ele sobe junto com a aba ao rolar (a volta dele é o 16.71), e a navegação de baixo fica parada e inteira. Se as duas pílulas do cabeçalho não couberem lado a lado, a segunda desce para a linha de baixo. Os filtros do Recentes ficam inteiros (o segundo desce, se for preciso). O menu cresce junto com o texto. No Teclado, o número digitado fica parado em cima das teclas e mostra os últimos dígitos (a reticência fica no começo); as sugestões, as teclas, o Rediscar e o Ligar rolam por baixo dele, e o número continua à vista, também depois de rolar até o Ligar. | ☐ | ☐ |
| 16.21 | Com pelo menos um aviso das Permissões ainda sem dar (como no 16.3), abra as Configurações, o Sobre, o Entrar (pelo lápis de Editar conta) e as Permissões. | Cada tela rola até o fim, com os textos inteiros e sem sobreposição. Nenhuma palavra quebra no meio: quando uma palavra do texto não cabe ao lado do botão, da chave ou do link, ele desce para baixo do texto (o que cabe, como o sinal de feito, o "3 s" e a setinha, continua ao lado). Nas Permissões, a linha de um aviso com o botão "Permitir" fica inteira (o texto e o botão). Nas Configurações, "Atender automaticamente" aparece inteiro, com a chave. No Sobre, o telefone "(11) 5060-3000" fica inteiro, com o link "WhatsApp" ao lado ou embaixo, ao alcance do toque. | ☐ | ☐ |
| 16.22 | Num Samsung, Xiaomi, Redmi ou POCO, olhe o cartão do fabricante nas Permissões. | Os passos "1.", "2." e "3." aparecem inteiros: o número de cada passo não quebra nem corta, e "Abrir ajustes" fica inteiro. | ☐ | ☐ |
| 16.23 | Faça uma ligação e olhe a tela de chamada, o painel do Transferir (com "Consultar" e "Transferir agora"), as duas ligações, a consulta, a conferência, a Nova ligação e a recebida (com o Atender automático ligado). | Os nomes dos controles não quebram no meio de uma palavra (a letra encolhe; quebrar num espaço, como em "Nova ligação", pode). No painel do Transferir, "Consultar" e "Transferir agora" ficam inteiros: lado a lado, se couberem, ou um embaixo do outro, cada um com a largura toda. A tela rola onde não cabe, e o Desligar (ou o Recusar e o Atender) continua ao alcance. Na recebida, o selo "Atender automático · em <n> s" não separa o "em", o número e o "s". A linha de status do alto pode terminar em "…". | ☐ | ☐ |
| 16.24 | Num celular pequeno, de uns 360 dp de largura (se o seu for maior, aumente o zoom da tela: em Configurações do Android → Tela, o item "Tamanho da tela", "Tamanho de exibição" ou "Zoom da tela", conforme o celular), com a letra no máximo (200 %, se o celular chegar a tanto) e as outras três permissões dadas, deixe o uso da bateria sem permissão (não toque em "Permitir" nesse aviso) e abra o app. | A tela principal abre mostrando o cabeçalho e a faixa de aviso ("Libere o uso de bateria para receber ligações com o app fechado."), sem palavra quebrada no meio: o texto fica numa coluna estreita e comprida, ao lado do "Abrir ajustes" (ou, se uma palavra não couber ali, o link desce para baixo do texto). O Teclado começa embaixo da faixa. A barra de baixo (Teclado, Recentes, Contatos) fica parada e inteira na tela. Puxando o dedo para cima, o cabeçalho e a faixa saem pelo alto, e aparecem o número (parado em cima), as 12 teclas, o Rediscar e o Ligar. Dá para digitar um número, tocar no Ligar e trocar de aba. Anote como ficou a faixa: o tamanho dela com a letra no máximo é um ponto em aberto para o responsável (seção 14 da spec do visual do Windows). | ☐ | ☐ |
| 16.25 | (Opcional) Volte a letra ao normal e ligue o TalkBack. Passe o dedo pelo sinal de feito de uma permissão dada, pelo botão de ligar de uma linha do Recentes, pelo Rediscar (com uma feita) e pelo Desligar com duas ligações. Com um erro de cadastro (16.63), passe o dedo pelo triângulo do cartão da conta. | Ele diz "Permitida", "Ligar", "Rediscar <número>" (ou "Rediscar <número> · <nome>"), "Desligar a ligação ativa" e "Atenção". | ☐ | ☐ |

### Não perturbe

Desligue o Atender automático. Os ramais são o cliente e o colega.

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 16.26 | Toque em "Não perturbe" no cabeçalho. Depois, toque de novo. | Ligado: a pílula fica ciano, com o texto escuro; a bolinha do cartão fica vermelha, com "Não perturbe · as ligações não tocam"; a notificação fixa vira "Não perturbe (ramal <ramal>)". Desligado de novo: a pílula volta ao contorno branco, a bolinha fica verde, com "Conectado · <servidor>", e a notificação fixa volta a "Conectado (ramal <ramal>)". | ☐ | ☐ |
| 16.27 | Ligue o Não perturbe. Receba uma ligação do cliente com o app na frente; depois, com o app fora da tela e a tela apagada. | O celular não toca nem vibra, e a tela cheia não abre. Quem liga ouve ocupado. A ligação entra no Recentes como "Perdida", e o filtro mostra "Perdidas · <n>" com uma a mais. Na gaveta de notificações, "Ligação perdida de <contato ou número>" aparece sem som e sem vibrar. Em Configurações do Android → Apps → Starsonic Phone → Notificações, o canal dela se chama "Ligações perdidas no Não perturbe". | ☐ | ☐ |
| 16.28 | Desligue o Não perturbe. Use outro app (o navegador, por exemplo) e receba uma ligação do cliente. Com ela tocando, abra o Starsonic pelo ícone (não pela notificação) e ligue o Não perturbe. Depois, atenda pela notificação (puxe a gaveta), converse um instante e desligue. Por fim, o colega liga. | A ligação que já tocava continua tocando e atende normalmente (o Não perturbe vale para as próximas). Depois que ela acaba, o colega ouve ocupado, e a ligação dele entra no Recentes como perdida, sem som. | ☐ | ☐ |
| 16.29 | Com o Não perturbe ligado, ligue para o cliente pelo Teclado e, depois de desligar, pelo Rediscar. | As duas chamam e completam normalmente. Durante a ligação, a bolinha é vermelha, com "Ocupado · em ligação"; ao desligar, volta "Não perturbe · as ligações não tocam". | ☐ | ☐ |
| 16.30 | Com o Não perturbe ligado, tire o app da lista de apps recentes e olhe a notificação fixa. Reinicie o celular, desbloqueie sem abrir o app, olhe a notificação de novo e ligue do cliente. Abra o app. Por fim, desligue o Não perturbe e ligue do cliente. | A notificação continua "Não perturbe (ramal <ramal>)". Depois de reiniciar, ela volta sozinha (primeiro "Conectando…" e, com o ramal registrado, "Não perturbe (ramal <ramal>)"), e o cliente ouve ocupado. No app, a pílula continua ligada. Desligado, a ligação do cliente toca normalmente. | ☐ | ☐ |

### Atender automático

Desligue o Não perturbe. O Atender automático atende sozinho, no caminho de áudio de sempre (fone, headset ou Bluetooth).

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 16.31 | Toque em "Atender automático" no cabeçalho. Abra o menu → Configurações e olhe a parte "Ligações". Desligue "Atender automaticamente", volte à tela principal e ligue a pílula de novo. | A pílula fica ciano. Em Ligações, "Atender automaticamente" está ligado, com "Depois de 3 segundos tocando" embaixo e "Tempo para atender" em "3 s". Desligar a chave nas Configurações desliga a pílula do cabeçalho, e ligar a pílula liga a chave. | ☐ | ☐ |
| 16.32 | Com o Atender automático ligado e o tempo em 8 s (Configurações → Ligações → Tempo para atender), bloqueie o celular e receba uma ligação do cliente. Olhe a tela cheia. | A recebida mostra o selo "Atender automático · em 8 s" e conta "em 7 s", "em 6 s" e assim por diante, de segundo em segundo, desde que o celular começou a tocar. No fim, o app atende sozinho, sem desbloquear, e o áudio passa nos dois sentidos. | ☐ | ☐ |
| 16.33 | Com o tempo ainda em 8 s, receba outra ligação e, antes de a contagem acabar, toque em Atender. Repita tocando em Recusar. | Faz só o que foi tocado. Atender atende uma vez só (o app não atende de novo). Recusar dá ocupado a quem liga, e a ligação entra no Recentes como perdida. Nos dois, o selo da contagem some. | ☐ | ☐ |
| 16.34 | Em Configurações → Ligações, escolha "Tempo para atender" → "Na hora". Bloqueie o celular e receba uma ligação. | A recebida mostra, por um instante, "Atender automático · na hora" e é atendida assim que o celular toca. Em Ligações, "Atender automaticamente" mostra "Assim que tocar". | ☐ | ☐ |
| 16.35 | Escolha "1 s" e depois "5 s", olhando a linha de baixo de "Atender automaticamente". Abra "Tempo para atender" de novo. | "Depois de 1 segundo tocando" e "Depois de 5 segundos tocando". A lista oferece "Na hora", "1 s", "2 s", "3 s", "5 s", "8 s", "10 s", "15 s", "20 s" e "30 s", com a de agora marcada. | ☐ | ☐ |
| 16.36 | Com o tempo em 3 s, tire o app da lista de apps recentes, apague a tela e deixe o celular parado. Ligue do cliente. Repita com "Na hora". | Toca, com a tela cheia por cima da tela bloqueada e a contagem; depois de 3 s o app atende sozinho, sem desbloquear, e o áudio passa. Android 14 ou mais novo: se o Android não deixar o microfone, a ligação continua tocando (atenda à mão). Anote, e mande o diagnóstico (Sobre → Enviar diagnóstico): a linha "Atender automático: o Android não deixou o microfone; a ligação continua tocando" mostra que foi o Android. Se isso acontecer, faça o 16.70 com essa ligação. | ☐ | ☐ |
| 16.37 | Com um fone Bluetooth conectado, receba uma ligação com o Atender automático ligado, com o app na frente e depois com o app fechado e a tela apagada. | É atendida sozinha, e o áudio vai pelo fone Bluetooth, nos dois sentidos. Com o app fechado e a tela apagada, anote se o outro lado ouve (3.16). | ☐ | ☐ |
| 16.38 | Com o tempo em 5 s, use outro app, com a tela acesa, e receba uma ligação. | A notificação no alto da tela mostra "Atender automático · em 5 s" (parada, sem contar), com Atender e Recusar. Depois de 5 s, o app atende sozinho. | ☐ | ☐ |
| 16.39 | Com o Atender automático ligado e o tempo em 3 s, reinicie o celular e desbloqueie. Não abra o app e não ligue nada. Ligue do cliente. | A notificação fixa voltou sozinha (3.7), e a ligação toca e é atendida sozinha depois de 3 s. Se ela continuar tocando, atenda à mão e mande o diagnóstico: a linha "Atender automático: o Android não deixou o microfone; a ligação continua tocando" mostra que foi o Android que não deixou. Anote o celular e o Android. Se isso acontecer, faça o 16.70 com essa ligação. | ☐ | ☐ |
| 16.40 | Com o Atender automático ligado, ponha o tempo em 15 s. Use outro app e receba uma ligação do cliente. Com ela tocando, abra o Starsonic pelo ícone (não pela notificação) e desligue "Atender automático" no cabeçalho. O cliente precisa continuar chamando; se ele desistir antes, repita. | A ligação continua tocando e não é atendida sozinha, mesmo passando os 15 s. A notificação pode continuar mostrando "Atender automático · em 15 s": é esperado (o Android calaria o toque se o app mudasse a notificação de uma ligação que toca). Atenda ou recuse à mão. | ☐ | ☐ |
| 16.41 | Repita o passo anterior, mas, no lugar de desligar o Atender automático, ligue o "Não perturbe". Depois que a ligação acabar, o colega liga. | A ligação que tocava continua tocando e não é atendida sozinha (vale o Não perturbe). Atenda à mão. A do colega ouve ocupado. | ☐ | ☐ |
| 16.42 | Numa ligação com o cliente, com o Atender automático ligado, receba a do colega. | Toca na faixa "Ligação de <nome ou número>", sem o selo da contagem, e não é atendida sozinha. Atender e Recusar funcionam (11.1 e 11.5). | ☐ | ☐ |
| 16.43 | Ligue o Atender automático e o Não perturbe. Ligue do cliente. | Quem liga ouve ocupado. Nada toca e nada é atendido sozinho (vale o Não perturbe). | ☐ | ☐ |
| 16.44 | Com o Atender automático ligado, atenda uma ligação do celular (da operadora) e, com ela em andamento, ligue do cliente. | O cliente ouve ocupado (6.2), e nada é atendido sozinho. A ligação da operadora segue sem ser atrapalhada. | ☐ | ☐ |
| 16.45 | Ponha o tempo em 30 s. Receba uma ligação do cliente e, enquanto ela toca (nos primeiros 10 s), ligue para o número do celular com o outro celular com chip. | A ligação da operadora não pode ser atrapalhada: ela toca e atende normalmente, sem cair nem ficar sem som. Anote o que acontece com a do ramal (continua tocando, parou de tocar ou foi atendida sozinha). | ☐ | ☐ |

### Bipe no fim da ligação

Deixe o bipe ligado (Configurações → Ligações). Salvo quando a linha disser outra coisa, use o fone do ouvido do celular (nem o viva-voz nem um fone).

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 16.46 | Ligue para o cliente, espere atender, converse um instante e deixe o cliente desligar. | Dois bipes curtos no fone do ouvido, logo depois de o cliente desligar. O alto-falante do toque (o do viva-voz) não toca. | ☐ | ☐ |
| 16.47 | Receba uma ligação do cliente, atenda e desligue pelo botão Desligar. | Dois bipes curtos no fone do ouvido. | ☐ | ☐ |
| 16.48 | Com uma ligação atendida, faça a ligação cair: troque do Wi-Fi para o 4G (4.2). Se ela não cair, anote e pule. | Quando a ligação cai, dois bipes curtos. | ☐ | ☐ |
| 16.49 | Plugue um fone com fio (ou USB-C) e repita as duas linhas acima (deixar o cliente desligar e desligar você). | Os bipes saem no fone com fio, e não no alto-falante do celular. | ☐ | ☐ |
| 16.50 | Conecte um fone Bluetooth, atenda uma ligação por ele e deixe a outra pessoa desligar. Repita desligando você. | Os bipes saem no fone Bluetooth, e não no alto-falante do celular. Anote se os dois bipes saem inteiros. | ☐ | ☐ |
| 16.51 | Recuse uma ligação. Deixe uma tocar até perder. Ligue para um número que não atende e desista antes de atender. | Nenhum bipe. | ☐ | ☐ |
| 16.52 | Com duas ligações, desligue uma e continue na outra. Depois, desligue a outra. | Ao desligar a primeira, nenhum bipe. Ao desligar a última, o bipe. | ☐ | ☐ |
| 16.53 | Numa ligação do ramal, atenda uma ligação do celular (da operadora): a do ramal fica em espera. Com a da operadora em andamento, deixe a outra pessoa da ligação do ramal desligar. Depois, desligue a da operadora. | Nenhum bipe do app, nem quando a ligação em espera acaba: o som é da ligação da operadora. | ☐ | ☐ |
| 16.54 | Em Configurações → Ligações, desligue "Bipe quando a ligação cai ou termina" e repita as duas primeiras linhas deste bloco. Tire o app da lista de apps recentes e abra de novo. | Nenhum bipe, e a chave continua desligada. Numa instalação nova ela vem ligada (16.4). Ligue-a de novo. | ☐ | ☐ |
| 16.55 | Depois dos bipes, Menu → Sobre → Enviar diagnóstico, e abra o arquivo. | O arquivo tem a linha "ligação: bipe do fim: tocando (modo do áudio 3)" para cada bipe (o 3 é o modo de ligação; se for outro número, anote). Pode aparecer também a linha "ligação: bipe do fim: sem a marca do fim, acabou pelo tempo": está certa (o celular não avisou o fim do som; anote qual é o celular). Nunca aparece "bipe do fim: o som não acabou em 1500 ms" nem "bipe do fim: não tocou". | ☐ | ☐ |
| 16.56 | Termine uma ligação atendida e, no mesmo instante, faça o colega ligar: combinem um "já!", em que o cliente desliga e o colega liga. Repita algumas vezes. | A nova ligação toca normalmente (pode soar, por um instante, como o bipe de chamada em espera) e dá para atender. A ligação que acabou some da tela. Anote se alguma recebeu ocupado. | ☐ | ☐ |

### Rediscar

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 16.57 | Ligue para o cliente, espere atender e desligue. Volte ao Teclado, olhe o Rediscar e segure o dedo nele. | O Rediscar fica ativo. Segurar o dedo não liga: mostra, por uns 2 segundos, um balão escuro com "Rediscar <número do cliente>" ou, se o número é de um contato, "Rediscar <número> · <nome>". | ☐ | ☐ |
| 16.58 | Ligue para o colega e desligue. Depois, receba uma ligação do cliente, atenda e desligue. Toque no Rediscar. | Liga para o colega: a feita mais nova (a recebida do cliente não conta), pelo mesmo caminho do botão de ligar da linha "Feita" do Recentes. | ☐ | ☐ |
| 16.59 | Receba uma ligação do cliente, atenda e, com ela em andamento, toque em Nova ligação. Segure o dedo no Rediscar do painel e toque nele. Depois, em outra ligação, abra o Teclado da ligação (os tons). | O Rediscar do painel fica à esquerda do Ligar e tem o mesmo nome do balão. Ao tocar, o cliente vai para a espera e a feita mais nova (o colega, se foi a última que você fez) é discada (11.9). O Teclado da ligação (os tons) não tem o Rediscar. | ☐ | ☐ |

### A bolinha e a notificação fixa

Compare com o quadro "Bolinha de status e notificação fixa". O Não perturbe está em 16.26. Em cada estado, olhe o cartão da conta e puxe a gaveta de notificações.

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 16.60 | Com a internet normal e a conta conectada, olhe o cartão da conta e a notificação fixa. | Bolinha verde, o ramal e "Conectado · <servidor>". A notificação fixa: "Conectado (ramal <ramal>)". | ☐ | ☐ |
| 16.61 | Desligue o Wi-Fi e os dados móveis (ou ligue o modo avião). | Em poucos segundos, bolinha cinza com "Sem internet · tentando de novo", no cartão e na notificação fixa. | ☐ | ☐ |
| 16.62 | Ligue a internet de novo e olhe o cartão logo em seguida. | Bolinha ciano com "Conectando…" (no cartão e na notificação; pode durar só um instante) e, em poucos segundos, verde com "Conectado · <servidor>". | ☐ | ☐ |
| 16.63 | Troque a senha do ramal no PABX com o app em segundo plano (a recusa chega em até 5 min, 9.8). Olhe a notificação fixa, abra o app e aperte Voltar na tela Entrar que abrir. Depois, conserte: menu → Configurações → lápis de Editar conta, com a senha certa. | A notificação fixa mostra "Ramal ou senha incorretos."; o app abre o Editar conta com a mesma frase. Depois do Voltar, o cartão tem a bolinha cinza, o triângulo amarelo e "Ramal ou senha incorretos.". Entrando com a senha certa, volta o verde. | ☐ | ☐ |
| 16.64 | Com a letra normal, ponha o celular num Wi-Fi sem internet (o roteador com o cabo do provedor desligado) e desligue os dados móveis. Espere e olhe o cartão. Anote o tempo até mudar: `____`. | Primeiro "Conectando…" (ciano). Depois, bolinha cinza, sem o triângulo, com a frase inteira no cartão e na notificação fixa: "Não foi possível falar com o servidor. Confira o endereço e a sua internet.". No cartão, a frase ocupa duas linhas num celular comum (até quatro, num celular estreito), e o final, "Confira o endereço e a sua internet.", tem de aparecer inteiro; nos outros estados, como "Sem internet · tentando de novo", a linha do cartão continua numa só. Quando a internet volta: "Conectando…" e "Conectado · <servidor>" sozinhos. A mesma frase, inteira, aparece embaixo da senha no Entrar com um endereço errado (2.5). | ☐ | ☐ |
| 16.65 | Faça uma ligação para o cliente e, com ela em andamento, olhe a tela de chamada, a tela principal (Voltar) e a notificação fixa. Depois, com uma ligação tocando (o cliente liga), puxe a gaveta de notificações. | Na tela de chamada, no alto, a bolinha vermelha com "Ocupado · em ligação" e o seu ramal à direita. Na tela principal, a faixa ciano "Ligação em andamento. Toque para voltar." e, no cartão, a bolinha vermelha com "Ocupado · em ligação". A notificação fixa diz "Ocupado · em ligação", também enquanto a ligação toca. | ☐ | ☐ |
| 16.66 | Com o Não perturbe ligado: tire a internet; ponha a internet de volta; faça uma ligação. | Sem internet: cinza com "Sem internet · tentando de novo" (não vermelha). Com a internet de volta: "Conectando…" e depois vermelha com "Não perturbe · as ligações não tocam". Na ligação: vermelha com "Ocupado · em ligação"; ao desligar, "Não perturbe · as ligações não tocam". | ☐ | ☐ |

### Configurações e Permissões

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 16.67 | Menu → Configurações → "Permissões e bateria". Aperte a tecla Voltar do celular. Abra de novo e toque em "Continuar". | A tela Permissões abre, com os quatro avisos. O Voltar do celular (como o da barra e o Continuar) volta às Configurações, e o app não fecha. | ☐ | ☐ |
| 16.68 | Ligue o Não perturbe e o Atender automático, ponha o tempo em 8 s e desligue o bipe. Em Configurações → Conta, toque em "Sair da conta", em "Cancelar" e de novo em "Sair da conta" e "Sair". Entre de novo com o mesmo ramal e siga as Permissões, se aparecerem. | "Cancelar" não muda nada. "Sair" volta à tela Entrar. Depois do novo Entrar, as duas pílulas estão ligadas, e em Configurações → Ligações o tempo continua em "8 s" e o bipe, desligado. As chaves valem de novo: o cliente ouve ocupado. Ponha tudo como veio de fábrica. | ☐ | ☐ |
| 16.69 | (Opcional) Com a 0.2.0-rc.1 instalada e usada (conta, contatos, Recentes), atualize para a rc.2 pelo aviso (7.2 a 7.9). | O aviso mostra as notas desta versão (sem palavras técnicas, terminando em "Esta é uma versão de teste."). Depois de atualizar, o app abre conectado, sem pedir a senha, e com os Recentes de antes. Os padrões das chaves novas: Não perturbe e Atender automático desligados, tempo de 3 s e bipe ligado. | ☐ | ☐ |

### Da revisão final

Estas três linhas vêm da última revisão do código da 0.2.0-rc.2, que corrigiu o que ela achou. Faça depois das outras.

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 16.70 | Com o Atender automático ligado, reinicie o celular, desbloqueie e não abra o app (é o começo do 16.39: se a ligação que continuou tocando já está na sua mão, siga daqui). Ligue do cliente. Se a ligação continuar tocando depois do tempo (o Android não deixou atender sozinho), atenda à mão, converse e, no meio da ligação, aperte o botão Início do celular (ou faça o gesto de ir para a tela inicial). Continue falando uns 15 segundos. | O cliente continua ouvindo você durante a ligação toda, também depois do Início, com o app fora da tela. Se a ligação foi atendida sozinha, o Android não recusou nada: não há o que conferir aqui; anote o celular e o Android, e repita em outra ocasião. Se o cliente deixou de ouvir você depois do Início, anote e mande o diagnóstico (Sobre → Enviar diagnóstico). | ☐ | ☐ |
| 16.71 | Num celular pequeno (uns 360 dp de largura, como no 16.24), com a letra no máximo e o uso da bateria sem permissão, abra o Teclado e puxe o dedo para cima até aparecerem as teclas e o Ligar. Depois, puxe o dedo para baixo, quantas vezes precisar, até o fim. Repita no Recentes e no Contatos, com muitos itens. | Ao subir, o cabeçalho (o menu, o "Não perturbe", o "Atender automático" e a linha da conta) e a faixa de aviso saem pelo alto; a barra de baixo fica parada e inteira; e o alto da tela, atrás da barra de status do Android, fica azul-marinho, com os ícones dela legíveis. Ao puxar para baixo, a aba volta ao começo e, em seguida, o cabeçalho e a faixa voltam inteiros. Esta é a única conferência dessa volta (não há teste automático): anote se o cabeçalho ficou preso em cima, sem voltar. | ☐ | ☐ |
| 16.72 | Tire o app da lista de apps recentes e abra pelo ícone. Olhe a tela de abertura, o fundo que aparece antes da tela principal. Se passar rápido demais, repita algumas vezes (ou grave a tela do celular e veja o vídeo devagar). | O fundo da abertura é o azul-marinho bem escuro do cabeçalho da tela principal, e não o azul-arroxeado de antes. A tela principal aparece sem um pulo de cor. | ☐ | ☐ |

## 17. Bipe ao digitar (0.2.0-rc.3)

Cada tecla do Teclado e do teclado da ligação faz o bipe de telefone (os tons do app de telefone do Android). Comece com o celular no modo normal (com som), o volume do toque no meio e, em Configurações → Ligações, "Bipe ao digitar" ligado (ele vem ligado). Para as ligações, use o cliente da seção 11.

| # | Passo | Resultado esperado | A1 | A2 |
|---|-------|--------------------|----|----|
| 17.1 | Quem atualizou da 0.2.0-rc.2 (seção 7): abra Menu → Configurações e olhe a parte "Ligações". | Logo abaixo de "Bipe quando a ligação cai ou termina", a chave "Bipe ao digitar", ligada, com "Vem ligado. Cada tecla faz o bipe de telefone. Com o celular no silencioso, só toca durante a ligação." embaixo. As outras chaves de "Ligações" continuam como estavam. | ☐ | ☐ |
| 17.2 | No Teclado, toque cada tecla, uma de cada vez: do 1 ao 9, o *, o 0 e o #. | Cada tecla faz um bipe curto de telefone, cada uma com o seu som (como no app de telefone do celular), e o número aparece no campo. Se não ouvir nada, confira o volume do toque (num Samsung, o volume de Sistema). | ☐ | ☐ |
| 17.3 | Digite rápido um número comprido (uns 11 dígitos). | Um bipe para cada tecla, e o número aparece inteiro, sem atraso. | ☐ | ☐ |
| 17.4 | Toque no Apagar e numa sugestão de contato. | Nenhum dos dois faz o bipe. | ☐ | ☐ |
| 17.5 | Nas configurações do Android (Som), aumente e diminua o volume do toque (num Samsung, o volume de Sistema) e digite no Teclado depois de cada mudança. | O bipe fica mais alto ou mais baixo junto com esse volume. | ☐ | ☐ |
| 17.6 | Ponha o celular no silencioso e digite no Teclado. Depois, ponha só vibrando e digite de novo. No fim, volte ao som normal. | Nenhum bipe, nos dois modos; os números aparecem no campo. | ☐ | ☐ |
| 17.7 | Plugue um fone com fio (ou conecte um fone Bluetooth) e digite no Teclado. | O bipe sai no fone, e não no alto-falante do celular. | ☐ | ☐ |
| 17.8 | Ligue para o cliente e, com a ligação em andamento, toque em Teclado (o teclado da ligação) e digite algumas teclas, com o celular no ouvido. | Cada tecla faz o bipe no fone do ouvido, junto com o som da ligação, e as teclas continuam chegando do outro lado, como no 5.5. | ☐ | ☐ |
| 17.9 | Na mesma ligação, ligue o viva-voz e digite. Depois, ponha o celular só vibrando e digite de novo. | No viva-voz, o bipe sai no alto-falante. Só vibrando, o bipe continua na ligação. | ☐ | ☐ |
| 17.10 | Ligue para uma URA (um menu de atendimento, do tipo "digite 1 para…", como no 5.5) e, no viva-voz, escolha uma opção com uma tecla. Repita com o celular no ouvido. | O menu entende a tecla uma vez só. Se ele entender duas vezes (pular duas opções ou repetir o número), anote se foi no viva-voz, no ouvido ou nos dois. | ☐ | ☐ |
| 17.11 | Em Configurações → Ligações, desligue "Bipe ao digitar". Digite no Teclado e, numa ligação, no teclado da ligação. Tire o app da lista de apps recentes, abra de novo e olhe a chave. No fim, ligue a chave de novo. | Nenhum bipe, e os números continuam aparecendo e indo para a ligação. A chave continua desligada depois de abrir o app de novo. | ☐ | ☐ |
| 17.12 | Com a letra do celular no máximo, abra Configurações e olhe a linha "Bipe ao digitar". | O título e o texto inteiros, sem palavra quebrada no meio; a chave ao lado, ou embaixo do texto quando não cabe. | ☐ | ☐ |

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

### Critérios da 0.2.0-rc.2 (spec do visual do Windows, §1 e §11)

| Critério | Automático (a cada build) | Neste roteiro |
|----------|---------------------------|---------------|
| O visual do Windows em todas as telas, nos temas claro e escuro e com a letra no máximo | `StarsonicColorsTest` (as cores), `MainScreenTest` (os dois temas, o menu e a letra no máximo: a faixa de aviso com o Teclado e a navegação à mão em `theBannerLeavesTheDialerAndTheNavUsableAtTheLargestFontScale`, o número à vista em `theTypedNumberStaysInViewAtTheLargestFontScale`), `SettingsFlowTest` (as telas de dentro nos dois temas, o passo a passo do fabricante e as palavras inteiras com a letra no máximo: `thePermissionRowsKeepTheirWordsWholeAtTheLargestFont`, `theSettingsKeepTheirWordsWholeAtTheLargestFont`, `theSupportRowOfSobreKeepsItsWordsWholeAtTheLargestFont`), `CallFlowTest` (a segunda ligação, a consulta e a conferência, a letra no máximo na recebida e `theTransferPanelKeepsItsButtonsWholeAtTheLargestFont`), os prints que o CI guarda (`telas-<sha>`), comparados com o canvas; a volta do cabeçalho e a tela de abertura só no manual | 16.1 a 16.25, 16.71, 16.72 |
| Não perturbe: quem liga ouve ocupado, a perdida fica sem som, a que já toca continua, e a chave fica gravada | `CallManagerTest` (`do not disturb answers busy and logs a silent missed call`, `do not disturb spares the call already ringing`, `do not disturb wins over auto answer`), `CallSettingsStoreTest`, `CallFlowTest` (`doNotDisturbMakesTheCallerHearBusy`), `MainScreenTest` (`theChipsToggleAndChangeTheDot`) | 16.26 a 16.30, 16.41, 16.43 |
| Atender automático: o tempo, a contagem na recebida e só a mesma ligação que ainda toca; nada com uma segunda ligação, com o Não perturbe ou com uma ligação da operadora | `CallManagerTest` (`auto answer …`: o tempo, na hora, a segunda ligação, o Não perturbe, a ligação da operadora, a que parou de tocar e o microfone recusado), `CallFormatTest` (a contagem), `SettingsFormatTest`, `CallFlowTest` (`autoAnswerAnswersByItselfAfterTheTime`, `theIncomingScreenCountsDownTheAutoAnswer`), `SettingsFlowTest` (`autoAnswerAndItsTimeAreRemembered`) | 16.31 a 16.45 |
| Atender automático com o app fechado, com a tela apagada e logo depois de reiniciar o celular (o Android 14 pode recusar o microfone) | `ForegroundReentryTest` (JVM: o microfone recusado volta quando a pessoa atende à mão); o resto, só no manual (o emulador não repete a recusa do Android) | 16.36, 16.39, 16.70 |
| Rediscar: apagado sem ligação feita, liga para a feita mais nova, o nome no aperto longo e também na Nova ligação | `RedialTest`, `MainScreenTest` (`rediscarIsDisabledUntilACallIsMadeThenDialsTheLastOne`), `CallFlowTest` (`rediscarInNovaLigacaoDialsTheLastCall`) | 16.57 a 16.59 |
| A bolinha nos seis estados e a notificação fixa com o mesmo título | `StatusModelTest` (as seis linhas e os empates), `ConnectionTest`, `ConnectionNoticeTest`, `ServiceTest`, `MainScreenTest` (o título "Não perturbe (ramal …)"; o aviso do servidor inteiro no cartão, em `theUnreachableServerMessageIsWholeInTheAccountCard`), `CallFlowTest` (`theCallScreenShowsOcupadoEmLigacao`), `AboutAndAccountTest` (a senha recusada); "Sem internet" e "Conectando…" só na JVM | 16.60 a 16.66 |
| O bipe no fim da ligação: quando toca, onde toca (fone, headset, Bluetooth) e quando não toca | `CallManagerTest` (`an answered call that ends beeps once and then disconnects`, `a rejected, missed or unanswered call never beeps`, `no beep while another call remains, one when the last answered call ends`, `no beep with the setting off`, `no beep for a call held by a carrier call`, `the end beep never holds the Connection more than 1500 ms`, `a call during the end beep is not delayed or blocked`), `EndBeepToneTest` (o som), `EndBeepTimesTest` (o fim pela marca e pelo tempo); o fone, o headset e o Bluetooth, só no manual | 16.46 a 16.56 |
| Configurações: as chaves ficam gravadas e continuam depois do "Sair da conta" | `CallSettingsStoreTest` (`call settings survive sign out`), `SettingsFlowTest` (`sairDaContaAsksFirstAndKeepsTheCallSettings`, `theBeepSwitchStartsOnAndIsRemembered`) | 16.9, 16.67 a 16.69 |
| A tecla Voltar na tela Permissões | `SettingsFlowTest` (`backOnPermissoesAfterTheFirstEntrarGoesToTheMainScreen`, `backOnPermissoesFromConfiguracoesReturnsToConfiguracoes`) | 16.3, 16.67 |

### Critérios da 0.2.0-rc.3 (o Bipe ao digitar)

| Critério | Automático (a cada build) | Neste roteiro |
|----------|---------------------------|---------------|
| Cada tecla do Teclado faz o bipe de telefone, com o som dela; nenhum no silencioso ou só vibrando | `KeyToneTest` (JVM: o tom de cada tecla e quando ele toca), `MainScreenTest` (`theKeysBeepWhileTypingUnlessThePhoneIsQuietOrTheSettingIsOff`: tocou, quieto só vibrando, desligado) | 17.2 a 17.7 |
| O teclado da ligação bipa junto com o som dela, também só vibrando, e o menu de atendimento entende cada tecla uma vez | `KeyToneTest`, `CallFlowTest` (`theCallKeypadBeepsEvenWithThePhoneOnVibrate`) | 17.8 a 17.10 |
| A chave "Bipe ao digitar": ligada de fábrica (também para quem vem da rc.2), gravada, depois do "Sair da conta" e inteira com a letra no máximo | `CallSettingsStoreTest` (`a file from before the key tones reads them as on`, `call settings survive sign out`), `SettingsFlowTest` (`theKeyToneSwitchStartsOnAndIsRemembered`, `sairDaContaAsksFirstAndKeepsTheCallSettings`, `theSettingsKeepTheirWordsWholeAtTheLargestFont`) | 17.1, 17.11, 17.12 |
