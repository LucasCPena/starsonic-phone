# Starsonic Phone (Android) — o que mudou para a LGPD na 0.2

A 0.2 ("ramal completo") é a primeira versão do app que pede acesso a dados pessoais além da conta do ramal: os **contatos do celular**. Esta nota diz o que o app faz com eles, para a Starsonic atualizar a política de privacidade do site (a página é da Starsonic; o app não traz uma política própria) e responder ao que as lojas vão perguntar (documento "Starsonic Phone: o que precisamos para publicar nas lojas", 16/10/2026).

## O que o app passa a acessar

- A **agenda de contatos do Android** (permissão `READ_CONTACTS`), só depois que a pessoa a concede na aba Contatos. Antes disso, e se ela negar, o app funciona inteiro só com números.
- **Para quê:** mostrar o nome do contato no lugar do número (ligação recebida, tela de chamada, notificações e Recentes), listar os contatos na aba Contatos, sugerir contatos ao digitar e ligar pelo nome.

## O que o app faz e não faz com os contatos

- **Lê na hora, não guarda.** O nome é procurado na agenda a cada ligação e a cada abertura da aba ou tecla digitada; o app não copia a agenda, não cria um banco de contatos próprio e não guarda nome de contato no Recentes (o Recentes guarda só o número e o nome que a central mandou, como na etapa 1).
- **Não sai do celular.** Nenhum contato (nome ou número) é enviado à central, ao GitHub, à Starsonic ou a terceiros. O que vai ao servidor SIP é só o número discado, como em qualquer telefone.
- **Não aparece no diagnóstico.** O arquivo do "Enviar diagnóstico" tem números de ligações e estados do app, como antes; nenhum nome da agenda.
- **A pessoa manda.** A permissão é pedida na aba Contatos, não no Entrar; pode ser negada e pode ser retirada depois nas configurações do Android, e o app segue funcionando só com números.

## O que a política de privacidade deve dizer (sugestão)

1. Dados tratados: o número e o nome do ramal (a conta), os registros de ligações no próprio aparelho (número, nome que a central mandou, data, hora, duração) e, com a permissão da pessoa, a leitura dos contatos do aparelho.
2. Finalidade dos contatos: identificar quem liga e ligar pelo nome. Base legal: consentimento (a permissão do Android), revogável a qualquer momento nas configurações.
3. Armazenamento e compartilhamento: os contatos não são armazenados pelo app nem compartilhados com ninguém; ficam só no aparelho.
4. O que já valia na etapa 1: a senha do ramal fica no armazenamento privado do app, criptografada com o Keystore do Android, e não entra nos diagnósticos; o app fala só com a central da Starsonic configurada e com o GitHub (para as atualizações).

## Para as lojas

- **Google Play (Data safety):** declarar "Contatos" como dado acessado, não coletado nem compartilhado (processado só no aparelho, sem envio); a permissão `READ_CONTACTS` é a única nova em relação à 0.1 (o `check_apk.py` confere a lista exata a cada build).
- **App Store (quando houver iPhone):** "Contacts" em Privacy Nutrition Labels como não coletado, e a `NSContactsUsageDescription` com o mesmo texto da finalidade acima.

## O que não mudou

Nada mais passou a ser coletado. O app não tem analytics, não tem anúncios e não manda dados a terceiros.
