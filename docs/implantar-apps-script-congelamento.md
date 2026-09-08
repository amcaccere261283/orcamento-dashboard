# Implantar o Apps Script de congelamento da semana

Este guia cobre a implantação do Web App que grava a Tendência CONGELADA de cada
semana, hoje controlado por um **switch on/off por semana** na aba Consolidado da
página semanal (2026-09-08 -- substituiu o botão write-once "Congelar próxima
semana": qualquer semana do seletor pode ser travada/destravada, não só a próxima
segunda). O código já está pronto em `tools/semanal/apps-script-congelamento.gs` —
o que falta é publicá-lo como Web App e apontar o dashboard para a URL publicada.

**Ordem de deploy obrigatória, sempre nesta ordem:** reimplante o `.gs` primeiro
(passo 7 abaixo, se já existir uma implantação; passo 5, se for a primeira vez) e
confirme com o teste do fim deste guia que `ler` devolve um campo `estado` na
resposta — só DEPOIS publique o HTML (`planejamento-semanal.html`). Inverter a
ordem é degradado, não destrutivo: um Web App antigo (de antes do toggle) não
reconhece `travar`/`destravar`, nem devolve `estado` em `ler` -- o cliente novo cai
no valor default (`{ travada: false }`) para toda semana, o toggle aparece
destravado mesmo quando não está, e as ações de travar/destravar falham em
silêncio ou não fazem nada. O toggle parece funcionar (o switch responde ao
clique) mas não trava nada de verdade -- ver o parágrafo equivalente no
`CLAUDE.md`, seção "Congelamento da semana por botão".

Sem este passo o botão fica desabilitado: `URL_CONGELAMENTO`
(`tools/semanal/render-semanal.js:1591`) começa como o literal `'PENDENTE-congelamento'`,
e `urlCongelamentoPendente()` (mesmo arquivo, linha 1604) usa esse prefixo para detectar
que o congelamento ainda não foi configurado.

## Passo a passo

### 1. Criar (ou reaproveitar) uma Google Sheet

Pode ser uma planilha nova em branco, ou uma já existente — **não é preciso criar as
abas à mão**. O `.gs` cria as DUAS abas que usa na primeira chamada, cada uma já com
cabeçalho e formatação de texto configurados: `abaCongelamento()` cria `Congelamento`
(os pontos/snapshots, uma linha por chave×registro) e `abaCongelamentoEstado()` cria
`CongelamentoEstado` (uma linha por semana, com `Travada`/`Autor`/`AtualizadoEm` --
é o que o toggle lê para saber se a semana está travada).

### 2. Colar o script

Na Sheet, vá em **Extensões > Apps Script**. Apague o conteúdo padrão do
`Código.gs` e cole o conteúdo inteiro de `tools/semanal/apps-script-congelamento.gs`.

### 3. Calcular o token

O token é **PBKDF2-SHA256** da senha do dashboard (`ORCAMENTO_SENHA`), com o SAL fixo
`congelamento-semanal:v1:` como sal, **250.000 iterações** e 32 bytes de saída, em
hexadecimal. O SAL está definido em `tools/comum/render-shell.js`
(`var SAL_TOKEN = 'congelamento-semanal:v1:';`) e o número de iterações logo abaixo
(`var ITERACOES_TOKEN = 250000;`, o mesmo `ITERACOES_PBKDF2` que
`tools/comum/criptografia.js` usa para o blob cifrado). O SAL é público, só serve para
impedir que o mesmo token sirva em outro contexto; quem já tem a senha consegue derivá-lo
de qualquer jeito — o custo do PBKDF2 é o que impede o caminho inverso, recuperar a senha
a partir de um token vazado.

Rode localmente:

```bash
node -e "console.log(require('node:crypto').pbkdf2Sync(process.argv[1],'congelamento-semanal:v1:',250000,32,'sha256').toString('hex'))" '<senha do dashboard>'
```

Isso imprime uma string hexadecimal de 64 caracteres — é o token. O cálculo demora
alguns décimos de segundo, por causa das iterações; é o mesmo custo que a página paga
uma vez, ao desbloquear.

**Se qualquer um dos três (SAL, número de iterações, tamanho da saída) divergir do que
está no código, o token sai diferente e o congelamento recusa com "token recusado", sem
nenhuma outra pista.** `test/comum-render-shell.test.js` trava os três: ele roda
`derivarTokenSheet` de verdade num sandbox e compara com este mesmo `pbkdf2Sync`.

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
exigir uma conta Google associada. Sem o token certo, `doPost` recusa com
`{ erro: 'token' }`, mesmo com "Qualquer pessoa" liberado.

**Leitura e escrita são as duas POST.** `doGet` não lê nada — responde
`{ erro: 'use-post' }` para quem abrir a URL no navegador. O token viajava na query
string do GET, onde aparece nos logs de execução do Apps Script e em qualquer registro
de requisição pelo caminho; no corpo do POST, não. A ação é escolhida pelo campo `acao`
do corpo, cinco no total:

- `'ler'` (com `semana`, `chaveSegunda`, `chavesFragmentos`) -- devolve `{ linhas,
  estado }`, onde `estado` é `{ travada, autor, atualizadoEm }` da semana (chaveada
  pela segunda-feira real).
- `'travar'` (com `chaveSegunda`, `autor`, `travadoEm`, `linhas`) -- faz upsert do
  snapshot enviado E marca a semana como travada.
- `'destravar'` (com `chaveSegunda`, `autor`, `destravadoEm`) -- só desliga a trava,
  nunca apaga pontos já gravados.
- `'congelar'` (com `chaveSegunda`, `autor`, `congeladoEm`, `linhas`) -- upsert
  condicionado ao estado: grava (sobrescrevendo o snapshot anterior) só se a semana
  estiver ABERTA; recusa com `{ erro: 'travada' }` se estiver travada. É o que
  "Atualizar dados" chama quando a semana em tela no Consolidado não está travada.
- `'desfazer'` (com `chaves`, lista de chaves de fragmento) -- mecanismo manual de
  recuperação, sem UI no dashboard: apaga as linhas de pontos das chaves pedidas E a
  linha de `CongelamentoEstado` correspondente (senão a semana ficaria "travada" sem
  nenhum ponto pra sustentar isso).

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

**`curl` NÃO serve para este teste — o Google bloqueia esse tipo de cliente como tráfego
automatizado (403, sem corpo, mesmo com a implantação 100% correta).** Confirmado em
2026-09-01: uma implantação com "Qualquer pessoa" configurado corretamente devolvia
`403 Forbidden` pro `curl` (com ou sem `--post302`, com ou sem User-Agent de navegador),
mas funcionava perfeitamente para um `fetch()` de dentro de um navegador real — que é
exatamente como o dashboard usa a URL. Testar com `curl` e ver 403 não prova implantação
errada; só prova que o Google não gosta de `curl`.

**O teste que vale é `fetch()` de um navegador de verdade**, sem login Google, a partir da
MESMA origem que o dashboard usa (evita qualquer diferença de CORS/CSP entre origens):

1. Abra `https://amcaccere261283.github.io/orcamento-dashboard/planejamento-semanal.html`
   no navegador (sem precisar desbloquear com senha — o teste roda no console, antes do
   gate).
2. Abra o Console (F12) e rode:

```javascript
fetch('<url-de-implantação>/exec', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({ acao: 'ler', token: '<token calculado no passo 3>', semana: '2026-01-01' }),
}).then(r => r.text()).then(console.log);
```

- Resposta esperada, com a Sheet ainda sem nenhuma linha para essa semana:
  `{"linhas":[],"estado":{"travada":false,"autor":"","atualizadoEm":""}}` — confirma
  que o token foi aceito e as duas abas (`Congelamento`, `CongelamentoEstado`) foram
  criadas/lidas sem erro. **O campo `estado` é o que prova que a implantação já é a
  versão com o toggle** — uma implantação antiga (de antes de 2026-09-08) devolveria
  só `{"linhas":[]}`, sem `estado`, e o dashboard cairia no default `{ travada: false
  }` para toda semana em silêncio (ver o aviso de ordem de deploy no topo deste guia).
- Se o token estiver errado ou a Script Property não tiver sido salva:
  `{"erro":"token"}`.
- Abrir a URL direto no navegador, logado na conta dona do script (um GET) devolve
  `{"erro":"use-post"}` — isso é o comportamento correto, não um defeito de implantação.
  **Mas não abra a URL deslogado/anônimo pra testar** — sem sessão Google nenhuma, o
  próprio Google pode bloquear a navegação com uma página de erro do Drive ("Não foi
  possível abrir o arquivo") mesmo com a implantação certa; use sempre o `fetch()` do
  passo acima, nunca a barra de endereço, pra testar o caminho anônimo de verdade.

Só depois de ver `{"linhas":[]}` (ou uma lista de linhas, se a semana testada já tiver
sido congelada antes) é seguro colar a URL em `URL_CONGELAMENTO` e publicar.
