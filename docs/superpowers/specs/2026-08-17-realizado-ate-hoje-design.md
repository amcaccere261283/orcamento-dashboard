# O Realizado passa a contar até HOJE (D), não até d−1 — design

Data: 2026-08-17. Página: Planejamento Semanal (`docs/planejamento-semanal.html`).
Escopo: só esta página e o fetcher de Equipes — o dashboard de orçamento não é tocado.

## O pedido

Regra 1 da seção "Regras de dados da Tabela Semanal e dos Gráficos" (2026-08-10,
`CLAUDE.md`) manda: **"todo Realizado para em d−1"**. A justificativa era que o dia
corrente está incompleto por construção — o extrato do sond.com.br é alimentado ao
longo do dia, então contá-lo faz a semana em curso parecer em queda até virar a
meia-noite.

Pedido do dono do projeto em 2026-08-17: **o Realizado passa a contar até D (hoje)**,
porque a atualização dos dados passou a acontecer às 8h diariamente — o dado que a
página serve é um retrato das 8h, não um fluxo que se degrada ao longo do dia.

E explicitamente: **a regra do corte em D vale para o Realizado**, não só para a
Demanda, que já usava D (regra 2 da mesma seção: "pendência ≤ D e execução > D").

**O que o dono do projeto perguntou e foi confirmado antes de implementar:** "com a
opção 1 eu vou ter o acumulado na semana até o dia anterior, certo?" — sim. O corte
em d−1 de hoje já inclui o dia anterior INTEIRO; a mudança só **acrescenta** o dia
corrente por cima. Nada do que a página já mostra é perdido.

## Decisão 1 — o corte do Realizado vira `hojeEpoch`

`calcularSeriesSemanaisDimensao` (`tools/semanal/render-aba-semanal.js`) tem hoje uma
variável própria só para esse corte:

```js
var realizadoAteEpoch = hojeEpoch - 1;
```

Ela **desaparece**. O Realizado passa a usar `hojeEpoch` direto, que é o que todo o
resto da função já usa (qual é a semana em curso, o saldo de Demandas Pendentes, o
congelamento do Consolidado). Some a única exceção que existia.

Não vira `var realizadoAteEpoch = hojeEpoch;`: um alias puro é indireção sem
conteúdo, e o conceito que ele nomeava ("o Realizado tem um corte PRÓPRIO") deixou de
existir. Se um dia voltar a existir, volta com ele.

Três pontos de uso mudam junto:

- **Volume/Financeiro, semana em curso** (`contarEventosNoIntervalo(..., semana.inicio,
  realizadoAteEpoch, ...)`): passa a contar até `hojeEpoch`.
- **Equipes, janela por semana** (`if (semana.inicio > realizadoAteEpoch) return null`
  e `var fim = Math.min(semana.fim, realizadoAteEpoch)`): idem.
- Os blocos de comentário que explicam a regra de d−1 nesses três lugares.

### Consequência deliberada em Equipes

Hoje, uma semana que **começou hoje** cai em `semana.inicio > realizadoAteEpoch` e
devolve `null` (o comentário no código diz literalmente "semana futura, ou começou
hoje"). Com o corte em D isso deixa de valer: `semana.inicio > hojeEpoch` só é
verdade para semana estritamente futura, e a semana que começou hoje passa a mostrar
a média de **1 dia** em vez de "sem dado".

É a leitura certa sob a regra nova — se o dia de hoje conta, uma semana de um dia é
uma semana com um dia de dado, não uma semana sem dado. O comentário "ou começou
hoje" sai junto.

### Efeito colateral bem-vindo: duas abas param de discordar

`compute-balanco.js` já corta a janela do Realizado em `hojeEpoch`
(`return { inicio: janela.inicio, fim: Math.min(janela.fim, hojeEpoch) }`), não em
d−1. Ou seja, **Tabela Semanal e Balanço de massa respondem hoje a mesma pergunta com
cortes diferentes**. Esta mudança alinha as duas sem tocar no Balanço.

## Decisão 2 — o fetcher de Equipes busca até D

Sem isto a Decisão 1 não tem efeito nenhum na dimensão Equipes: a Tabela permitiria o
dia corrente, mas o CSV não teria a linha.

`tools/semanal/atualizar-equipes-online.js` corta em d−1 em **dois** lugares, e os
dois mudam:

- `const diaFim = diaEpochDeOntem();` → o dia de hoje;
- o filtro final `l.diaEpoch <= diaFim`, que hoje descarta explicitamente "o dia de
  hoje" antes de gravar (o `console.log` de descarte cita isso).

`tools/comum/datas.js`: `diaEpochDeOntem` **sai** e entra `diaEpochDeHoje`. O único
consumidor é esse fetcher, e a função **não está no bloco `<<< INICIO CLIENTE`** (só
`excelSerialParaData` está), então não há impacto no bundle do navegador.

**Sondagem (Link 1) e Lab (Link 4) não precisam de nada**: buscam por MÊS inteiro, então
o dia corrente já vem. Só o Link 7 (produção de equipes) tinha corte por dia.

## Decisão 3 — o buraco do último dia do mês, que a Decisão 2 cria

`mesesPendentes` (`atualizar-equipes-online.js`) devolve o mês corrente **sempre**
(`if (mes === mesCorrente || !comDado.has(chave))`), então o dia parcial gravado às 8h
de hoje é rebuscado e sobrescrito amanhã, já completo. Isso resolve o caso normal
sozinho.

**Menos na virada do mês.** No dia 1º, `mesCorrente` é o mês novo e o mês anterior já
está em `comDado` — não é rebuscado. O **último dia de cada mês** ficaria congelado
para sempre no estado parcial das 8h daquele dia, subestimando o Realizado de Equipes
sem erro nem aviso. É exatamente a classe de falha silenciosa que este projeto já
levou duas vezes (o `historico.json` de 2026-07-12; a coluna `Valor` das medições).

**Correção:** `mesesPendentes` passa a devolver também o **mês anterior do mesmo ano**:

```js
if (mes === mesCorrente || mes === mesCorrente - 1 || !comDado.has(chave)) pendentes.push(mes);
```

Custo: uma janela mensal a mais por execução (o fetcher já busca o mês corrente toda
vez).

**Limite conhecido, documentado e não tratado:** em 31/12 → 01/01 a virada cruza o
ano, e o backfill deste fetcher é escopado ao ano corrente (`hojeNoFusoProjeto()`
devolve `ano`, e o laço vai de 1 a `mesCorrente`). O dia 31/12 fica com o retrato
parcial das 8h. Tratar isso exigiria o fetcher cruzar anos, o que é uma mudança maior
do que o problema justifica — uma vez por ano, num dia em que praticamente não há
produção de campo.

## Decisão 4 — a documentação que esta mudança torna falsa

Quatro textos afirmam a regra antiga e **têm** de mudar junto, senão o repositório
passa a mentir sobre o próprio comportamento:

1. **`CLAUDE.md`, seção "Regras de dados da Tabela Semanal e dos Gráficos
   (2026-08-10)", regra 1** — "E **todo Realizado para em d−1** — o dia corrente está
   incompleto por construção. `realizadoAteEpoch` (`render-aba-semanal.js`) existe só
   para isso". Passa a descrever o corte em D, com a data e o motivo (captura às 8h),
   preservando o registro de que a regra de 2026-08-10 existiu e por quê.
2. **`CLAUDE.md`, mesma seção, regra 5** — cita `diaEpochDeOntem` como parte do
   contrato de fuso. Vira `diaEpochDeHoje`.
3. **`CLAUDE.md`, adendo do alerta de movimentação (2026-08-17)** e
   **`docs/superpowers/specs/2026-08-17-semanal-tendencia-ramo-acima-design.md`,
   parágrafo "Decisão explícita, sem trava extra"** — os dois dizem que o alerta
   dispara "POR CONSTRUÇÃO" / "com CERTEZA" toda segunda-feira, porque
   `realizadoVigente` era zero por força do corte em d−1. **Com o corte em D isso
   deixa de ser verdade**: a segunda-feira passa a poder ter avanço registrado, e o
   disparo deixa de ser estrutural. Os dois textos passam a dizer que o alerta *tende*
   a disparar cedo na segunda (às 8h a segunda está quase vazia), sem a garantia.
4. **`tools/relatorio/gerar-glossario-alocacao-docx.js`** — o glossário afirma "O
   realizado para sempre em ONTEM" (duas ocorrências). Passa a dizer HOJE.

## Decisão 5 — o que NÃO muda

- **A trava de dias mínimos do alerta de movimentação** continua fora de escopo —
  decisão do dono do projeto nesta mesma conversa ("não agora, só corrigir a
  documentação"). A mudança para D já remove a parte estrutural do problema.
- **`compute-balanco.js`** — já cortava em `hojeEpoch`; é a Tabela que vem até ele.
- **Fetchers de Sondagem e Lab** — buscam por mês, sem corte por dia.
- **A regra 2** (demanda é estoque em D) e as demais regras da seção de 2026-08-10.
- **O dashboard de orçamento**, em qualquer aspecto.

## Testes

Três arquivos prendem hoje o comportamento de d−1 e precisam ser atualizados para a
regra nova — em todos, o valor esperado muda porque a janela ganha um dia:

- `test/semanal-render-aba-consolidado.test.js:147-170` — o teste diz explicitamente
  que "os 30 furos de 06/07 NÃO entram: em 06/07 nenhum dia da S2 tinha fechado ainda
  (corte em d-1)". Com o corte em D, 06/07 é o próprio dia e **entra**.
- `test/semanal-render-aba-semanal.test.js:449-476` — o teste de Realizado de Equipes
  descreve "S3 vigente truncada em 2 dias" (13 e 14, com hoje = 15). Com D são **3
  dias** (13, 14 e 15), e a média muda.
- `test/semanal-render-alertas-tendencia.test.js:88` — só um comentário citando "o
  corte de d-1 (14/07)". As asserções não mudam (não há evento em 13/14/15 no
  cenário), mas o comentário fica errado.

Testes novos a acrescentar:

- **O dia de hoje entra no Realizado** — um furo com data de hoje aparece na semana em
  curso. É a garantia direta do pedido, e nenhum teste atual a cobre (todos os
  cenários de hoje colocam eventos em dias passados).
- **`mesesPendentes` devolve o mês anterior** (Decisão 3), inclusive quando esse mês
  já tem dado — é o que impede o congelamento do último dia do mês. E não devolve mês
  algum antes de janeiro (`mesCorrente - 1` com `mesCorrente = 1`).
- **Equipes: semana que começou hoje deixa de ser "sem dado"** (a consequência
  deliberada da Decisão 1).

A suíte inteira (`node --test test/*.js`, 1269 testes hoje) tem de fechar verde antes
de qualquer build.

## Publicação — restrição desta rodada

**O dono do projeto avisou em 2026-08-17 que o Patrick está atualizando os dados do
Realizado neste momento, e pediu explicitamente para não interferir.** Portanto, nesta
rodada:

- **não rodar nenhum fetcher** (`atualizar-arquivos.js`,
  `atualizar-equipes-online.js`, `atualizar-avancos-online.js`,
  `atualizar-lab-online.js` e os de demandas) — eles reescrevem os CSVs que ele está
  mexendo, e `atualizar-arquivos.js` ainda dá `git push` sozinho;
- **não publicar** (`git push`) até ele confirmar que o Patrick terminou;
- ao publicar, **rebase sobre `origin/master` antes** — o Patrick empurra no mesmo
  master, e nos arquivos compartilhados o que veio de cima ganha. Nunca `--force`.

Lembrete que vale para esta branch enquanto ela existir: `atualizar-arquivos.js`
publica `HEAD:master`, então uma execução agendada com esta branch em checkout
publicaria este trabalho pela metade (incidente de 2026-08-15, registrado no
`CLAUDE.md`).

## Fora de escopo

- Trava de dias mínimos no alerta de movimentação de equipe.
- Fazer o backfill do Link 7 cruzar anos (o limite de 31/12 da Decisão 3).
- Qualquer mudança no dashboard de orçamento.
- As demais regras da seção "Regras de dados" de 2026-08-10.
