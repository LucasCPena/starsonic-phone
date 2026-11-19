# O servidor de vídeo das reuniões: o guia

Este guia é para quem instala e cuida do servidor de vídeo das reuniões com link. Você não precisa saber programar.

O servidor de vídeo é uma VM só para as reuniões. Nela ficam três programas:

- o **FreeSWITCH**, que monta a imagem e o som de cada reunião;
- o **coturn**, que ajuda a entrar quem está numa rede fechada;
- o **agente** (`starsonic-video`), que liga os dois ao chat.

Quem cuida das reuniões é o chat: ele guarda o endereço do servidor de vídeo e a chave dele, e diz quem pode entrar em qual reunião. O servidor de vídeo não guarda nada: nem gravação, nem nomes.

Como usar:

- Cada comando fica numa linha só. Copie a linha inteira e cole no terminal da VM de vídeo.
- Onde aparece algo entre `<` e `>`, troque pelo seu valor, sem os sinais:
  - `<endereço>` é o nome do servidor de vídeo no DNS, por exemplo `video.exemplo.com.br`;
  - `<endereço do chat>` é o nome do chat, por exemplo `chat.exemplo.com.br`. Se o chat usa uma porta própria (o `--porta` do guia do chat), ponha `:` e a porta depois do nome, como em `chat.exemplo.com.br:8443`;
  - `<versão>` é o número de uma versão, por exemplo `0.1.0`.
- Depois de cada comando, o guia diz o que você deve ver. Se aparecer outra coisa, vá para o passo 9.

**Onde você está agora.** Você já tem a VM com o Ubuntu 26.04. O passo 1 dá para fazer hoje, menos a parte "Se o chat e o vídeo dividem um IP público só": ela precisa do chat já na versão 0.2.0 e de uma versão do servidor de vídeo publicada. O passo 2 instala a partir de uma versão publicada do servidor de vídeo (as versões se chamam `video-v` e o número). A primeira versão fica pronta no fim desta etapa das reuniões, e quem a publica é você, pelo passo 10. O passo 3 precisa do chat já instalado (pelo guia do chat, `docs/chat-servidor.md`), na versão que traz as reuniões.

## 1. O que a VM precisa

| O quê | Quanto |
|---|---|
| Processador | 6 vCPU |
| Memória | 8 GB |
| Disco | 40 GB SSD |
| Internet | 100 Mbit/s |
| Sistema | Ubuntu 24.04 ou 26.04 (ou Debian 12), com systemd |
| Rede | um IP público fixo, da VM ou do roteador na frente dela (veja "Se a VM fica atrás de um roteador", no fim deste passo) |

O IP público precisa ser fixo (na nuvem, um IP reservado ou estático). A instalação guarda esse IP na configuração, e o FreeSWITCH o passa a quem entra numa reunião.

Antes de instalar, deixe quatro coisas prontas.

**1. O nome do servidor de vídeo no DNS.** Use um nome como `video.` seguido do domínio da Starsonic, por exemplo `video.exemplo.com.br`. No DNS da Starsonic, crie um registro do tipo A com esse nome, apontando para o IP público da VM. Esse nome é o `<endereço>` deste guia.

Aponte o nome direto para a VM: não ponha o servidor de vídeo atrás de um proxy nem de uma CDN. A imagem e o som vão direto para a VM, e um proxy não os leva. Se o DNS do domínio fica na Cloudflare, deixe esse registro como **Somente DNS** (a nuvem cinza): com a nuvem laranja, a Cloudflare fica no meio, como um proxy.

Para conferir o nome no DNS, rode na VM:

```
getent hosts <endereço>
```

Você deve ver uma linha com o IP público da VM (ou o do roteador, se ela fica atrás de um). Se não aparecer nada, o DNS ainda não está pronto: espere alguns minutos e tente de novo.

**2. As portas abertas,** de entrada e para qualquer endereço, na rede da nuvem e em qualquer firewall:

| Porta | Para quê |
|---|---|
| TCP 80 | o certificado (o cadeado) do Let's Encrypt, na instalação e em cada renovação |
| TCP 443 | o navegador e o chat (se o chat e o vídeo dividem um IP público só, é a TCP 7443: veja "Se o chat e o vídeo dividem um IP público só", no fim deste passo) |
| TCP 5061 | o app (as reuniões no Starsonic Phone) |
| UDP 3478 | o TURN, para quem está numa rede fechada |
| TCP 5349 | o TURN sobre TLS, para quem está numa rede que bloqueia o UDP |
| UDP 16384 a 16683 | a imagem e o som das reuniões |
| UDP 49152 a 49451 | o caminho do TURN |

As outras portas dos programas ficam só dentro da VM: não abra nenhuma além dessas. Na VM, as portas TCP 80, 443 (ou a 7443, se o chat e o vídeo dividem um IP público só), 5061 e 5349 e a UDP 3478 têm de estar livres (a instalação confere).

**3. A internet da VM.** A que pesa é a de **subida**, a que sai da VM: o servidor manda a imagem de todos, num mosaico só, para cada pessoa (3 Mbit/s para cada uma, e 4 Mbit/s enquanto alguém compartilha a tela). Uma reunião com 10 pessoas usa, no máximo (com uma tela compartilhada), uns 40 Mbit/s saindo da VM (uns 30 sem tela compartilhada). A que chega à VM é menor: cada pessoa manda a câmera com até 1,5 Mbit/s, e quem compartilha a tela manda mais até 2,5 Mbit/s, ou seja, uns 18 Mbit/s com as 10 pessoas e a tela. Com 2 reuniões ao mesmo tempo, o padrão, conte uns 80 Mbit/s saindo da VM e uns 36 Mbit/s chegando. Uma VM no escritório precisa de uma internet boa também na subida, que costuma ser a menor das duas; se não tiver, use uma VM na nuvem.

**4. O relógio certo, nas duas VMs** (a do chat e a de vídeo). Rode em cada uma:

```
timedatectl
```

Você deve ver `System clock synchronized: yes` e `NTP service: active`. Se aparecer `no` ou `inactive`, ligue o horário automático:

```
sudo timedatectl set-ntp true
```

O comando não escreve nada quando dá certo. Rode o `timedatectl` de novo depois de alguns minutos. Se o comando de ligar disser `NTP not supported`, falta o programa do horário automático. Instale com o comando abaixo e rode o de ligar de novo:

```
sudo apt-get install -y systemd-timesyncd
```

Aparecem as linhas do apt, e o comando termina sem nenhuma linha que comece com `E:`.

As reuniões funcionam mesmo com os relógios um pouco diferentes, mas o cartão "Reuniões" do chat avisa da diferença (passo 3).

### Se a VM fica atrás de um roteador (NAT)

Quando a VM fica na rede interna da empresa, sem um IP público só dela, quem recebe as conexões da internet é o roteador. Nesse caso:

- O registro A do DNS aponta para o **IP público do roteador**, o da internet da empresa. Para ver qual é, rode na VM:

```
curl -s https://ifconfig.me
```

  Aparece só um número, como `203.0.113.10`, com o prompt do terminal logo depois dele, na mesma linha. Esse número é o IP público do roteador.

- No roteador, redirecione para o IP interno da VM **todas as portas da tabela acima, com os mesmos números**: a porta 443 pública vai para a 443 da VM (se a 443 pública é do chat, veja "Se o chat e o vídeo dividem um IP público só", logo abaixo), a 5061 para a 5061, as duas faixas UDP para as mesmas faixas, e assim por diante. Use o redirecionamento de porta comum (NAT, ou port forwarding), que mantém o endereço de quem acessa. Não use um proxy.
- Se a 443 pública do roteador já é de outro servidor, como o chat, o servidor de vídeo usa uma porta própria para o HTTPS, a 7443, e não precisa de outro IP público: veja "Se o chat e o vídeo dividem um IP público só", logo abaixo.
- A internet da empresa precisa ter um IP público fixo. Se a operadora usa CGNAT (um IP dividido com outros clientes), não dá para redirecionar porta: peça à operadora um IP público fixo.
- Quem está na mesma rede da VM só entra numa reunião se o roteador fizer o "NAT loopback", como no guia do chat. Para o vídeo, o DNS interno não basta: a imagem e o som vão sempre para o IP público.
- A instalação lê o IP público pelo nome do servidor de vídeo, no DNS que a VM usa. Se o DNS interno da empresa responde pelo domínio (como no guia do chat), crie nele também o nome do servidor de vídeo, apontando para o **IP público**, e não para o IP interno da VM. Sem o nome, ou com um IP da rede interna, a instalação para.

### Se o chat e o vídeo dividem um IP público só

Este é o caso de uma empresa que tem um IP público só, e nele as portas 80 e 443 já são do chat. O servidor de vídeo então usa a porta **7443** para o HTTPS, no lugar da 443. O certificado (o cadeado) do vídeo continua vindo do Let's Encrypt: o Let's Encrypt bate na porta 80 do **chat**, e o chat leva só essa conferência, pela rede interna, até a VM de vídeo. Siga os passos a) a f) abaixo nesta ordem. Neste trecho, o `<nome do vídeo>` é o mesmo `<endereço>` do resto do guia: o nome do servidor de vídeo no DNS.

**Antes de tudo: o chat tem de estar na versão 0.2.0 ou mais nova.** É essa versão que sabe levar a conferência do certificado. Na VM do chat, rode:

```
starsonic-chat versao
```

Aparece só a versão. Se for mais velha que 0.2.0, atualize o chat antes, pelo passo 7 do guia do chat (`docs/chat-servidor.md`).

**a) O roteador.** Crie ou confira estas regras de redirecionamento de porta:

- a TCP **7443** pública vai para a TCP **7443** da VM de vídeo, o mesmo número;
- as outras portas do vídeo, da tabela acima, vão para a VM de vídeo, com os mesmos números: TCP 5061, UDP 3478, TCP 5349, UDP 16384 a 16683 e UDP 49152 a 49451;
- as portas 80 e 443 públicas **continuam indo para a VM do chat**. Não mude essas duas.

A porta 80 da VM de vídeo não precisa estar aberta para a internet: o Let's Encrypt chega pelo chat. Mas a VM do chat tem de alcançar a VM de vídeo, pela rede interna, nas portas TCP 80 e 7443. Se existe um firewall entre as duas VMs, libere essas duas portas.

**b) O DNS.** Crie o registro A com o nome do servidor de vídeo (o `<nome do vídeo>`), apontando para o **mesmo IP público** do chat.

**c) Na VM do chat, antes de instalar o vídeo.** Use o `instalar.sh` do chat, da versão 0.2.0 ou mais nova (o mesmo do passo 7 do guia do chat). Rode, com o nome do servidor de vídeo e o IP da VM de vídeo na rede interna:

```
sudo bash instalar.sh video <nome do vídeo> <IP interno da VM de vídeo>
```

O comando reinicia o chat, e quem está no chat volta a conectar em poucos segundos. Você deve ver uma linha que começa com `Pronto: o chat agora repassa ao servidor de vídeo` e termina com `O instalador do servidor de vídeo já pode pedir o certificado.` Se o comando disser `ERRO:`, leia a linha: ela diz o que não serve (o nome, o IP ou a versão do chat). Nesse caso, nada muda.

**Confira o repasse.** Ainda na VM do chat, rode, com o nome do servidor de vídeo:

```
curl -sS -H 'Host: <nome do vídeo>' http://127.0.0.1/.well-known/acme-challenge/teste
```

Este teste vale a qualquer hora, e não depende do `/etc/hosts` nem do NAT loopback, porque vai direto ao chat. Antes de instalar o vídeo, você deve ver esta linha:

```
Não consegui falar com o servidor de vídeo.
```

Isso é o normal agora: o chat já repassa, e ninguém escuta ainda na porta 80 da VM de vídeo, porque o certbot só escuta nela enquanto pede o certificado. Se a linha demorar uns 10 segundos para aparecer, um firewall entre as duas VMs está segurando a porta 80: libere a TCP 80 da VM do chat para a VM de vídeo. Se, no lugar dela, aparecer uma linha em inglês como esta, o repasse não está ligado:

```
acme/autocert: host "<nome do vídeo>" not configured in HostWhitelist
```

Nesse caso, rode de novo o comando `video` acima e confira a versão do chat.

**d) Ainda na VM do chat: o `/etc/hosts`, se o roteador não faz NAT loopback.** O chat fala com o servidor de vídeo pelo nome dele e pela porta 7443. Se o roteador não faz o "NAT loopback" (veja o guia do chat, passo 1), o chat não chega ao IP público de dentro da rede. Então faça o nome do vídeo apontar, só nesta VM, para o IP interno da VM de vídeo:

```
echo "<IP interno da VM de vídeo> <nome do vídeo>" | sudo tee -a /etc/hosts
```

Confira:

```
getent hosts <nome do vídeo>
```

Deve aparecer o IP interno da VM de vídeo. Se o roteador faz o NAT loopback, pule este passo. Não faça isto na VM de vídeo: lá, o nome tem de continuar apontando para o IP público (a instalação confere).

Depois de reiniciar a VM do chat, rode o `getent hosts <nome do vídeo>` de novo. Em algumas VMs de nuvem, o arquivo `/etc/hosts` começa com um aviso do cloud-init falando em `manage_etc_hosts`: nelas, a linha some a cada reinício, a não ser que ela também seja posta no modelo do cloud-init. Se o `getent` não mostrar mais o IP interno, ponha a linha de novo (ou peça a quem cuida da VM para pô-la no modelo), senão o chat deixa de alcançar o vídeo.

**e) Na VM de vídeo, instale com a porta 7443.** Siga o passo 2, mas rode o instalador com o `--porta`:

```
sudo bash instalar.sh instalar <endereço> --chat <endereço do chat> --porta 7443
```

No fim, a linha do `Pronto` diz `https://<endereço>:7443/`, e uma linha logo abaixo diz o endereço para o cartão "Reuniões" do chat, com a porta. A chave aparece depois, como no passo 2.

**f) Na página `Reuniões` da administração do chat** (passo 3), no campo `Endereço do servidor de vídeo`, escreva o endereço **com a porta**, como neste modelo:

```
<endereço>:7443
```

**O limite.** Quem está numa rede que só deixa sair pela porta 443 (algumas empresas e hotéis) pode não conseguir abrir o vídeo no navegador, porque agora ele usa a porta 7443. Se algum cliente reclamar disso, avise quem cuida do servidor de vídeo.

## 2. Instalar

Você vai precisar de duas coisas:

- uma versão do servidor de vídeo publicada. Veja o número da última na página de Releases do projeto no GitHub:

```
https://github.com/LucasCPena/starsonic-phone/releases
```

  As versões do servidor de vídeo se chamam `video-v` e o número, e o GitHub as mostra com a etiqueta `Pre-release`: isso é normal, e é a versão certa. Se a versão for `video-v0.1.0`, o `<versão>` é `0.1.0`. Se ainda não existir nenhuma versão `video-v` na página, publique a primeira pelo passo 10;
- o endereço do chat. O chat não precisa estar instalado ainda: basta o nome dele. A instalação o guarda para deixar entrar nas reuniões só a página desse chat. (Se o chat e o vídeo dividem um IP público só, o chat tem de estar instalado e na versão 0.2.0 antes: siga primeiro "Se o chat e o vídeo dividem um IP público só", no passo 1.)

Baixe o instalador na VM de vídeo:

```
curl -fsSLO https://github.com/LucasCPena/starsonic-phone/releases/download/video-v<versão>/instalar.sh
```

Não aparece nada. Se der erro, confira o número da versão.

Rode o instalador:

```
sudo bash instalar.sh instalar <endereço> --chat <endereço do chat>
```

Se o chat e o vídeo dividem um IP público só, acrescente `--porta 7443` no fim do comando acima, como está no passo 1.

Na primeira vez que usar `sudo`, a VM pode pedir a sua própria senha de entrada na VM. Digite a senha (ela não aparece) e aperte Enter.

A instalação leva alguns minutos. Você deve ver estas linhas, uma depois da outra:

```
SHA-256 conferido.
Instalando o FreeSWITCH, o coturn e o certbot (leva alguns minutos)...
Pedindo o certificado ao Let's Encrypt (pela porta 80)...
Ligando os serviços...

Pronto: o servidor de vídeo <versão> está no ar em https://<endereço>/.

A chave do servidor de vídeo (cole no cartão "Reuniões" da administração do chat):
```

Com a `--porta 7443`, a linha do `Pronto` diz `https://<endereço>:7443/`, e vem mais uma linha com o endereço do cartão "Reuniões" do chat, com a porta.

E, na última linha, a **chave**: uma linha só, com 43 letras, números e sinais. Ela é o que deixa o chat falar com o servidor de vídeo. Copie a linha inteira (com três cliques nela, ou arrastando o mouse do começo ao fim), sem espaço antes nem depois. Você vai colá-la no passo 3. Para ver a chave de novo a qualquer hora, rode na VM de vídeo:

```
sudo starsonic-video mostrar-chave
```

Aparece só a chave, numa linha. Não mande a chave por e-mail nem a deixe num lugar aberto: com ela, alguém poderia mandar no servidor de vídeo.

O instalador confere, antes de mexer em qualquer coisa, se o sistema serve, se as portas estão livres (a 7443, se você usou o `--porta`), se o nome já tem um IP público no DNS e se os arquivos baixados não foram alterados. Se algo estiver errado, ele para com uma linha que começa com `ERRO:` e diz o quê (veja o passo 9). Se ele parar no meio, por exemplo no certificado, corrija o que a linha diz e rode **o mesmo comando** de novo: ele refaz o que já tinha feito e segue. A exceção é o último passo, o de ligar os serviços: veja "O instalador diz que o servidor de vídeo não ficou de pé", no passo 9.

Confira que os três serviços estão ligados:

```
systemctl status starsonic-video starsonic-freeswitch coturn
```

Você deve ver `active (running)` em verde três vezes, uma para cada serviço. Use as setas para descer e aperte `q` para sair. Nas linhas do `starsonic-freeswitch` aparecem algumas com `[ERR]` e `[WARNING]` que são normais (veja o passo 8).

## 3. Ligar ao chat

O servidor de vídeo é ligado ao chat pelo cartão "Reuniões" da administração do chat. Esse cartão chega com a versão do chat que traz as reuniões (a 0.2.0). Se a administração do chat ainda não tem o cartão `REUNIÕES` na lista das empresas, atualize o chat primeiro, pelo passo 7 do guia do chat (`docs/chat-servidor.md`).

1. No navegador, abra a administração do chat e entre com o seu usuário:

```
https://<endereço do chat>/admin/
```

2. Na lista das empresas, no cartão `REUNIÕES`, clique em `Configurar as reuniões`. Abre a página `Reuniões`.
3. No cartão `SERVIDOR DE VÍDEO`:
   - em `Endereço do servidor de vídeo`, escreva o mesmo endereço da instalação, sem `https://`, como neste exemplo:

```
video.exemplo.com.br
```

     Se você instalou com o `--porta 7443`, escreva o endereço com a porta, como neste exemplo:

```
video.exemplo.com.br:7443
```

   - em `Chave do servidor de vídeo`, cole a chave do fim da instalação (passo 2);
   - clique em `Guardar e testar`.

   Você deve ver estas duas linhas, com a versão e os números do seu servidor:

```
O servidor de vídeo respondeu: versão <versão>, FreeSWITCH no ar.
Uso agora: CPU <n>% · memória <n>%.
```

   Mais abaixo, no cartão `AGORA`, a linha do servidor deve dizer `Servidor de vídeo: <endereço> · respondendo`. Para testar de novo, sem mudar nada, clique em `Testar o servidor de vídeo`.

   Se os relógios das duas VMs estiverem 5 segundos ou mais diferentes, aparece também um aviso, com `adiantado` ou `atrasado`:

```
O relógio do servidor de vídeo está <n> s adiantado em relação ao do chat. As reuniões funcionam assim mesmo, mas ligue o horário automático nas duas VMs.
```

   As reuniões funcionam, mas ligue o horário automático nas duas VMs (passo 1, item 4).

   Se aparecer outra coisa:
   - `A chave tem 43 caracteres. Copie de novo a chave mostrada na instalação.`: faltou um pedaço da chave. Copie a linha inteira de novo (o `mostrar-chave` do passo 2 mostra a chave outra vez);
   - `A chave não confere. Copie de novo a chave mostrada na instalação.`: a chave colada não é a deste servidor de vídeo. Copie de novo pelo `mostrar-chave`;
   - `O servidor de vídeo não respondeu. Confira o endereço e se a porta dele está aberta (a 443, ou a que vem depois do endereço).`: veja se o endereço está certo e se a porta dele (a 443, ou a 7443, se você instalou com o `--porta`) está aberta (passo 1). Se o endereço está com a porta, veja também se a VM do chat alcança a VM de vídeo nela (passo 1, "Se o chat e o vídeo dividem um IP público só"). Veja também "As portas estão fechadas", no passo 9;
   - `O servidor de vídeo respondeu, mas o FreeSWITCH está fora do ar. Veja os registros na VM de vídeo.`: o agente está no ar, mas o FreeSWITCH não. Veja os registros dele (passo 8);
   - `Escreva só o endereço do servidor de vídeo (e a porta, se tiver), sem https://.`: tire o `https://` e qualquer `/` do fim.

   Depois que a chave fica guardada, o campo mostra `Chave guardada. Deixe em branco para manter.` Para trocar só o endereço, deixe o campo da chave em branco.

4. Libere as reuniões para cada empresa que vai usá-las. Na tabela `EMPRESAS`, clique em `Liberar` na linha da empresa. A coluna `REUNIÕES` passa a dizer `Liberadas`. Para tirar, clique em `Bloquear`.
5. No cartão `AO MESMO TEMPO`, o campo `Reuniões ao mesmo tempo` diz quantas reuniões podem acontecer juntas, de 1 a 20. O padrão é 2, para a VM de 6 vCPU. Para mudar, escreva o número e clique em `Guardar`.

A chave fica guardada no banco do chat, junto com o resto da configuração. Por isso, a cópia de segurança do chat (o passo 5 do guia do chat) também a leva: um chat que volta de uma cópia continua ligado ao mesmo servidor de vídeo, sem colar a chave de novo.

O cartão `REUNIÃO DE TESTE` (com o botão `Criar a reunião de teste`) cria uma reunião só para conferir a instalação, e o link dela abre a página da reunião no navegador. O passo 4 diz como fazer essa conferência.

## 4. Conferir a instalação

Faça estas conferências uma vez, logo depois de instalar e de ligar ao chat. Rode os comandos na VM de vídeo. Se a VM fica atrás de um roteador que não faz NAT loopback (passo 1), eles só funcionam de outro Linux, fora da rede da VM.

**O agente.** Rode:

```
curl -s https://<endereço>/agente/v1/saude
```

Se você instalou com o `--porta 7443`, o endereço leva a porta:

```
curl -s https://<endereço>:7443/agente/v1/saude
```

Você deve ver:

```
{"ok":true}
```

Isso mostra que o agente está no ar, na porta 443 (ou na 7443), com o cadeado. Se não aparecer nada, rode o mesmo pedido sem o `-s`, que mostra o erro:

```
curl https://<endereço>/agente/v1/saude
```

Um erro com `certificate` é do certificado (veja "O certificado não sai", no passo 9). Um `Connection refused` ou um `timed out` é a porta 443 (ou a 7443) fechada ou o agente parado (veja "As portas estão fechadas", no passo 9). Com o `--porta 7443`, ponha o `:7443` depois do endereço também neste comando.

**O certificado da porta 5061** (a do app). Copie o comando inteiro, também o `</dev/null` do fim: ele faz parte do comando, e não é para trocar.

```
openssl s_client -connect <endereço>:5061 -brief </dev/null
```

Entre as linhas, deve aparecer `Verification: OK`. Essa porta é a do app (as reuniões no Starsonic Phone), que chega numa próxima versão do app, mas ela já fica pronta agora.

**O teste do cartão.** Na página `Reuniões` da administração do chat, clique em `Testar o servidor de vídeo`. Você deve ver de novo `O servidor de vídeo respondeu: versão <versão>, FreeSWITCH no ar.`, com o uso de agora.

**A reunião de teste, pelo navegador.** É a conferência que mostra que a imagem e o som chegam de verdade. Faça com dois aparelhos: um PC e um celular. Se puder, ponha o celular na internet do chip (4G ou 5G, com o Wi-Fi desligado), para a reunião passar pela rede de fora, como a de quem entra de casa.

1. Na página `Reuniões` da administração do chat, no cartão `REUNIÃO DE TESTE`, clique em `Criar a reunião de teste`. O cartão mostra o link (`https://<endereço do chat>/r/<código>`), com o botão `Copiar o link` e o `Vale até`, que é 2 horas depois. A reunião de teste não tem sala de espera.
2. Abra o link no PC. Aparece a tela de entrada, com `Reunião de teste` em cima e o título `Reunião`. O navegador pede a câmera e o microfone: permita. Você vê a sua imagem, os botões `Microfone` e `Câmera`, o campo `Seu nome` e o aviso `Nada é gravado.` Escreva um nome e clique em `Pedir para entrar`. Aparece `Entrando na reunião…` e, em poucos segundos, a reunião: a imagem no meio, a faixa `Nada é gravado` em cima e, embaixo, `Microfone`, `Câmera`, `Compartilhar a tela` e `Sair`.
3. Abra o mesmo link no celular, com outro nome, e entre do mesmo jeito. O celular não mostra o `Compartilhar a tela`. Com o celular em pé, não aparece mais o aviso `Gire o celular para ver a reunião maior.`: ele saiu na `0.2.0-rc.4` do chat.
4. Fale nos dois aparelhos, um de cada vez (use um fone, ou afaste os dois, para não dar eco). Cada um deve ouvir o outro sem tocar em mais nada, e cada um deve ver a outra pessoa ocupando a área da reunião, com o nome dela por cima, e se ver pequeno no canto de baixo, à direita. É o que o chat `0.2.0-rc.4` e o servidor de vídeo `0.1.0-rc.3` fazem juntos; com o servidor de vídeo ainda antigo, a página mostra a imagem de todos numa só.
5. No PC, clique em `Câmera` para desligar. Na hora, o quadro do PC no celular vira um quadro escuro, só com o nome. Clique de novo, e a imagem volta.
6. Clique em `Sair`. Aparece `Você saiu da reunião` e o botão `Entrar de novo`.

Se a imagem ou o som do outro aparelho não chegam, veja "A imagem ou o som do outro não chegam na reunião de teste", no passo 9.

## 5. Atualizar

O servidor de vídeo não se atualiza sozinho. Quando sair uma versão nova, baixe o instalador dela (o `<versão>` é o número novo):

```
curl -fsSLO https://github.com/LucasCPena/starsonic-phone/releases/download/video-v<versão>/instalar.sh
```

E rode:

```
sudo bash instalar.sh atualizar
```

Você deve ver:

```
SHA-256 conferido.
Trocando o FreeSWITCH, o agente e a configuração...
Pronto: o servidor de vídeo agora está na versão <versão>.
```

A atualização reinicia os três serviços. A chave, o endereço, a porta (a 7443, se você usa o `--porta`) e a ligação com o chat não mudam, e o chat volta a falar com o servidor de vídeo sozinho em poucos segundos.

Reiniciar o FreeSWITCH encerra as reuniões que estão acontecendo. Por isso, antes de trocar qualquer coisa, o instalador pergunta ao agente quantas há. Se houver alguma, ele para e não muda nada:

```
ERRO: Há 1 reunião(ões) acontecendo agora. Atualize quando elas acabarem, ou rode de novo com --agora, que as encerra.
```

O cartão `AGORA`, na página `Reuniões` do chat, mostra quantas reuniões estão acontecendo. Espere elas acabarem e rode o `atualizar` de novo. Se a atualização não pode esperar (por exemplo, uma correção urgente), rode com `--agora`. Quem está numa reunião sai dela na hora:

```
sudo bash instalar.sh atualizar --agora
```

Se o agente estiver parado, o instalador não tem a quem perguntar. Ele avisa com a linha abaixo e segue com a atualização, que é também o jeito de consertar um agente parado:

```
O agente não respondeu; não dá para saber se há reuniões agora. Seguindo com a atualização.
```

**A ordem: o chat antes do servidor de vídeo.** A `0.1.0-rc.3` do servidor de vídeo (junto com a `0.2.0-rc.4` do chat) muda o palco da reunião: a página passa a mostrar um quadro para cada pessoa, em vez da imagem de todos numa só. Por isso, atualize nesta ordem:

1. **Primeiro o chat** (`docs/chat-servidor.md`, passo 7). A página nova funciona com o servidor de vídeo antigo: ela mostra o mosaico inteiro, como antes.
2. **Depois o servidor de vídeo**, com o `atualizar` acima. A página passa aos quadros sozinha.

Na ordem contrária, a página antiga do chat mostraria o mosaico novo cru, sem os nomes das pessoas, até o chat ser atualizado.

A `0.1.0-rc.3` é a primeira atualização do servidor de vídeo. Em toda atualização, o `atualizar` gera de novo a configuração do FreeSWITCH (nesta, o tamanho do mosaico, os lugares de cada pessoa e o codificador do vídeo) e reinicia os serviços: faça-o sempre num horário sem reuniões, como diz o cartão `AGORA`. Depois, confira com a reunião de teste (passo 4) e com a seção 26 do roteiro (`docs/teste-manual.md`).

**A `0.1.0-rc.4` corrige o FreeSWITCH.** Na `0.1.0-rc.3`, a imagem de uma reunião podia congelar para todos, ou todos podiam cair, quando o mosaico mudava de tamanho (veja "A imagem congelou para todos, ou todos caíram da reunião ao mesmo tempo", no passo 9). A `0.1.0-rc.4` troca o FreeSWITCH por um corrigido. O chat não muda, e não há ordem entre os dois: atualize só o servidor de vídeo. Depois de atualizar, confira que o FreeSWITCH instalado é o corrigido:

```
cat /opt/starsonic-freeswitch/VERSOES.txt
```

Duas linhas têm de começar por `patch freeswitch`: a do `0001-mod_conference-tamanho-na-thread-do-mosaico.patch` e a do `0002-mod_conference-banda-com-a-trava-do-mosaico.patch`. Sem elas, o FreeSWITCH instalado é o antigo: rode o `atualizar` da `0.1.0-rc.4` de novo. Depois, confira com a seção 27 do roteiro (`docs/teste-manual.md`).

**As atualizações do sistema da VM.** Se, numa atualização do sistema (o `sudo apt upgrade`), o apt perguntar o que fazer com o arquivo `/etc/turnserver.conf`, responda `N`, que mantém o arquivo atual (é o padrão: basta apertar Enter). Um `Y` põe de volta a configuração de exemplo do coturn, que não serve para as reuniões, até o próximo `atualizar` (veja "O apt perguntou sobre o /etc/turnserver.conf", no passo 9, para pôr a nossa de volta).

## 6. Trocar o endereço do chat

O servidor de vídeo só deixa entrar nas reuniões a página do chat que ele conhece. Se o endereço do chat mudar (um nome novo, ou o chat passou a usar uma porta própria, ou deixou de usar), avise o servidor de vídeo. Use o `instalar.sh` que já está na VM de vídeo, de qualquer versão. Se ele não estiver mais lá, baixe-o de novo, como no passo 5.

```
sudo bash instalar.sh chat <endereço do chat>
```

Você deve ver `Pronto: o servidor de vídeo agora aceita a página de https://<endereço do chat>.`, com o endereço novo. O comando reinicia o agente: faça a troca num horário sem reuniões. Se o agente não ficar de pé com o endereço novo, ou se o comando parar no meio (por exemplo, a conexão com a VM cai), a configuração de antes volta, e aparece a linha abaixo:

```
A configuração de antes voltou, e o agente foi reiniciado com ela.
```

## 7. O certificado

O certificado (o cadeado) do servidor de vídeo vem do Let's Encrypt, pelo programa certbot. Os três programas usam o mesmo certificado: o agente na porta 443 (ou na 7443, se você usa o `--porta`), o FreeSWITCH na 5061 e o coturn na 5349.

O certificado vale alguns meses (hoje, 90 dias), e o certbot o renova sozinho bem antes de vencer: ele confere duas vezes por dia. Depois de cada renovação, a instalação copia o certificado novo para os três programas e faz cada um passar a usá-lo, sem derrubar ninguém. A renovação chega sozinha aos três: você não precisa fazer nada.

A renovação usa a porta 80, como a primeira vez. Por isso, a porta 80 tem de ficar **sempre aberta** na rede da nuvem e no roteador, mesmo sem nenhum programa escutando nela: o certbot só a usa na hora de renovar. Sem ela, o certificado vence e as reuniões param.

Se o chat e o vídeo dividem um IP público só, a porta 80 pública é do chat, e é ele quem leva a conferência até a porta 80 da VM de vídeo, pela rede interna. Então, nesse caso, o que tem de ficar sempre ligado é o `video` do chat (passo 1) e o caminho da VM do chat até a porta 80 da VM de vídeo. O comando `video` fica guardado no chat: ele continua valendo depois de atualizar o chat.

Para ver o certificado e quantos dias ele ainda vale:

```
sudo certbot certificates
```

Deve aparecer o `<endereço>` e uma linha `Expiry Date:` com `VALID:` e o número de dias que faltam. Se faltarem menos de 10 dias, a renovação está falhando: rode o teste abaixo e leia o erro.

Para testar a renovação sem trocar nada (ela não mexe no certificado de verdade):

```
sudo certbot renew --dry-run
```

No fim, deve aparecer `Congratulations, all simulated renewals succeeded`. Se aparecer um erro, veja "O certificado não sai", no passo 9: as causas são as mesmas.

Para ver quando o certbot confere o certificado de novo:

```
systemctl list-timers certbot.timer
```

Deve aparecer uma linha com `certbot.timer` e, na coluna `NEXT`, a data e a hora da próxima conferência.

## 8. Ver os registros

Os registros do agente:

```
sudo journalctl -u starsonic-video -n 50 --no-pager
```

Mostra as últimas 50 linhas. Para acompanhar ao vivo, rode o comando abaixo e aperte Ctrl e C para sair:

```
sudo journalctl -u starsonic-video -f
```

Os registros do FreeSWITCH:

```
sudo journalctl -u starsonic-freeswitch -n 50 --no-pager
```

Os registros do coturn:

```
sudo journalctl -u coturn -n 50 --no-pager
```

Os registros nunca têm nomes, números de telefone, chaves ou senhas: só o que aconteceu, as contagens e os erros.

**O que é normal.** No agente, uma linha `servidor no ar` quando ele liga, `esl: ligado ao FreeSWITCH` quando ele alcança o FreeSWITCH, e uma linha `pedido` para cada pedido do chat. Logo depois de ligar, uma linha `esl: sem ligação com o FreeSWITCH, vou tentando` também é normal: ela some quando o FreeSWITCH termina de ligar, em poucos segundos.

A cada vez que liga, o FreeSWITCH escreve algumas linhas que parecem erro e são normais:

- seis linhas `[ERR]` com `NATIVE SQL ERR` e, no fim, `[no such table: ...]` ou `[no such view: ...]`. O banco interno do FreeSWITCH começa vazio a cada vez, e ele tenta limpar tabelas que ainda não existem;
- uma linha com `Failed to set SCHED_FIFO scheduler` e outra com `Could not set nice level`: ele pede uma prioridade que não precisa;
- `We've become an orphan, no more console for us.`;
- linhas `[WARNING]` com `Rounding odd end port`, `Open of msrp.conf failed`, `Create additional event dispatch thread` ou `MSG Thread`.

Durante as reuniões, as linhas `[WARNING]` com `No audio stun for a long time!` ou `No video stun for a long time!` também são normais: alguém fechou a aba ou perdeu a rede sem sair, e a ligação dele cai sozinha um pouco depois, em até 60 segundos sem nada chegar dela.

Uma linha `[ERR]` com `VPX encode error [8:Invalid parameter:(null)]` também pode aparecer numa troca de formato do mosaico, e não pede ação (veja "Uma linha `VPX encode error` no registro do FreeSWITCH", no passo 9). Se, nesse mesmo instante, a imagem congelou para todos ou todos caíram da reunião, veja "A imagem congelou para todos, ou todos caíram da reunião ao mesmo tempo", no passo 9.

Qualquer outra linha com `[ERR]`, `[CRIT]` ou `[ALERT]` merece atenção. No agente, uma linha `o FreeSWITCH recusou um comando do mosaico`, com `comando=` e o nome do comando, também merece (veja "A reunião aparece como uma imagem só", no passo 9).

## 9. Os problemas comuns

**O certificado não sai.**
O instalador para com uma linha que começa com `ERRO: o certificado não saiu`. Com o chat e o vídeo num IP público só, essa linha também fala do comando `video` do chat.

Logo acima dessa linha, o certbot diz o motivo, em inglês:

- `DNS problem` ou `NXDOMAIN`: o nome ainda não existe no DNS, ou aponta para outro lugar. Rode `getent hosts <endereço>` e veja se aparece o IP público da VM (ou o do roteador). Se não, corrija o registro A e espere alguns minutos;
- `Timeout during connect` ou `Connection refused`: o Let's Encrypt não chegou na porta 80 da VM. Abra a porta 80 de entrada na rede da nuvem, no firewall e, se a VM fica atrás de um roteador, no redirecionamento dele (passo 1). Se o chat e o vídeo dividem um IP público só, veja a próxima lista;
- `too many failed authorizations` ou `rateLimited`: houve tentativas demais que falharam. O Let's Encrypt aceita no máximo 5 por hora para o mesmo nome. Espere uma hora antes de tentar de novo.

**Se o chat e o vídeo dividem um IP público só,** o Let's Encrypt chega na porta 80 do chat, e não na do vídeo. Confira, nesta ordem:

- a porta 80 pública vai para a VM do **chat** (e não para a de vídeo), e o registro A do vídeo aponta para o mesmo IP público do chat;
- o chat está na versão 0.2.0 ou mais nova, e o comando `video` foi rodado na VM do chat, com o nome do vídeo e o IP interno certos (passo 1). Para refazer, rode de novo o mesmo comando; ele troca o que estava lá;
- o repasse está ligado e a VM do chat chega à VM de vídeo. Na VM do chat, rode o teste da parte "Se o chat e o vídeo dividem um IP público só", do passo 1 ("Confira o repasse"):

```
curl -sS -H 'Host: <nome do vídeo>' http://127.0.0.1/.well-known/acme-challenge/teste
```

  Este teste vale a qualquer hora. Quando o instalador não está pedindo o certificado, o normal é esta linha, porque o certbot só escuta na porta 80 da VM de vídeo enquanto pede o certificado:

```
Não consegui falar com o servidor de vídeo.
```

  Uma linha em inglês que começa com `acme/autocert: host` quer dizer que o repasse está desligado: rode o comando `video` na VM do chat (passo 1).

O certbot, no registro dele, também diz o que o Let's Encrypt recebeu do chat, numa linha com `Invalid response`:

- `Invalid response` com `502`: o chat não alcançou a porta 80 da VM de vídeo. Confira o firewall entre as duas VMs (a TCP 80 da VM do chat para a VM de vídeo tem de estar liberada) e o IP interno que foi dado ao comando `video`. Para trocar o IP, rode o comando `video` de novo;
- `Invalid response` com `403`: o repasse não está ligado no chat. Rode o comando `video` na VM do chat e confira que o chat está na versão 0.2.0 ou mais nova.

Depois de corrigir, rode o mesmo comando de instalação de novo: ele segue de onde parou. Não insista muitas vezes seguidas: cada tentativa que falha conta no limite.

O registro completo do certbot mostra mais detalhes. Para ver as últimas 50 linhas dele:

```
sudo tail -n 50 /var/log/letsencrypt/letsencrypt.log
```

**O instalador diz que o endereço ainda não aponta para nenhum IP.**
A linha é `ERRO: o endereço <endereço> ainda não aponta para nenhum IP no DNS. Crie o registro A e espere alguns minutos.` Crie o registro A (passo 1) e espere. O `getent hosts <endereço>` mostra quando ele chegou na VM.

**O instalador diz que o endereço aponta para um IP que não é da internet.**
O nome aponta, na VM, para um IP da rede interna (como `10.`, `172.16.` a `172.31.` ou `192.168.`) ou para a própria VM (`127.`). O registro A tem de apontar para o IP público. Se o DNS público já está certo, o nome está no arquivo `/etc/hosts` da VM (tire-o de lá) ou num DNS interno da empresa (lá, ele também tem de apontar para o IP público: veja "Se a VM fica atrás de um roteador", no passo 1). Depois, rode a instalação de novo.

**O instalador diz que uma porta está em uso.**
Acima do `ERRO:`, cada linha mostra uma porta ocupada e, no fim dela, o programa que a usa (por exemplo, `nginx`). Pare esse programa e rode o instalador de novo. Para o `nginx`, por exemplo:

```
sudo systemctl stop nginx
```

A VM de vídeo é só para as reuniões: não deixe outros programas nela.

**O instalador diz que o servidor de vídeo já está instalado.**
O `instalar` só roda uma vez. Para trocar de versão, use o `atualizar` (passo 5). Para trocar o endereço do chat, use o `chat` (passo 6). Para ver a chave, use o `mostrar-chave` (passo 2).

**O instalador diz que o servidor de vídeo não ficou de pé.**
Algum dos três serviços não ligou. Acima do `ERRO:`, o instalador mostra as últimas linhas dos registros dos três. Se o problema é o agente, uma linha com `Erro:` diz o motivo. Se é o FreeSWITCH, procure as linhas com `[ERR]` ou `[CRIT]` que não estão entre as normais do passo 8; se é o coturn, as linhas com `ERROR`. Para tentar de novo, também quando isso acontece no fim da instalação, use o atualizar, com o mesmo `instalar.sh`:

```
sudo bash instalar.sh atualizar
```

Ele refaz a configuração e liga os serviços de novo. Se a instalação parou aqui, ela não chegou a mostrar a chave: quando o atualizar disser `Pronto`, veja a chave com o `mostrar-chave` (passo 2). Se o erro repetir, guarde as linhas do registro e avise quem cuida do servidor de vídeo.

**O apt perguntou sobre o /etc/turnserver.conf.**
Numa atualização do sistema (o `sudo apt upgrade`), o apt pode perguntar o que fazer com esse arquivo, que é a configuração do coturn. Responda `N`, que mantém o arquivo atual (é o padrão: basta apertar Enter). Se a resposta foi `Y`, o coturn voltou à configuração de exemplo, que não serve para as reuniões e aceita qualquer um, sem senha. Ponha a nossa de volta logo, com o `atualizar`, usando o `instalar.sh` que já está na VM (passo 5):

```
sudo bash instalar.sh atualizar
```

Você deve ver `Pronto: o servidor de vídeo agora está na versão <versão>.`, com a mesma versão de antes.

**O vídeo não abre depois de uma instalação sem o `--porta 7443`.**
Se o chat e o vídeo dividem um IP público só e a instalação foi feita sem o `--porta 7443`, o agente escuta na 443 da VM, que o roteador não leva até ela. O `instalar` não roda duas vezes, então a porta se troca no arquivo de configuração. Na VM de vídeo, veja em que porta o agente escuta:

```
sudo ss -ltnp
```

Se a linha do `starsonic-video` mostrar `:443` no lugar de `:7443`, abra o arquivo:

```
sudo nano /etc/starsonic-video/config.json
```

Acrescente `"porta": 7443` depois do último campo, com uma vírgula antes, e deixe o arquivo como JSON válido (é uma linha só, entre `{` e `}`). Salve (Ctrl e O, Enter) e saia (Ctrl e X). Reinicie o agente:

```
sudo systemctl restart starsonic-video
```

Rode o `sudo ss -ltnp` de novo: a linha do `starsonic-video` deve mostrar `:7443`. Depois, refaça a parte f) de "Se o chat e o vídeo dividem um IP público só", no passo 1 (o endereço com a porta no cartão "Reuniões"), e o teste de `curl` com `:7443` do passo 4.

**As portas estão fechadas (o chat diz que o servidor de vídeo não respondeu, ou ninguém vê nem ouve ninguém numa reunião).**
Confira se os programas estão escutando:

```
sudo ss -ltnup
```

Devem aparecer linhas com `:443` (ou `:7443`, se você instalou com o `--porta`), `:5061`, `:5349` e `:3478`. Se aparecerem e o servidor de vídeo não responde de fora da VM, a porta está fechada na rede da nuvem, no firewall ou no roteador. Confira cada linha da tabela de portas do passo 1, também as duas faixas UDP: sem elas, as pessoas entram na reunião, mas ninguém vê nem ouve ninguém.

Para saber se a porta 443 chega no agente vinda de fora, abra no celular, só no 4G:

```
https://<endereço>/agente/v1/saude
```

Com o `--porta 7443`, abra o endereço com a porta:

```
https://<endereço>:7443/agente/v1/saude
```

Deve aparecer `{"ok":true}`.

**A imagem ou o som do outro não chegam na reunião de teste.**
A página entrou na reunião (o chat e o agente estão bem), mas a imagem e o som não chegam: com as portas da imagem e do som fechadas e sem o TURN, a reunião aparece sem imagem e, depois de uns 30 segundos, a página mostra `Você saiu da reunião`. É quase sempre uma porta fechada para o vídeo. Confira, nesta ordem:

- **A porta do vídeo (a TCP 443, ou a 7443 se o chat e o vídeo dividem um IP público só).** É por ela que a página fala com o servidor de vídeo. Se ela estivesse fechada, a página não entraria na reunião: `O servidor de reuniões não respondeu` (veja a próxima pergunta) é o sinal. Abra o endereço da conferência do passo 4 de outra rede e veja `{"ok":true}`;
- **As portas da imagem e do som:** a UDP 16384 a 16683, abertas de entrada para qualquer endereço, na rede da nuvem, em qualquer firewall e, se a VM fica atrás de um roteador, no redirecionamento dele (passo 1, item 2). É a causa mais comum de entrar e não ver nem ouvir ninguém;
- **O TURN** (a UDP 3478, a TCP 5349 e a UDP 49152 a 49451). Quem está numa rede que bloqueia o UDP chega pelo TURN sobre TLS, na 5349. Se o celular no 4G entra, e o PC no escritório não (ou o contrário), o TURN ou o UDP daquela rede é o problema. Veja se o coturn está no ar:

  ```
  systemctl status coturn
  ```

  Se ele não estiver `active (running)`, veja os registros dele (passo 8).
- **O IP público da VM** tem de ser o que está na configuração, e fixo (passo 1). Se o IP mudou, a imagem não chega.

Teste de novo com outra rede (o celular no 4G, por exemplo): se funciona numa e não na outra, o problema está na rede que falhou, e não no servidor.

**O app ou a página dizem "O servidor de reuniões não respondeu".**
O chat não está conseguindo falar com o servidor de vídeo, ou o FreeSWITCH está fora do ar. O chat continua funcionando normalmente. Na página `Reuniões` da administração do chat, clique em `Testar o servidor de vídeo` e siga o que a mensagem disser (passo 3). Na VM de vídeo, veja se os três serviços estão ligados:

```
systemctl status starsonic-video starsonic-freeswitch coturn
```

Se algum não estiver `active (running)`, veja os registros dele (passo 8).

**O cartão avisa que os relógios estão diferentes.**
As reuniões funcionam assim mesmo, mas ligue o horário automático nas duas VMs, a do chat e a de vídeo (passo 1, item 4). Depois de alguns minutos, clique em `Testar o servidor de vídeo` de novo: o aviso some.

**Alguém numa rede que bloqueia o UDP.**
Algumas empresas bloqueiam o UDP na saída. As pessoas dessas redes entram pelo TURN sobre TLS, na porta 5349, sozinhas, sem fazer nada. Basta a porta TCP 5349 estar aberta (passo 1).

**Alguém numa rede que só deixa sair pela porta 443.**
Algumas redes, muito fechadas, só deixam sair pela porta 443. Quem está numa rede assim não entra nas reuniões: o TURN fica na 5349, porque a 443 é a do navegador. Se o chat e o vídeo dividem um IP público só, o navegador também pode ficar de fora, porque o vídeo usa a 7443 (veja o fim do passo 1). Se isso acontecer com algum cliente, avise quem cuida do servidor de vídeo. Com o vídeo na 443 (o caso normal), um segundo IP público, só para o TURN na porta 443, resolve.

**A reunião aparece como uma imagem só, sem os quadros.**
Era para cada pessoa ter o seu quadro, e a página mostra a imagem de todos juntos. A página só passa aos quadros quando recebe o palco (onde está cada pessoa na imagem) do servidor de vídeo, e espera uns 3 segundos por ele. Se ele não chega, ela mostra a imagem inteira. Confira, nesta ordem:

- **O servidor de vídeo ainda é o antigo.** Na página `Reuniões` da administração do chat, clique em `Testar o servidor de vídeo`: o cartão diz `O servidor de vídeo respondeu: versão <versão>, FreeSWITCH no ar.` A versão tem de ser a `0.1.0-rc.3` ou mais nova. Se for mais velha, rode o `atualizar` (passo 5);
- **O chat ainda é o antigo.** A versão do chat tem de ser a `0.2.0-rc.4` ou mais nova: é a que o `atualizar` do chat mostra no `Pronto: o Starsonic Chat agora está na versão <versão>.` (`docs/chat-servidor.md`, passo 7). Com o chat antigo e o servidor de vídeo novo, a imagem de todos aparece sem nenhum nome escrito, porque o servidor de vídeo novo não escreve mais os nomes na imagem: a página nova é que os escreve. Atualize o chat. Quem estava com a página aberta antes continua com a página antiga: peça para recarregar;
- **O FreeSWITCH recusou um comando do mosaico.** Veja os registros do agente (passo 8). Uma linha `o FreeSWITCH recusou um comando do mosaico`, com `comando=` e o nome do comando (`vid-res`, `vid-layout`, `vid-res-id` ou `vid-bandwidth`), quer dizer que o FreeSWITCH não aceitou uma mudança do mosaico. Com o `vid-res` ou o `vid-layout`, o agente não manda o palco novo, e a página mostra os quadros escuros, com os nomes, e depois de 3 segundos a imagem inteira. Com o `vid-res-id` ou o `vid-bandwidth`, o agente segue e manda o palco. O agente tenta de novo na próxima vez que alguém entrar ou sair da reunião. Se a linha se repete a cada entrada e saída, guarde as linhas do registro e avise quem cuida do servidor de vídeo.

**Uma linha `VPX encode error` no registro do FreeSWITCH.**
É uma linha `[ERR]` com `VPX encode error [8:Invalid parameter:(null)]`. Ela pode aparecer em qualquer troca de formato do mosaico: quando alguém começa ou para de compartilhar a tela, na passagem de 4 para 5 pessoas e de 9 para 10, na volta (de 5 para 4 e de 10 para 9) e quando o número de pessoas muda durante um compartilhamento. Ela custa uma imagem, e não pede ação. Se, nesse mesmo instante, a imagem congelar para todos ou todos caírem da reunião, veja "A imagem congelou para todos, ou todos caíram da reunião ao mesmo tempo", logo abaixo. Se ela se repetir sem ninguém ter entrado, saído ou compartilhado a tela, guarde as linhas do registro e avise quem cuida do servidor de vídeo.

**A imagem congelou para todos, ou todos caíram da reunião ao mesmo tempo.**
Era um defeito do FreeSWITCH na versão `0.1.0-rc.3` do servidor de vídeo, e a `0.1.0-rc.4` o corrige. A primeira coisa a conferir é se o FreeSWITCH instalado é o corrigido:

```
cat /opt/starsonic-freeswitch/VERSOES.txt
```

Se nenhuma linha começa por `patch freeswitch`, o servidor ainda está com o FreeSWITCH antigo: atualize para a `0.1.0-rc.4`, ou para uma versão mais nova (passo 5). O resto desta entrada diz o que era o defeito, e o que fazer enquanto a atualização não vem. Se aconteceu com o FreeSWITCH corrigido, é outro problema: faça o mesmo que está abaixo, e guarde os registros do FreeSWITCH e do agente daquela hora (passo 8).

Na versão `0.1.0-rc.3`, o mosaico muda de tamanho em alguns momentos: quando alguém começa ou para de compartilhar a tela; na passagem de 4 para 5 pessoas e de 9 para 10 (e na volta); e, durante um compartilhamento, de 2 para 3 e de 4 para 5 pessoas (e na volta). A versão de antes (a `0.1.0-rc.2`) nunca muda o tamanho, e não tem este defeito.

O FreeSWITCH 1.11.3 tem um defeito nessa troca, que aparece de dois jeitos:

- **A imagem congela para todos.** É o que acontece num servidor com mais de 2 processadores. Três partes do FreeSWITCH ficam esperando uma pela outra, enquanto a pessoa cuja imagem estava sendo desenhada naquele instante continuar na reunião. O processo continua de pé, então o serviço não reinicia sozinho, e ninguém vê tela de erro: todos continuam na reunião, com a imagem parada. O comando do agente fica sem resposta, e, enquanto isso, o mosaico de nenhuma reunião do servidor se arruma. Quando aquela pessoa sai da reunião, o FreeSWITCH segue sozinho.
- **Todos caem de uma vez**, em toda reunião que estiver no servidor naquele instante (o processo é um só para todas as salas). O FreeSWITCH troca a imagem do mosaico enquanto outra parte dele ainda usa a antiga, e o processo para. O serviço liga de novo sozinho 5 segundos depois. Isso foi visto com 2 processadores.

Nos testes de esforço, com uma troca de tamanho depois da outra: com 4 processadores, a imagem congelou em oito rodadas (a mais rápida depois de 10 trocas, a mais demorada depois de 1.138); com 2, ele caiu depois de 535 trocas numa rodada e aguentou 3.000 em outra. Ou seja, podia acontecer em qualquer uma dessas trocas.

Se a imagem congelou, peça para todos saírem da reunião e entrarem de novo. De fora, não dá para saber qual pessoa segura o FreeSWITCH: por isso, todos. Nos testes de esforço, isso foi medido quatro vezes: ele voltou a funcionar na hora em que a pessoa certa saiu (com o `Sair`), sem reiniciar nada, e uma reunião nova funcionou em seguida. Em três delas foi a primeira pessoa a sair; em uma, a segunda. Se, 2 minutos depois de todos saírem, as reuniões não voltarem ao normal, reinicie o FreeSWITCH. Isso encerra todas as reuniões que estão no servidor:

```
sudo systemctl restart starsonic-freeswitch
```

Qual link volta a valer depois: na `Reunião de teste` e na `Reunião marcada`, as pessoas entram de novo pelo mesmo link (na marcada, quem é de fora espera um colega entrar de novo); a `Reunião agora` acaba quando fica vazia ou quando o FreeSWITCH sai do ar, e o link dela não vale mais: gere outro. Quando o FreeSWITCH sai do ar (na queda ou no reinício), o agente avisa o chat de que cada sala acabou, e a página mostra `A reunião acabou`, sem botão (abra o link de novo), ou `Você saiu da reunião`, com o `Entrar de novo`.

Para confirmar uma queda, veja os registros do FreeSWITCH (passo 8):

```
sudo journalctl -u starsonic-freeswitch -n 50 --no-pager
```

Se foi há pouco, eles mostram o serviço terminando e ligando de novo sozinho, e pode haver linhas `VPX encode error` com `Image size must match` ou `Invalid image format` um pouco antes. Quando a imagem congela, eles não mostram nada naquela hora: o serviço continuou de pé. Para uma queda mais antiga, o mesmo comando com mais linhas chega mais longe:

```
sudo journalctl -u starsonic-freeswitch -n 500 --no-pager
```

A correção são dois arquivos da pasta `video-servidor/freeswitch/patches`, que entram no FreeSWITCH quando o pacote é montado (`docs/superpowers/specs/2026-11-19-starsonic-phone-freeswitch-troca-de-tamanho-design.md`). Com o primeiro, a troca de tamanho passa a ser feita pela parte do FreeSWITCH que desenha o mosaico, como ele já faz com a troca de layout. Com o segundo, o comando que o agente manda logo depois de pedir um tamanho (o da banda) espera essa troca acabar, em vez de ler a imagem no meio dela. Dois testes de esforço rodam a cada mudança do código: mil pedidos de troca de tamanho seguidos, com uma pessoa entrando e saindo no meio, e trezentas trocas conferidas uma a uma.

**A CPU alta.**
A página `Reuniões` do chat mostra o uso do servidor de vídeo no teste: `Uso agora: CPU <n>% · memória <n>%.` A CPU é a média do último minuto. Com reuniões acontecendo, se a CPU fica acima de uns 80%, a imagem pode travar. Diminua as `Reuniões ao mesmo tempo` (passo 3), ou dê mais vCPUs à VM e depois aumente o número.

## 10. Publicar uma versão

Este passo é de quem publica o servidor de vídeo, e não da VM. Você faz tudo pelo site do GitHub, no navegador, e não precisa de comando para publicar. É o workflow `video-release`.

1. Abra a página do projeto no GitHub e clique em `Actions`.
2. Na lista da esquerda, clique em `video-release`.
3. Clique em `Run workflow`, à direita.
4. No campo `Versão a publicar`, escreva `0.1.0-rc.1` (só o número, sem o `video-v`). Para uma versão que não é de teste, use `0.1.0`.
5. Clique no botão verde `Run workflow` e espere.

Na primeira vez, o GitHub monta o FreeSWITCH dos três sistemas, e isso leva bastante tempo. Nas próximas vezes ele aproveita o que já montou, e leva alguns minutos.

O GitHub testa o programa, confere cada pacote do FreeSWITCH num sistema limpo, monta a versão e só publica no fim, quando todos os arquivos já estão lá. Se algo falhar no meio, nada fica publicado: abra o run, veja a mensagem em vermelho, corrija e rode de novo. Se sobrar um rascunho em `Releases`, apague-o antes de rodar de novo: o workflow para com a mensagem `já existe um rascunho` se ele ainda estiver lá.

### O que conferir depois

1. Em `Releases`, abra `video-v0.1.0-rc.1`. Ela deve ter a etiqueta `Pre-release` e estes treze arquivos (o GitHub mostra ainda duas linhas `Source code`, que ele cria sozinho e você pode ignorar):
   - `starsonic-video-linux-amd64`
   - `starsonic-video-linux-amd64.sha256`
   - `starsonic-freeswitch-ubuntu-24.04-amd64.tar.gz`
   - `starsonic-freeswitch-ubuntu-24.04-amd64.tar.gz.sha256`
   - `starsonic-freeswitch-ubuntu-26.04-amd64.tar.gz`
   - `starsonic-freeswitch-ubuntu-26.04-amd64.tar.gz.sha256`
   - `starsonic-freeswitch-debian-12-amd64.tar.gz`
   - `starsonic-freeswitch-debian-12-amd64.tar.gz.sha256`
   - `starsonic-freeswitch-fontes.tar.gz`
   - `instalar.sh`
   - `starsonic-video.service`
   - `starsonic-freeswitch.service`
   - `certificado.sh`
2. O SHA-256: o número dentro de cada arquivo `.sha256` tem de ser o do arquivo dele. O `instalar.sh` já confere isso sozinho na instalação (você vê `SHA-256 conferido.`). Para conferir à mão, use a VM (o Windows não tem o `sha256sum`). Na VM, baixe o programa:

```
curl -fsSLO https://github.com/LucasCPena/starsonic-phone/releases/download/video-v0.1.0-rc.1/starsonic-video-linux-amd64
```

Baixe o arquivo do SHA-256, na mesma pasta:

```
curl -fsSLO https://github.com/LucasCPena/starsonic-phone/releases/download/video-v0.1.0-rc.1/starsonic-video-linux-amd64.sha256
```

E rode:

```
sha256sum -c starsonic-video-linux-amd64.sha256
```

Deve aparecer `starsonic-video-linux-amd64: OK`.

3. O endereço `releases/latest` tem de responder 404, ou mostrar uma versão do Windows (uma etiqueta que começa com `v`, como `v1.0.0`), porque o canal Estável dos apps lê esse endereço. Ele não pode mostrar a `video-v…`. Rode:

```
curl -sI https://api.github.com/repos/LucasCPena/starsonic-phone/releases/latest
```

A primeira linha deve ter `404`. Se o Windows já tiver uma versão estável, o endereço responde `200`, e isso também está certo, desde que a versão seja a do Windows. O workflow confere isso no último passo e falha se o endereço apontar para outra coisa. Nesse caso, em `Releases`, abra essa release, clique em `Edit` e marque `Set as a pre-release` (ou apague a release e a etiqueta dela). Não instale nada antes disso.

Pronto: agora o passo 2 (instalar) e o passo 5 (atualizar) acham a versão nova.
