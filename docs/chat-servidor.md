# Starsonic Chat: o guia do servidor

Este guia é para quem instala e cuida do servidor do chat. Você não precisa saber programar.

Como usar:

- Cada comando fica numa linha só. Copie a linha inteira e cole no terminal da VM.
- Onde aparece algo entre `<` e `>`, troque pelo seu valor, sem os sinais. Exemplo: `<endereço>` vira `chat.exemplo.com.br`.
- Depois de cada comando, o guia diz o que você deve ver. Se aparecer outra coisa, vá para o passo 10.

## 1. O que a VM precisa

| O quê | Quanto |
|---|---|
| Processador | 2 vCPU |
| Memória | 2 GB |
| Disco | 120 GB SSD (20 GB para o sistema e o banco, 100 GB para os arquivos) |
| Sistema | Ubuntu 24.04 (ou Debian 12), com systemd |
| Rede | um endereço público fixo, da VM ou do roteador na frente dela (veja "Se a VM fica atrás de um roteador", no fim deste passo) |

Antes de instalar, deixe três coisas prontas:

1. **O nome do chat no DNS.** Escolha um nome, por exemplo `chat.exemplo.com.br`. No DNS da Starsonic, crie um registro do tipo A com esse nome, apontando para o endereço público da VM. O certificado (o cadeado) é pedido ao Let's Encrypt só depois que o nome aponta para a VM. Esse nome é o `<endereço>` deste guia. Aponte o nome direto para a VM: não ponha o chat atrás de um proxy nem de uma CDN. O chat limita as tentativas pelo endereço de quem acessa, e atrás de um proxy todos teriam o mesmo endereço e dividiriam o mesmo limite.
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
- Os computadores da mesma rede da VM só abrem o chat pelo nome se o roteador fizer "NAT loopback". Se ele não fizer, crie no DNS interno o mesmo nome apontando para o endereço interno da VM.

**Se a porta 443 pública já é de outro servidor** (por exemplo, o GLPI), o chat pode usar outra porta pública:

- No roteador, a porta **80** pública vai para a **80** da VM, e uma porta livre, por exemplo a **8443**, vai para a **443** da VM.
- No passo 2, instale com `--porta 8443`. O endereço do chat passa a ser `https://<endereço>:8443`, e é esse endereço, com a porta, que vai no navegador e no app.
- A regra da porta 80 tem de ficar **sempre ligada**. É por ela que o Let's Encrypt confere o nome, no primeiro cadeado e em toda renovação, a cada dois meses. Sem ela, o cadeado vence e o chat para de abrir.
- Algumas empresas bloqueiam, no firewall delas, a saída para portas fora do comum, e nelas o chat não conecta. Um segundo endereço público, só para o chat, evita isso: com ele, o chat fica na 443 normal.
- O primeiro cadeado precisa de um cuidado: veja "O cadeado não sai e o registro fala em `rateLimited`", no passo 10.

## 2. Instalar

Veja o número da última versão do chat na página de Releases do projeto no GitHub. As versões do chat se chamam `chat-v` e o número. O GitHub mostra essas versões com a etiqueta `Pre-release`: isso é normal, e é a versão certa. Se a versão for `chat-v0.1.0`, o `<versão>` é `0.1.0`. Se ainda não existir nenhuma versão `chat-v` na página, publique a primeira pelo passo 11 (Publicar uma versão, no fim deste guia).

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

## 4. Conferir a instalação

Faça estas conferências uma vez, logo depois de instalar.

Se você instalou com `--porta`, ponha `:` e a porta depois do nome em todos os endereços com `https` deste passo, por exemplo `https://<endereço>:8443/admin/`. Sem a porta, o navegador vai para a 443, que é de outro servidor.

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

   Confira com `systemctl status starsonic-chat` (deve estar `active (running)`) e entre na página de administração.

7. Só agora ligue de novo a cópia da noite:

```
sudo systemctl start starsonic-chat-copia.timer
```

8. Quando estiver tudo certo, apague o banco antigo para liberar espaço:

```
sudo rm -f /var/lib/starsonic-chat/chat.db.antigo
```

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

Você deve ver `SHA-256 conferido.` e, no fim, `Pronto: o Starsonic Chat agora está na versão <versão>.` O serviço reinicia sozinho, e quem está no chat volta a conectar em poucos segundos. As mensagens e os arquivos não mudam.

### Trocar a porta pública

Para mudar a porta do HTTPS de uma instalação que já existe, use o instalador da versão 0.1.1 ou mais nova, o mesmo baixado acima. Isso serve, por exemplo, quando a VM passou a ficar atrás de um roteador e a 443 pública é de outro servidor (passo 1):

```
sudo bash instalar.sh porta 8443
```

Você deve ver `Pronto: o chat agora está em https://<endereço>:8443/`, e uma linha lembrando as duas regras do roteador. Para voltar à porta normal, quando o chat ganhar um endereço público só dele, rode o mesmo comando com `443` no lugar de `8443`.

Se o chat da VM ainda for de antes da versão 0.1.1, o comando avisa e não muda nada. Nesse caso, atualize primeiro, como acima, e rode o comando de novo.

## 8. Tirar uma pessoa antes de o ramal passar para outra

Quando alguém sai da empresa, tire a pessoa do chat **antes** de o ramal dela passar para outra pessoa. Se não, a pessoa nova com o mesmo ramal veria as conversas da anterior.

1. Abra `https://<endereço>/admin/` e entre.
2. Clique na empresa.
3. Em `PESSOAS NO CHAT`, ache a pessoa e clique em `Tirar do chat`.

Depois disso, o mesmo ramal entra como uma pessoa nova, sem as conversas antigas. Para tirar só um computador, clique no `×` dele.

## 9. Ver os registros

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

## 10. Os problemas comuns

**O certificado não sai (o navegador avisa que o site não é seguro, ou nada abre).**
O Let's Encrypt precisa achar a VM pelo nome. Rode `getent hosts <endereço>` e veja se o endereço que aparece é o da VM (ou o do roteador, se ela fica atrás de um). Se não for, corrija o registro A no DNS e espere alguns minutos. Depois veja os registros do passo 9: um erro de certificado aparece ali. O servidor tenta de novo sozinho, mas não insista muitas vezes seguidas: o Let's Encrypt limita os pedidos que falham.

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
Quem escolhe a máquina de cada porta é o roteador, e a 443 pública está indo para outra máquina. Use a porta própria do chat (passo 1, "Se a porta 443 pública já é de outro servidor") e abra o chat com ela no endereço, por exemplo `https://<endereço>:8443/admin/`. Escreva sempre o `https://` na frente: com uma porta diferente, o navegador não põe o `https` sozinho.

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

## 11. Publicar uma versão

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
