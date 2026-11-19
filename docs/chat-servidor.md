# Starsonic Chat: o guia do servidor

Este guia é para quem instala e cuida do servidor do chat. Você não precisa saber programar.

Como usar:

- Cada comando fica numa linha só. Copie a linha inteira e cole no terminal da VM.
- Onde aparece algo entre `<` e `>`, troque pelo seu valor, sem os sinais. Exemplo: `<endereço>` vira `chat.exemplo.com.br`.
- Depois de cada comando, o guia diz o que você deve ver. Se aparecer outra coisa, vá para o passo 11.
- Se o chat usa uma porta própria (o `--porta` do passo 2), todo endereço `https://<endereço>` deste guia leva `:` e a porta depois do nome, por exemplo `https://<endereço>:8443/admin/`.

## 1. O que a VM precisa

| O quê | Quanto |
|---|---|
| Processador | 2 vCPU |
| Memória | 2 GB |
| Disco | 120 GB SSD (20 GB para o sistema e o banco, 100 GB para os arquivos) |
| Sistema | Ubuntu 24.04 ou 26.04 (ou Debian 12), com systemd |
| Rede | um endereço público fixo, da VM ou do roteador na frente dela (veja "Se a VM fica atrás de um roteador", no fim deste passo) |

Antes de instalar, deixe três coisas prontas:

1. **O nome do chat no DNS.** Escolha um nome, por exemplo `chat.exemplo.com.br`. No DNS da Starsonic, crie um registro do tipo A com esse nome, apontando para o endereço público da VM. O certificado (o cadeado) é pedido ao Let's Encrypt só depois que o nome aponta para a VM. Esse nome é o `<endereço>` deste guia. Aponte o nome direto para a VM: não ponha o chat atrás de um proxy nem de uma CDN. O chat limita as tentativas pelo endereço de quem acessa, e atrás de um proxy todos teriam o mesmo endereço e dividiriam o mesmo limite. Se o DNS do domínio fica na Cloudflare, deixe esse registro como **Somente DNS** (a nuvem cinza): com a nuvem laranja, a Cloudflare fica no meio, como um proxy.
2. **As portas 80 e 443 abertas**, na rede da nuvem e em qualquer firewall. A 443 é o chat. A 80 serve para o Let's Encrypt e leva quem entrar por ela para a 443. As duas têm de estar livres na VM.
3. **Um lugar para a cópia de segurança, fora da VM.** Pode ser outro servidor da Starsonic ou um armazenamento na nuvem. Precisa de uns 150 GB.

Para conferir o nome no DNS, rode na VM:

```
getent hosts <endereço>
```

Você deve ver uma linha com o endereço público da VM (ou o do roteador, se ela fica atrás de um). Se não aparecer nada, o DNS ainda não está pronto: espere e tente de novo.

O disco cresce com os arquivos. Quando chegar perto de 80% de uso, aumente o disco. As cópias dos últimos 30 dias também ficam na VM, em `/var/lib/starsonic-chat/copias`.

### Se a VM fica atrás de um roteador (NAT)

Quando a VM fica na rede interna da empresa, sem um endereço público só dela, quem recebe as conexões da internet é o roteador. Nesse caso:

- O registro A do DNS aponta para o **endereço público do roteador**, o da internet da empresa. Para ver qual é, rode na VM:

```
curl -s https://ifconfig.me
```

- No roteador, crie duas regras de redirecionamento de porta (NAT, ou port forwarding) para o endereço interno da VM: a porta **80** pública vai para a porta **80** da VM, e a **443** pública vai para a **443** da VM.
- Use o redirecionamento de porta comum, que mantém o endereço de quem acessa. Não use um proxy.
- A internet da empresa precisa ter um endereço público fixo. Se a operadora usa CGNAT (um endereço dividido com outros clientes), não dá para redirecionar porta: peça à operadora um endereço público fixo.
- Os computadores da mesma rede da VM só abrem o chat pelo nome se o roteador fizer "NAT loopback". Se ele não fizer e o chat usa a 443 normal, crie no DNS interno o mesmo nome apontando para o endereço interno da VM. Com a porta própria do chat (logo abaixo), o DNS interno não serve, porque a VM não escuta nessa porta: aí o roteador precisa fazer o NAT loopback.
- Com o NAT loopback, o chat vê todos os computadores da rede com um endereço só, o do roteador, e eles dividem os limites de tentativas erradas (de código e de senha). Para uma equipe pequena, isso não atrapalha.

**Se a porta 443 pública já é de outro servidor** (por exemplo, o GLPI), o chat pode usar outra porta pública:

- No roteador, a porta **80** pública vai para a **80** da VM, e uma porta livre, por exemplo a **8443**, vai para a **443** da VM.
- No passo 2, instale com `--porta 8443`. O endereço do chat passa a ser `https://<endereço>:8443`, e é esse endereço, com a porta, que vai no navegador e no app. Salve-o nos favoritos já com a porta.
- Depois da primeira visita, o navegador passa a usar sempre o cadeado para esse nome. Se alguém digitar o nome sem a porta, o navegador vai para a 443, que é do outro servidor, e mostra um erro de segurança que não deixa continuar. Não é defeito: é só escrever o endereço com a porta.
- A regra da porta 80 tem de ficar **sempre ligada**. É por ela que o Let's Encrypt confere o nome, no primeiro cadeado e em toda renovação, a cada dois meses. Sem ela, o cadeado vence e o chat para de abrir.
- Algumas empresas bloqueiam, no firewall delas, a saída para portas fora do comum, e nelas o chat não conecta. Um segundo endereço público, só para o chat, evita isso: com ele, o chat fica na 443 normal.
- O primeiro cadeado precisa de um cuidado: veja "O cadeado não sai e o registro fala em `rateLimited`", no passo 11.

## 2. Instalar

Veja o número da última versão do chat na página de Releases do projeto no GitHub. As versões do chat se chamam `chat-v` e o número. O GitHub mostra essas versões com a etiqueta `Pre-release`: isso é normal, e é a versão certa. Se a versão for `chat-v0.1.0`, o `<versão>` é `0.1.0`. Se ainda não existir nenhuma versão `chat-v` na página, publique a primeira pelo passo 12 (Publicar uma versão, no fim deste guia).

Baixe o instalador:

```
curl -fsSLO https://github.com/LucasCPena/starsonic-phone/releases/download/chat-v<versão>/instalar.sh
```

Não aparece nada. Se der erro, confira o número da versão.

Rode o instalador:

```
sudo bash instalar.sh instalar <endereço>
```

Se a VM fica atrás de um roteador e a porta 443 pública já é de outro servidor (passo 1), acrescente a porta pública do chat:

```
sudo bash instalar.sh instalar <endereço> --porta 8443
```

Você deve ver:

- `SHA-256 conferido.`
- no fim, `Pronto: o Starsonic Chat <versão> está instalado e ligado em https://<endereço>/`. Com `--porta`, o endereço vem com a porta, e uma linha lembra as duas regras do roteador.

O instalador confere se o sistema serve, se as portas 80 e 443 estão livres e se o programa baixado não foi alterado. Se algo estiver errado, ele para com uma frase dizendo o quê, e não instala nada pela metade.

Confira que o serviço está ligado:

```
systemctl status starsonic-chat
```

Você deve ver `active (running)` em verde. Aperte `q` para sair.

## 3. Criar o usuário da administração

A página de administração abre com usuário e senha. Rode sempre os comandos de usuário como o usuário do serviço (`starsonic-chat`), como abaixo. Assim o banco continua sendo dele. Na primeira vez que usar `sudo`, a VM pode pedir a sua própria senha de entrada na VM. Digite a senha (ela não aparece) e aperte Enter.

```
sudo -u starsonic-chat starsonic-chat admin-criar <usuário> --dados /var/lib/starsonic-chat
```

O programa pede a senha duas vezes (`Senha:` e `Repita a senha:`). Nada aparece enquanto você digita, e isso é normal. A senha precisa ter pelo menos 12 caracteres.

Você deve ver: `Usuário <usuário> criado.`

Para trocar a senha de um usuário (isso também encerra as sessões dele):

```
sudo -u starsonic-chat starsonic-chat admin-senha <usuário> --dados /var/lib/starsonic-chat
```

Para remover um usuário:

```
sudo -u starsonic-chat starsonic-chat admin-remover <usuário> --dados /var/lib/starsonic-chat
```

Depois de 5 senhas erradas, o usuário trava, e a página mostra `Muitas tentativas. Tente de novo daqui a 15 minutos.` A trava acaba sozinha em 15 minutos, também depois de trocar a senha. Para soltar na hora, reinicie o serviço:

```
sudo systemctl restart starsonic-chat
```

Reiniciar o chat mexe nas reuniões que estão no ar no navegador: quem está nelas continua vendo e ouvindo, mas as páginas passam a mostrar a imagem de todos junta, sem os quadros e sem os nomes, até a pessoa sair e entrar de novo (veja o passo 7). Faça isso num horário sem reuniões.

## 4. Conferir a instalação

Faça estas conferências uma vez, logo depois de instalar.

Se você instalou com `--porta`, ponha `:` e a porta depois do nome em todos os endereços com `https` deste passo, por exemplo `https://<endereço>:8443/admin/`. Sem a porta, o navegador vai para a 443, que é de outro servidor. E se o roteador não faz NAT loopback (passo 1), os testes com `https` só funcionam de um computador fora da rede da VM.

**O cadeado.** No navegador, abra `https://<endereço>/admin/`. A primeira vez pode demorar alguns segundos, porque o certificado é pedido nessa hora. Você deve ver a tela de entrada, com o cadeado fechado, sem nenhum aviso. Entre com o usuário do passo 3.

**Os três testes de rede.** Rode na VM, ou em qualquer outro computador:

```
curl -sI https://<endereço>/admin/
```

Entre as linhas, deve haver `strict-transport-security`. Ela é o aviso para o navegador usar sempre o cadeado.

```
curl -sI http://<endereço>/admin/
```

Deve aparecer `301 Moved Permanently` e uma linha `location: https://<endereço>/admin/`, com a porta depois do nome se você instalou com `--porta`. É a porta 80 levando para o cadeado. Este teste é o único sem a porta: ele é sempre na 80.

```
curl --tlsv1.1 --tls-max 1.1 --ciphers DEFAULT@SECLEVEL=0 https://<endereço>/
```

Deve dar **erro** (algo como `curl: (35)`). Isso é o certo: o servidor recusa o TLS 1.1, que é antigo e inseguro. Se a página abrir, avise quem cuida do chat.

```
curl --tlsv1.2 --tls-max 1.2 -sI https://<endereço>/admin/
```

Este, ao contrário, deve **funcionar**: aparece `HTTP/2 200` (ou `HTTP/1.1 200`). Ele prova que o erro do teste anterior veio do servidor, e não do seu computador.

**Uma empresa de teste.** Na página de administração:

1. Clique em `Nova empresa`, escreva o nome `Teste` e clique em `Criar a empresa`.
2. Na página da empresa, veja o `CÓDIGO DE ENTRADA`. É esse código que o técnico digita no app para ligar um computador à empresa. Veja que o código aparece e que o botão `Copiar o código` funciona.
3. Clique em `Apagar a empresa` e siga o que a página pedir. A empresa de teste some da lista.

## 5. Configurar a cópia de segurança

Toda noite, às 03:00 (horário de Brasília), o servidor faz uma cópia do banco e a manda, junto com os arquivos, para o destino fora da VM. As cópias ficam 30 dias. Falta dizer ao servidor qual é o destino.

O programa que envia se chama rclone, e o instalador já o colocou na VM. Rode a configuração como o usuário do serviço:

```
sudo -u starsonic-chat -H rclone config
```

Responda assim:

1. Digite `n` e Enter (um destino novo).
2. Em `name`, digite exatamente `starsonic-chat-copia` e Enter. Esse nome não pode ser outro.
3. Em `Storage`, escolha o tipo do destino da Starsonic. A lista tem um número para cada tipo (por exemplo, `sftp` para outro servidor, ou uma pasta de um armazenamento que tenha pastas, como o OneDrive). Digite o número e Enter.
4. Responda as perguntas seguintes com os dados do destino. Na dúvida, aperte Enter para aceitar o que já vem escrito.
5. No fim, digite `y` para guardar e depois `q` para sair.

**Guarde os dados de acesso ao destino** (servidor, usuário, senha ou chave) num lugar fora da VM, como o cofre de senhas da Starsonic. A configuração do rclone fica no disco da VM e se perde com ele, e o passo 6 precisa desses dados para voltar uma cópia.

Confira que o destino ficou guardado:

```
sudo -u starsonic-chat -H rclone listremotes
```

Você deve ver `starsonic-chat-copia:`.

Teste a cópia agora, sem esperar a noite. O comando só volta quando a cópia termina:

```
sudo systemctl start starsonic-chat-copia.service
```

Veja o resultado:

```
sudo journalctl -u starsonic-chat-copia -n 20 --no-pager
```

Você deve ver, no fim, `starsonic-chat-copia: pronto.` Num servidor novo, também aparece `a pasta de arquivos está vazia; pulei o envio dos arquivos.` Isso é normal: ainda não há arquivos para enviar.

Confira no destino:

```
sudo -u starsonic-chat -H rclone ls starsonic-chat-copia:copias
```

Deve aparecer o arquivo `chat-` com a data de hoje e `.db`.

Se aparecer `ERRO: o destino starsonic-chat-copia não está configurado`, o nome do destino ficou diferente. Refaça a configuração com o nome certo. Mesmo com esse erro, a cópia fica guardada na VM, em `/var/lib/starsonic-chat/copias`.

Para ver se a cópia da noite rodou:

```
systemctl list-timers starsonic-chat-copia.timer
```

Deve aparecer a próxima rodada, às 03:00 de Brasília (06:00 no horário da VM, se ela usar UTC).

## 6. Voltar uma cópia

Use isto se o banco estragou ou se a VM foi refeita. Quem escreveu depois da cópia perde as mensagens desse intervalo: a cópia traz o chat como estava às 03:00 daquele dia.

Faça os passos na ordem. Não pule nenhum, a não ser quando o próprio texto mandar pular.

1. Pare a cópia da noite e o serviço. Faça isto antes de qualquer outra coisa. **Se a VM foi refeita, pule o item 1 e vá ao item 2.** Numa VM refeita, estes dois ainda não existem, e o item 2 manda parar os dois depois de instalar o chat. A razão: uma cópia feita antes de você terminar seria a cópia de um servidor vazio, e poderia tomar o lugar da cópia boa no destino.

```
sudo systemctl stop starsonic-chat-copia.timer
```

```
sudo systemctl stop starsonic-chat
```

2. Escolha a cópia.

   **Se o disco da VM está bom,** veja as cópias que estão nele:

```
sudo ls /var/lib/starsonic-chat/copias
```

   Anote o nome do dia que você quer, por exemplo `chat-2026-11-04.db`. A mais nova é a que tem a data mais recente.

   **Se a VM foi refeita (disco novo),** instale o chat de novo (passo 2). O instalador liga o serviço e a cópia da noite, então pare os dois de novo agora, antes de qualquer outra coisa:

```
sudo systemctl stop starsonic-chat-copia.timer
```

```
sudo systemctl stop starsonic-chat
```

   Depois faça só a configuração do destino do passo 5 (o `rclone config`). **Não** faça o "Teste a cópia agora". Você vai precisar dos dados de acesso ao destino (servidor, usuário, senha ou chave): é por isso que o passo 5 manda guardá-los fora da VM. Veja as cópias que estão no destino:

```
sudo -u starsonic-chat -H rclone lsf starsonic-chat-copia:copias
```

   A lista mostra um `chat-` com a data e `.db` por linha. Escolha a data mais recente. Baixe essa cópia:

```
sudo -u starsonic-chat -H rclone copy starsonic-chat-copia:copias/chat-<data>.db /var/lib/starsonic-chat/copias
```

   Uma cópia que foi trocada por outra de mesmo nome no destino não se perde: a antiga fica em `apagados`, na pasta da data da troca, dentro de `copias`, por 30 dias.

3. Tire os arquivos `-wal` e `-shm` do banco. Eles são restos do banco antigo. Se ficarem, o banco voltado se estraga:

```
sudo rm -f /var/lib/starsonic-chat/chat.db-wal /var/lib/starsonic-chat/chat.db-shm
```

4. Guarde o banco estragado, se ele existir, e ponha a cópia no lugar dele. Faça como o usuário do serviço, para o dono ficar certo:

```
sudo -u starsonic-chat mv -f /var/lib/starsonic-chat/chat.db /var/lib/starsonic-chat/chat.db.antigo
```

   Se aparecer `No such file or directory`, não tem problema: não havia banco. Siga em frente.

```
sudo -u starsonic-chat cp /var/lib/starsonic-chat/copias/chat-<data>.db /var/lib/starsonic-chat/chat.db
```

5. Se o disco foi perdido, traga também os arquivos, ainda com o timer parado:

```
sudo -u starsonic-chat -H rclone copy starsonic-chat-copia:arquivos /var/lib/starsonic-chat/arquivos
```

   Agora feche o acesso a esses arquivos, para que só o chat possa lê-los, como tudo o que o chat grava:

```
sudo chmod -R go-rwx /var/lib/starsonic-chat/arquivos
```

   O comando não escreve nada na tela quando dá certo.

6. Ligue o serviço:

```
sudo systemctl start starsonic-chat
```

   Confira com `systemctl status starsonic-chat` (deve estar `active (running)`) e entre na página de administração. Parar e ligar o chat é como reiniciá-lo, e mexe nas reuniões que estão no ar (veja "Uma reunião no ar quando o chat reinicia", no passo 7): faça tudo isto num horário sem reuniões.

7. Só agora ligue de novo a cópia da noite:

```
sudo systemctl start starsonic-chat-copia.timer
```

8. Quando estiver tudo certo, apague o banco antigo para liberar espaço:

```
sudo rm -f /var/lib/starsonic-chat/chat.db.antigo
```

**Se a VM foi refeita e o chat e o servidor de vídeo dividem um IP público só,** o repasse do certificado do vídeo e a linha do `/etc/hosts` não voltam com a cópia, porque não estão no banco. Rode de novo o comando `video` do passo 9 e refaça a linha do `/etc/hosts` (passo 1, parte "Se o chat e o vídeo dividem um IP público só", do guia do servidor de vídeo). Sem isso, a renovação do certificado do vídeo falha dali a algumas semanas.

### O que fica na pasta `apagados` do destino

A pasta `apagados` do destino é a rede de segurança por 30 dias. Cada noite, o que a cópia troca ou tira do destino vai para uma pasta com a data daquela noite, em vez de sumir:

- `apagados/<data>/arquivos`: arquivos que não existem mais na VM (por exemplo, os que saíram depois de 1 ano);
- `apagados/<data>/copias`: cópias do banco que foram trocadas por outra de mesmo nome.

Cada pasta de data é apagada quando passa de 30 dias. As cópias do banco que ficaram velhas saem da pasta `copias` do destino depois de 31 dias.

## 7. Atualizar

O servidor não se atualiza sozinho. Quando sair uma versão nova, baixe o instalador dela (o `<versão>` é o número novo):

```
curl -fsSLO https://github.com/LucasCPena/starsonic-phone/releases/download/chat-v<versão>/instalar.sh
```

E rode:

```
sudo bash instalar.sh atualizar
```

Você deve ver `SHA-256 conferido.` e, no fim, `Pronto: o Starsonic Chat agora está na versão <versão>.` O serviço reinicia sozinho, e quem está no chat volta a conectar em poucos segundos. As mensagens e os arquivos não mudam. As reuniões que estão no ar, no navegador, são outra coisa: veja o que acontece com elas logo abaixo.

**Uma reunião no ar quando o chat reinicia.** Atualizar o chat, ou reiniciá-lo, mexe nas reuniões que estão acontecendo no navegador. As pessoas que estão nelas continuam vendo e ouvindo: a imagem e o som não param. Mas a página de cada uma tenta voltar ao chat por alguns segundos e não consegue, porque o chat novo não conhece essa pessoa. Depois disso, a página de cada uma mostra a imagem de todos junta, sem os quadros e sem os nomes, e o `Compartilhar a tela` deixa de funcionar para ela. O chat da reunião (a partir da `0.2.0-rc.6`) também: o campo de escrever fica desligado, com `O chat volta quando a conexão voltar.`, e as mensagens que a pessoa já tinha continuam à vista. Fica assim até a pessoa sair da reunião e entrar de novo (ou recarregar a página). Quem é de fora, numa reunião marcada, espera de novo o colega aceitar: a entrada passa outra vez pela sala de espera. Até cada pessoa fazer isso, os outros veem `Participante` no lugar do nome dela. Quem entra depois vê os quadros normalmente, mas com `Participante` no lugar do nome de quem já estava. Por isso, atualize o chat, e reinicie-o, também num horário sem reuniões, como o guia já diz para o servidor de vídeo.

**O estado dos ramais (a partir da `0.2.0-rc.5`).** Com essa versão, a administração passa a mostrar o estado do ramal de cada pessoa: veja o passo 13. Não há nada para configurar. Os apps de hoje ainda não dizem ao chat como está o ramal: com eles, cada pessoa aparece como `No chat` (o app está aberto) ou `Offline`. O `Online` e o `Sem registro` chegam com a próxima versão do app do Windows, em cada PC que aceitar a atualização.

### Trocar a porta pública

Para mudar a porta do HTTPS de uma instalação que já existe, use o instalador da versão 0.1.1 ou mais nova, o mesmo baixado acima. Isso serve, por exemplo, quando a VM passou a ficar atrás de um roteador e a 443 pública é de outro servidor (passo 1):

```
sudo bash instalar.sh porta 8443
```

Você deve ver `Pronto: o chat agora está em https://<endereço>:8443/`, e uma linha lembrando as duas regras do roteador. Para voltar à porta normal, quando o chat ganhar um endereço público só dele, rode o mesmo comando com `443` no lugar de `8443`. O comando reinicia o chat: como o reinício mexe nas reuniões que estão no ar (veja "Uma reunião no ar quando o chat reinicia", acima), rode-o num horário sem reuniões.

Se o chat da VM ainda for de antes da versão 0.1.1, o comando avisa e não muda nada. Nesse caso, atualize primeiro, como acima, e rode o comando de novo.

## 8. Tirar uma pessoa antes de o ramal passar para outra

Quando alguém sai da empresa, tire a pessoa do chat **antes** de o ramal dela passar para outra pessoa. Se não, a pessoa nova com o mesmo ramal veria as conversas da anterior.

1. Abra `https://<endereço>/admin/` e entre.
2. Clique na empresa.
3. Em `PESSOAS NO CHAT`, ache a pessoa e clique em `Tirar do chat`.

Depois disso, o mesmo ramal entra como uma pessoa nova, sem as conversas antigas. Para tirar só um computador, clique no `×` dele.

## 9. As reuniões com link

A partir da versão 0.2.0, o chat também cuida das reuniões com link. O vídeo e o som delas passam por um servidor de vídeo, numa VM só dele, que tem o guia próprio: `docs/video-servidor.md`.

**O link da reunião abre a página, no navegador.** O link é `https://<endereço do chat>/r/<código>`, e é o próprio chat que serve a página: quem recebe o link não instala nada e não tem conta. O que a pessoa de fora vê:

- **Uma tela de entrada,** com o tipo da reunião (`Reunião marcada`, `Reunião agora` ou `Reunião de teste`) e o assunto. O navegador pede a câmera e o microfone, e ela escolhe se entra com eles ligados. Escreve o nome e clica em `Pedir para entrar`.
- **A espera.** O pedido chega aos colegas que estão na reunião, e a pessoa vê `Aguardando ser aceito…`. Sem resposta em 10 minutos, o pedido acaba. Se nenhum colega abriu a reunião ainda, ela vê `A reunião ainda não começou` e espera na página. A reunião de teste não tem sala de espera: a pessoa entra na hora.
- **A reunião,** com um quadro para cada pessoa (o palco, logo abaixo), o `Microfone`, a `Câmera`, o `Compartilhar a tela` (só em quem tem essa função no navegador: o PC, e não o celular), o `Chat` e o `Sair`. Em cima ficam o sinalizador de qualidade da conexão e o `Nada é gravado` (no celular em pé, o `Nada é gravado` não aparece ali, e o sinalizador é só o desenho das barras). O `Chat` e o sinalizador chegaram na `0.2.0-rc.6`: veja logo abaixo.
- **Os avisos,** no lugar da reunião: `Este link não vale mais` (cancelada, passou da data ou já acabou), `A reunião está cheia` (10 pessoas), `Muita gente esperando para entrar`, `Você foi tirado da reunião`, `A reunião acabou`, `Muitas tentativas` (o mesmo endereço tentou abrir links demais) e `O servidor de reuniões não respondeu` (o chat não alcançou o servidor de vídeo: veja o passo 9 do guia do vídeo, `docs/video-servidor.md`).

**O palco da reunião (a partir da `0.2.0-rc.4`).** O servidor de vídeo continua montando uma imagem só com todos, e a página recorta dela um quadro para cada pessoa: os quadros ocupam a tela no PC e no celular, um clique aumenta o quadro de alguém, e a tela compartilhada aparece grande. Quem diz à página onde está cada pessoa na imagem é o chat, com o que recebe do servidor de vídeo, e os nomes nos quadros são escritos pela própria página.

**A ordem de atualizar: o chat primeiro, e depois o servidor de vídeo.** A página nova do chat funciona com o servidor de vídeo antigo e mostra a imagem de todos numa só, como antes. Na ordem contrária, a página antiga mostraria a imagem nova sem os nomes das pessoas. Atualize o chat aqui (passo 7), e o servidor de vídeo depois, num horário sem reuniões (`docs/video-servidor.md`, passo 5).

**O chat da reunião e o sinalizador de qualidade (a partir da `0.2.0-rc.6`).** A página da reunião ganha duas coisas:

- **O chat da reunião.** O botão `Chat`, nos controles, abre o painel `Chat da reunião`. No PC, ele fica ao lado dos quadros, que se arrumam no espaço que sobra (numa janela com menos de 900 pontos de largura, ele cobre a janela inteira, como no celular). No celular, ele cobre a tela, com uma seta no alto para voltar: a reunião continua, com o som. O Voltar do próprio aparelho (o botão ou o gesto do Android, o gesto do iPhone) também só fecha o chat: a pessoa continua na reunião. Todos os que estão na reunião leem e escrevem, os colegas e quem é de fora. É só texto, e um endereço que começa com `http://` ou `https://` vira um link que abre em outra aba. Com o chat fechado, a mensagem nova mostra um número no botão `Chat` e um aviso curto, com o nome de quem escreveu, o começo do texto e o `Abrir o chat`. As mensagens vivem só na página de cada pessoa: quem entra depois não vê as de antes, quem sai perde as que tinha, e todas somem quando a reunião acaba. O servidor do chat só repassa cada mensagem: ela não fica guardada em servidor nenhum, e não aparece nos registros. O `Nada é gravado` continua valendo.
- **O sinalizador de qualidade.** No alto da tela, ao lado do `Nada é gravado`, cada pessoa vê como está a conexão **dela** com o servidor de vídeo: `Conexão boa`, `Conexão instável` ou `Conexão ruim`. Nos primeiros segundos, ele mostra `Medindo a conexão…`. No celular em pé, aparece só o desenho das barras, sem o texto e sem o `Nada é gravado` ao lado: três acesas na boa, duas na instável e uma na ruim. O nome do estado está no cartão, que um toque nas barras abre. Ninguém vê a conexão dos outros, e nada disso vai para o servidor. Um clique no sinalizador abre um cartão com a explicação, o que a pessoa pode fazer e dois números, como `Perda: 4% · Atraso: 210 ms`. Quando a conexão fica ruim, a página avisa com `Sua conexão está ruim`, no máximo uma vez a cada 2 minutos.

**Para o suporte:** quando alguém ligar dizendo que a imagem trava, peça que clique no sinalizador e leia os dois números. A perda é a parte da imagem e do som que se perde no caminho: abaixo de 2% é boa, e de 8% para cima é ruim. O atraso é o tempo de ida e volta até o servidor de vídeo: abaixo de 250 ms é bom, e de 500 ms para cima é ruim. Um número que o navegador não dá aparece como `—`. Se os números da pessoa estão bons e a imagem de alguém trava assim mesmo, o mais provável é que o problema não seja a internet dela: peça os números de quem aparece travado, e veja o passo 9 do guia do servidor de vídeo (`docs/video-servidor.md`).

Só o chat muda nesta versão: o servidor de vídeo e os apps ficam como estão. A atualização é a de sempre (passo 7), num horário sem reuniões. Quem estiver numa reunião na hora continua com a imagem e o som, na página que já estava aberta, que é a de antes: ela não tem o chat da reunião nem o sinalizador. Para tê-los, a pessoa **recarrega a página** (ou abre o link de novo) e entra outra vez. Só clicar em `Sair` e em `Entrar de novo` não basta: a página aberta continua sendo a antiga.

O endereço do chat precisa ser alcançável pelo navegador de quem entra, e o do servidor de vídeo também (a porta 443 dele, ou a 7443). Nada da reunião é gravado: a página diz `Nada é gravado` na entrada e, durante a reunião, no alto da tela (no celular em pé, só na entrada).

1. **Ligue o chat ao servidor de vídeo** pelo cartão `REUNIÕES` da lista das empresas, na administração do chat. Siga o passo 3 do guia do servidor de vídeo.
2. **Deixe a VM do chat alcançar a VM de vídeo na porta 443** (ou na 7443, se o chat e o vídeo dividem um IP público só: veja o item 4). O chat fala com o servidor de vídeo por HTTPS, pelo endereço dele. Se um firewall limita a saída da VM do chat, libere essa porta para a VM de vídeo. Se as duas VMs ficam atrás do mesmo roteador, a do chat chega à de vídeo pelo IP público, e o roteador precisa fazer o "NAT loopback" (passo 1).
3. **Guarde as cópias de segurança do chat com o mesmo cuidado que a chave do servidor de vídeo.** A chave fica no banco do chat, e a cópia da noite (passo 5) a leva junto: quem tem uma cópia tem a chave.
4. **Se o chat e o servidor de vídeo dividem um IP público só, use o comando `video`.** Nesse caso, as portas 80 e 443 públicas são do chat, e o vídeo usa a porta 7443. O certificado (o cadeado) do vídeo é pedido ao Let's Encrypt, que chega na porta 80 do **chat**. O comando `video` faz o chat levar só essa conferência, pela rede interna, até a VM de vídeo. Ele só é preciso nesse caso, e tem de ser rodado **antes** de instalar o servidor de vídeo. O chat tem de estar na versão 0.2.0 ou mais nova (passo 7). Rode na VM do chat, com o nome do servidor de vídeo e o IP da VM de vídeo na rede interna:

```
sudo bash instalar.sh video <nome do vídeo> <IP interno da VM de vídeo>
```

   O `instalar.sh` é o mesmo do passo 7. O comando reinicia o chat, e quem está no chat volta a conectar em poucos segundos. Como o reinício mexe nas reuniões que estão no ar (veja "Uma reunião no ar quando o chat reinicia", no passo 7), rode o comando num horário sem reuniões. Você deve ver uma linha que começa com `Pronto: o chat agora repassa ao servidor de vídeo`. A porta do chat, se ele usa uma própria, fica como está, e o comando `porta` (passo 7) também mantém o que o `video` guardou. Se o chat não ficar de pé, a configuração de antes volta sozinha. O comando recusa, sem mudar nada, um chat com `"origens"` no arquivo de configuração. Se a VM do chat for refeita, rode o comando de novo (passo 6). Os passos completos, do roteador ao cartão "Reuniões", estão em "Se o chat e o vídeo dividem um IP público só", no passo 1 do guia do servidor de vídeo (`docs/video-servidor.md`).

## 10. Ver os registros

Os registros do chat:

```
sudo journalctl -u starsonic-chat -n 50 --no-pager
```

Mostra as últimas 50 linhas. Para acompanhar ao vivo, rode o comando abaixo e aperte Ctrl e C para sair:

```
sudo journalctl -u starsonic-chat -f
```

Os registros da cópia da noite:

```
sudo journalctl -u starsonic-chat-copia -n 50 --no-pager
```

## 11. Os problemas comuns

**O certificado não sai (o navegador avisa que o site não é seguro, ou nada abre).**
O Let's Encrypt precisa achar a VM pelo nome. Rode `getent hosts <endereço>` e veja se o endereço que aparece é o da VM (ou o do roteador, se ela fica atrás de um). Se não for, corrija o registro A no DNS e espere alguns minutos. Depois veja os registros do passo 10: um erro de certificado aparece ali. O servidor tenta de novo sozinho, mas não insista muitas vezes seguidas: o Let's Encrypt limita os pedidos que falham.

Para ver só as linhas do certificado, rode na VM:

```
sudo journalctl -u starsonic-chat --no-pager | grep -i acme
```

As linhas que dizem `missing certificate` são de conexões que ficaram esperando o pedido. O motivo de verdade está numa linha com `unable to satisfy`, `urn:ietf:params:acme:error` ou `rateLimited`.

**O cadeado não sai e o registro fala em `rateLimited`.**
O Let's Encrypt aceita no máximo 5 conferências que falham por hora para o mesmo nome, e devolve uma a cada 12 minutos. Quando a 443 pública é de outro servidor (passo 1), todo pedido de cadeado gasta uma falha na conferência pela 443 antes de conferir pela 80. Com só uma tentativa livre, o pedido não chega à 80. Para tirar o **primeiro** cadeado:

1. Feche o chat no navegador e espere passar o horário que a linha do `rateLimited` mostra. O horário está em UTC: tire 3 horas para ter o de Brasília.
2. No roteador, aponte a 443 pública para a 443 da VM do chat. O outro servidor fica fora do ar por uns minutos.
3. Abra o chat uma vez, com a porta, e espere até 1 minuto.
4. Confira que o cadeado saiu:

```
sudo ls /var/lib/starsonic-chat/certificados
```

   Tem de aparecer um arquivo com o nome do chat, sem `+token` no fim.

5. No roteador, volte a 443 pública para o outro servidor.

As renovações, a cada dois meses, gastam só uma falha e cabem no limite.

**A página cai em outro servidor (como o GLPI).**
Quem escolhe a máquina de cada porta é o roteador, e a 443 pública está indo para outra máquina. Use a porta própria do chat (passo 1, "Se a porta 443 pública já é de outro servidor") e abra o chat com ela no endereço, por exemplo `https://<endereço>:8443/admin/`. Escreva sempre o `https://` na frente: com uma porta diferente, o navegador não põe o `https` sozinho. Se o navegador mostrar um erro de segurança que não deixa continuar, é o mesmo caso: o endereço foi aberto sem a porta.

**O navegador mostra "Não seguro", mas o cadeado já saiu.**
É lembrança de um aviso de antes, de quando o nome caía em outro servidor. Feche todas as janelas do navegador e abra de novo. Para conferir o cadeado de verdade, rode na VM (com a porta, se você instalou com `--porta`):

```
curl -sSI https://<endereço>/admin/entrar
```

A primeira linha deve ser `HTTP/2 200`, sem nenhum erro antes.

**As portas estão fechadas (o chat não abre de fora da VM).**
Confira se o servidor está escutando:

```
sudo ss -ltn
```

Devem aparecer linhas com `:80` e `:443`. Se aparecerem e o chat não abre de fora, a porta está fechada na rede da nuvem ou no firewall. Abra as portas 80 e 443 de entrada, para qualquer endereço. Atrás de um roteador, confira as regras de redirecionamento do passo 1.

Para saber se a porta 80 chega no chat vinda de fora, abra no celular, só no 4G e com o `http://` escrito:

```
http://<endereço>/.well-known/acme-challenge/teste
```

Se aparecer `acme/autocert: certificate cache miss`, a 80 chega no chat. Esse teste não gasta tentativa do Let's Encrypt.

**O instalador diz que a porta 80 ou 443 está em uso.**
Outro programa já usa a porta. Pare esse programa (por exemplo, `sudo systemctl stop nginx`, se ele existir) e rode o instalador de novo.

**O disco está cheio.**
Veja o uso:

```
df -h /var/lib/starsonic-chat
```

E veja o que ocupa o espaço:

```
sudo du -h -d 1 /var/lib/starsonic-chat
```

Se a coluna de uso passar de 80%, aumente o disco da VM na nuvem. Para liberar espaço agora, apague o `chat.db.antigo`, se existir (passo 6). Com o disco 100% cheio, o chat para de gravar mensagens: não deixe chegar lá.

**A cópia da noite não chegou ao destino.**
Veja o passo 5 (`sudo journalctl -u starsonic-chat-copia`). A mensagem diz o motivo. Para tentar de novo na hora: `sudo systemctl start starsonic-chat-copia.service`.

**A página de administração diz `Muitas tentativas. Tente de novo daqui a 15 minutos.`**
Espere 15 minutos, ou reinicie o serviço (passo 3).

**O serviço não liga.**
Rode `sudo journalctl -u starsonic-chat -n 50 --no-pager` e leia as últimas linhas. Uma linha que começa com `Erro:` diz o motivo. A configuração fica em `/etc/starsonic-chat/config.json`.

## 12. Publicar uma versão

Este passo é de quem publica o chat, e não da VM. Você faz tudo pelo site do GitHub, no navegador, e não precisa de comando para publicar.

1. Abra a página do projeto no GitHub e clique em `Actions`.
2. Na lista da esquerda, clique em `chat-release`.
3. Clique em `Run workflow`, à direita.
4. No campo `Versão a publicar`, escreva `0.1.0` (só o número, sem o `chat-v`). Para uma versão de teste, use `0.1.0-rc.1`.
5. Clique no botão verde `Run workflow` e espere. Leva alguns minutos.

O GitHub testa o programa, monta a versão e só publica no fim, quando todos os arquivos já estão lá. Se algo falhar no meio, nada fica publicado: abra o run, veja a mensagem em vermelho, corrija e rode de novo. Se sobrar um rascunho em `Releases`, apague-o antes de rodar de novo: o workflow para com a mensagem `já existe um rascunho` se ele ainda estiver lá.

### O que conferir depois

1. Em `Releases`, abra `chat-v0.1.0`. Ela deve ter a etiqueta `Pre-release` e estes sete arquivos (o GitHub mostra ainda duas linhas `Source code`, que ele cria sozinho e você pode ignorar):
   - `starsonic-chat-linux-amd64`
   - `starsonic-chat-linux-amd64.sha256`
   - `instalar.sh`
   - `copia.sh`
   - `starsonic-chat.service`
   - `starsonic-chat-copia.service`
   - `starsonic-chat-copia.timer`
2. O SHA-256: o número dentro do arquivo `starsonic-chat-linux-amd64.sha256` tem de ser o do programa. O `instalar.sh` já confere isso sozinho na instalação (você vê `SHA-256 conferido.`). Para conferir à mão, use a VM (o Windows não tem o `sha256sum`). Na VM, baixe o programa:

```
curl -fsSLO https://github.com/LucasCPena/starsonic-phone/releases/download/chat-v0.1.0/starsonic-chat-linux-amd64
```

Baixe o arquivo do SHA-256, na mesma pasta:

```
curl -fsSLO https://github.com/LucasCPena/starsonic-phone/releases/download/chat-v0.1.0/starsonic-chat-linux-amd64.sha256
```

E rode:

```
sha256sum -c starsonic-chat-linux-amd64.sha256
```

Deve aparecer `starsonic-chat-linux-amd64: OK`.

3. O endereço `releases/latest` tem de responder 404, ou mostrar uma versão do Windows (uma etiqueta que começa com `v`, como `v1.0.0`), porque o canal Estável dos apps lê esse endereço. Ele não pode mostrar a `chat-v…`. Rode:

```
curl -sI https://api.github.com/repos/LucasCPena/starsonic-phone/releases/latest
```

A primeira linha deve ter `404`. Se o Windows já tiver uma versão estável, o endereço responde `200`, e isso também está certo, desde que a versão seja a do Windows. O workflow confere isso no último passo e falha se o endereço apontar para outra coisa. Nesse caso, em `Releases`, abra essa release, clique em `Edit` e marque `Set as a pre-release` (ou apague a release e a etiqueta dela). Não instale nada antes disso.

Pronto: agora o passo 2 (instalar) e o passo 7 (atualizar) acham a versão nova.

## 13. Acompanhar os ramais dos clientes

A partir da versão 0.2.0-rc.5, a administração mostra o estado do ramal de cada pessoa que usa o app do Windows ligado ao chat. Serve para você ver quais ramais estão fora do ar sem esperar o cliente ligar reclamando. Não há nada para instalar nem configurar.

O `Online` e o `Sem registro` dependem do app do Windows: é a versão do app seguinte à `0.4.0-rc.1` que diz ao chat se o ramal está registrado. Cada PC passa a mostrar isso quando a pessoa aceita a atualização do app. Um PC em que ninguém aceita continua aparecendo só como `No chat`, com `o app é antigo e não diz o ramal`, ou `Offline`.

**Onde olhar.**

1. Abra `https://<endereço>/admin/` e entre.
2. Na lista das empresas, a coluna `RAMAIS AGORA` mostra as contas de cada empresa: quantos ramais estão online, sem registro, no chat e offline. O `sem registro` e o `no chat` só aparecem quando há alguém nesse estado. As contas somam o número de pessoas da empresa.
3. O cartão `SEM REGISTRO AGORA`, acima da lista, junta os ramais sem registro de todas as empresas: a empresa, o nome, o ramal, há quanto tempo e o que o app diz (`Conectando…`, `Erro no cadastro` ou `Sem conexão com a central`). O que está assim há mais tempo vem primeiro. O cartão mostra até 50 ramais e diz quantos ficaram de fora. Sem nenhum, ele diz `Nenhum ramal sem registro agora.` Quando há algum, o alto da página ganha também um número com quantos são.
4. Clique em `Abrir` para ver a empresa. Na página dela, a coluna `ESTADO` mostra o estado de cada pessoa, e cada computador da pessoa tem um desenho com o estado daquele computador.

**Os quatro estados.** Cada um tem um desenho e um nome: a cor nunca diz o estado sozinha.

| Estado | O que quer dizer | A segunda linha |
|---|---|---|
| `Online` (bolinha verde) | O app está aberto e o ramal está registrado na central. | Há quanto tempo, como `há 2 h`. |
| `Sem registro` (triângulo vermelho) | O app está aberto, mas o ramal não registra há 1 minuto ou mais. É o caso para olhar. | Há quanto tempo e o que o app diz, como `há 12 min · o app diz “Conectando…”`. |
| `No chat` (bolinha ciano) | O app acabou de abrir e está registrando o ramal, ou é um app antigo, que ainda não diz como está o ramal. | `registrando o ramal…` ou `o app é antigo e não diz o ramal`. |
| `Offline` (anel cinza) | O chat perdeu o computador. O app foi fechado, o PC desligou ou a internet caiu. | A última vez da pessoa no chat, como `última vez ontem, 18:02`. |

**O que entra na conta.**

- Cada pessoa é um ramal. O estado dela vem dos computadores em que ela está agora: com dois computadores, um aberto e registrado e outro fechado, ela aparece `Online`.
- Um computador que duas pessoas usam conta só para quem está nele agora. Na linha da outra pessoa, ele aparece com o anel cinza.
- Uma pessoa sem computador nenhum no chat (todos foram tirados) aparece `Offline`, com `sem computador no chat`.
- O celular e os aparelhos de mesa não aparecem: a página só vê os PCs com o app do Windows ligado ao chat.
- A página mostra o que o app diz. O chat não fala com a central: se o app travar, ele pode continuar dizendo que o ramal está registrado.
- Um ramal que registra e cai de novo o tempo todo não chega a ficar 1 minuto sem registrar, e por isso não aparece em vermelho: ele fica trocando entre `Online` e `No chat`.
- O tempo do `Online` e do `Sem registro` é contado pelo app, e recomeça quando o app é aberto de novo. Um ramal registrado há dias aparece `há menos de 1 min` logo depois de a pessoa fechar e abrir o app.
- Enquanto o PC dorme (a tampa fechada, a suspensão), a pessoa aparece `Offline`. Quando ele acorda, o tempo do `Online` pode incluir as horas em que ele dormiu: se o Windows não avisou o app de que a rede caiu, o app continuou contando.

**A página se atualiza sozinha.**

- Ela busca os dados de novo a cada 30 segundos, sem recarregar e sem mexer na rolagem.
- Um PC que perde a rede pode levar até 2 minutos para aparecer `Offline`: o chat espera a resposta do computador antes de desistir dele.
- Logo depois de o chat reiniciar (numa atualização, por exemplo), todos podem aparecer `Offline` por até cerca de um minuto, e às vezes um pouco mais. Cada app tenta se ligar de novo em esperas que crescem, de 1 segundo até uns 30, e a página busca os dados a cada 30 segundos. É o esperado: não quer dizer que a atualização derrubou os clientes.
- Depois de uma atualização do chat, uma página que ficou aberta se recarrega sozinha em até cerca de um minuto, e vem inteira na versão nova. Isso vale para uma página aberta na `0.2.0-rc.5` ou numa versão mais nova: na atualização para a `0.2.0-rc.5`, recarregue a página você mesmo (a tecla F5).
- A sessão da administração dura 12 horas. Quando ela vence, a página volta sozinha para a entrada: entre de novo. Com várias abas abertas, todas voltam para a entrada, e você pode entrar por qualquer uma delas. Nas outras, é só recarregar a página.
- Se a página não consegue buscar os dados (a sua internet caiu, ou o chat está fora do ar), ela avisa numa faixa presa embaixo da janela, por exemplo: `Sem atualizar desde as 14:32. A página tenta de novo sozinha.` A faixa continua à vista quando você rola a página, e some na primeira busca que der certo.
- A página espera, sem trocar nada, em dois casos: enquanto você anda por ela com o teclado (com o foco num botão ou num link), para não tirar você do lugar; e enquanto o ponteiro do mouse está em cima de um `Tirar do chat` ou do `×` de um computador, para as linhas não mudarem de lugar bem na hora do clique. Se a espera passar de uma atualização, o aviso é: `Sem atualizar desde as 14:32: a página espera você sair do campo ou do botão em que está.` Tire o ponteiro de cima do botão, ou clique fora, e ela volta a se atualizar em até 30 segundos.
