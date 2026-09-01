# Implantar o Apps Script de congelamento da semana

Este guia cobre a implantação do Web App que grava a Tendência CONGELADA de cada
semana (botão "Congelar próxima semana" na aba Consolidado da página semanal). O
código já está pronto em `tools/semanal/apps-script-congelamento.gs` — o que falta é
publicá-lo como Web App e apontar o dashboard para a URL publicada.

Sem este passo o botão fica desabilitado: `URL_CONGELAMENTO`
(`tools/semanal/render-semanal.js:1591`) começa como o literal `'PENDENTE-congelamento'`,
e `urlCongelamentoPendente()` (mesmo arquivo, linha 1604) usa esse prefixo para detectar
que o congelamento ainda não foi configurado.

## Passo a passo

### 1. Criar (ou reaproveitar) uma Google Sheet

Pode ser uma planilha nova em branco, ou uma já existente — **não é preciso criar a
aba `Congelamento` à mão**. `abaCongelamento()` (dentro do próprio `.gs`) cria a aba na
primeira chamada, com o cabeçalho e a formatação de texto puro já configurados.

### 2. Colar o script

Na Sheet, vá em **Extensões > Apps Script**. Apague o conteúdo padrão do
`Código.gs` e cole o conteúdo inteiro de `tools/semanal/apps-script-congelamento.gs`.

### 3. Calcular o token

O token é o SHA-256 (em hexadecimal) do SAL fixo `congelamento-semanal:v1:` seguido da
senha do dashboard (`ORCAMENTO_SENHA`). O SAL está definido em
`tools/comum/render-shell.js:440` (`var SAL_TOKEN = 'congelamento-semanal:v1:';`) — é
público, só serve para impedir que o mesmo token calculado sirva em outro contexto; quem
já tem a senha consegue derivá-lo de qualquer jeito.

Rode localmente:

```bash
node -e "console.log(require('node:crypto').createHash('sha256').update('congelamento-semanal:v1:'+process.argv[1]).digest('hex'))" '<senha do dashboard>'
```

Isso imprime uma string hexadecimal de 64 caracteres — é o token.

### 4. Definir a Script Property

No editor do Apps Script: **Configurações do projeto (ícone de engrenagem) > Propriedades
do script > Adicionar propriedade do script**. O `.gs` lê a propriedade com o nome exato
`TOKEN_DASHBOARD` (`tokenEsperado()`, linha 17 do `.gs`, chama
`PropertiesService.getScriptProperties().getProperty('TOKEN_DASHBOARD')`) — o nome tem
que bater exatamente, sem variações de maiúscula/minúscula. Cole o token calculado no
passo 3 como valor.

### 5. Implantar como Web App

No editor: **Implantar > Nova implantação**. Escolha o tipo "App da Web" e configure:

- **Executar como:** Eu (a conta dona da Sheet)
- **Quem tem acesso:** Qualquer pessoa

"Qualquer pessoa" é necessário porque o Apps Script não tem como saber quem é o usuário
do dashboard — o dashboard não faz OAuth nem login Google. A autenticação de verdade é o
**token** (passo 3/4), verificado em `tokenValido()` dentro do próprio `.gs`; a permissão
"Qualquer pessoa" só libera a execução do script para qualquer requisição HTTP, sem
exigir uma conta Google associada. Sem o token certo, `doGet`/`doPost` recusam com
`{ erro: 'token' }`, mesmo com "Qualquer pessoa" liberado.

### 6. Copiar a URL de implantação

A URL gerada termina em `/exec`. Copie-a e cole em `URL_CONGELAMENTO`
(`tools/semanal/render-semanal.js:1591`), substituindo o literal
`'PENDENTE-congelamento'`. Depois de trocar, reconstrua e publique a página semanal
seguindo o processo normal do projeto (ver `CLAUDE.md`, seção "Planejamento Semanal").

### 7. Reimplantar mantendo a MESMA URL (aviso importante)

Qualquer alteração futura no `.gs` (ex.: corrigir um bug) **não** deve ser publicada como
"Nova implantação" — isso gera uma URL `/exec` diferente e exige editar
`URL_CONGELAMENTO` de novo, rebuildar e republicar a página só por causa da troca de
código do lado do Apps Script.

O caminho certo é: **Implantar > Gerenciar implantações > (ícone de lápis na
implantação existente) > Versão: Nova versão > Implantar**. Isso atualiza o código por
trás da mesma URL, sem quebrar o link já configurado no dashboard.

Este é o mesmo padrão que `tools/semanal/apps-script-alocacao.gs` já usa neste projeto
(a Web App da aba Alocação Equipes) — já testado e em produção aqui, não é um
procedimento novo.

## Como testar sem publicar nada

Antes de trocar `URL_CONGELAMENTO` de verdade no código, é possível confirmar que o
Apps Script está respondendo corretamente abrindo a URL de implantação direto no
navegador, com os parâmetros de uma requisição GET:

```
<url-de-implantação>/exec?semana=2026-01-01&token=<token calculado no passo 3>
```

- Resposta esperada, com a Sheet ainda sem nenhuma linha para essa semana:
  `{"linhas":[]}` — confirma que o token foi aceito e a aba `Congelamento` foi
  criada/lida sem erro.
- Se o token estiver errado ou a Script Property não tiver sido salva:
  `{"erro":"token"}`.
- Qualquer outra coisa (página de erro do Google, HTML de login, timeout) indica que a
  implantação não está com "Executar como: eu" + "Quem tem acesso: qualquer pessoa"
  configurados corretamente, ou que a URL copiada está incompleta.

Só depois de ver `{"linhas":[]}` (ou uma lista de linhas, se a semana testada já tiver
sido congelada antes) é seguro colar a URL em `URL_CONGELAMENTO` e publicar.
