# Demandas no Gráfico do Planejamento Semanal — design

Data: 2026-08-14

## Contexto

O dashboard de ORÇAMENTO ganhou, em 2026-08-13, a série "Demandas" na aba Gráfico
(spec `2026-08-13-demandas-no-grafico-orcamento-design.md`, implementada em
`de7cac9..9fb8cc8` + `e428fad`/`2abdc45`). O pedido desta rodada: **fazer o mesmo na
aba Gráficos do Planejamento Semanal**.

O que o orçamento entregou, e que este trabalho porta:

- Série **`chegadas`** (quantos itens de demanda — furos de sondagem + ensaios de
  laboratório — CHEGARAM no período), roxa `#9700DA`.
- Barra no painel de fluxo + linha no painel Acumulado.
- **Só na dimensão Volume**, sempre visível, sem checkbox próprio.
- Acumulado nascendo de um **saldo de abertura**, não de zero.

A escolha de `chegadas` (fluxo) em vez de `pendentes` (estoque) foi validada no
orçamento contra a página 2 do Power BI "SUPORTE SOLOS" — o "Solicitados" de lá é
estruturalmente `chegadas` + soma corrida, sem nenhuma linha de estoque. **Não
reabrir essa investigação**: ver "Histórico da decisão" no spec do orçamento.

## Duas decisões do dono do projeto (2026-08-14)

Nas duas, foi perguntado se a semanal deveria seguir a coerência LOCAL do painel
(as outras 3 séries) ou espelhar o ORÇAMENTO. Ele escolheu espelhar o orçamento nas
duas — registrado aqui porque as duas escolhas contrariam o comportamento vizinho e
uma revisão futura tenderia a "corrigi-las":

1. **O Acumulado de Demandas nasce do saldo de abertura do mês**, não de zero — ao
   contrário de Previsto/Realizado/Tendência, que todas nascem em zero na S1 do mesmo
   painel.
2. **A linha de Demandas NÃO morre na semana em curso** — desenha o mês inteiro, com
   `calcularAcumulado` puro, ao contrário do Realizado (que é cortado por
   `cortarAcumuladoNasElapsadas`).

A consequência visual da nº 2 é conhecida e aceita: nas semanas futuras não há
chegadas, então a curva achata numa reta horizontal. É exatamente o efeito que
`cortarAcumuladoNasElapsadas` foi criada para evitar no Realizado. **Não "corrigir"
isso numa revisão de design sem perguntar** — é uma escolha explícita, pelo mesmo
motivo que o anel do `.status-circulo` está documentado como intocável no `CLAUDE.md`.

## Por que o saldo de abertura importa MAIS aqui que no orçamento

No orçamento, o saldo de abertura (`saldoAberturaPorRegistro`, corte em 31/12 do ano
anterior) existe porque a janela do gráfico é o ANO, e uma carteira que veio de antes
dele faria "Demandas acumulado" aparecer ABAIXO de "Realizado acumulado" — o que se lê
como impossível (não dá para executar mais do que chegou). Medido ao vivo em
2026-08-13, filtrando SUP-8370-25 (Rota Sorocabana): **1.344 dos 2.438 furos executados
em 2026 (55%) tinham "Criação da OS" em 2025 ou antes**.

Aqui a janela é **um mês**. Praticamente toda demanda executada dentro de um mês chegou
antes dele. Sem o saldo de abertura a curva de Demandas ficaria quase sempre abaixo da
de Realizado — o defeito que o orçamento corrigiu, amplificado pela janela mais curta.

## Escopo

Só a **aba Gráficos** (`tools/semanal/render-aba-grafico-semanal.js`), dimensão Volume,
nos dois painéis (Semanal e Acumulado no mês).

### Fora de escopo

- **Aba Balanço de massa** — já tem uma dimensão "Demandas" própria, com outra pergunta
  (chegou × previsto de volume, por tipologia). Não se mistura com esta série.
- **Aba Demandas** — já mostra as 5 séries de `computeDemandas`, mensal/acumulado. Não muda.
- **Tabela Semanal** — já tem a linha "Demandas Pendentes" (estoque, outra série). Não muda.
- **Dimensões Equipes e Financeiro** — Demandas é contagem física (furos + ensaios), sem
  equivalente em headcount nem em R$. Mesma regra do orçamento.
- **As outras 4 séries de `computeDemandas`** (`pendentes`, `sondagemRealizada`,
  `relatorioConcluido`, `canceladas`) — continuam exclusivas da aba Demandas.
- **Filtro/checkbox para esconder Demandas** — sempre visível quando Volume está marcada.
  A aba Gráficos não tem filtro de série nenhum hoje, e não ganha um.
- **Build, blob cifrado, goldens** — ver a seção seguinte: nada disso é tocado.

## Por que aqui NÃO há mudança de build (a diferença central em relação ao orçamento)

O orçamento pagou caro por três coisas que **não se repetem** nesta página:

| No orçamento | Na semanal |
|---|---|
| O build não lia as fontes online — passou a ler 4 arquivos | `tools/semanal/build-dashboard.js` **já** lê as 4 |
| O blob cifrado virou de array para objeto; golden byte-a-byte regenerado | O blob **já** carrega `demandas` (`window.__DEMANDAS__`) |
| O cliente não tinha data nenhuma → bucketing teve que ir pro build | O cliente **já** tem os eventos crus com data |

O terceiro item é o que decide o desenho. `demandas.porRegistroEventos[chave].chegada`
é um **array de dia-epoch**, já disponível no cliente — é a mesma estrutura que
`pendentesNaData` (`render-aba-semanal.js:157`) percorre hoje para a linha "Demandas
Pendentes" da Tabela Semanal. E `semanas[]` já traz `inicio`/`fim` em dia-epoch
(`compute-semanal.js:160`).

Logo: **todo o cálculo desta série acontece no cliente**, dentro do módulo da aba
Gráficos. Nenhum arquivo de build, nenhum `require` novo em `build-dashboard.js`,
nenhuma fixture de build, nenhum golden regenerado. É o motivo pelo qual esta rodada é
substancialmente menor que a do orçamento.

## Peça 1 — `chegadasSemanaisPorIndices` (função nova)

Em `render-aba-grafico-semanal.js`, ao lado das outras funções puras do módulo.
Bucketiza as chegadas dos registros filtrados nas N semanas do mês:

```js
// Chegadas de demanda (evento 'chegada' de porRegistroEventos -- Criação da
// OS do furo, Criação do ensaio de Lab) por SEMANA, através dos registros em
// 'indices'. É a versão semanal do que chegadasMensaisPorRegistro
// (compute-demandas.js) faz por mês no build do orçamento -- aqui roda no
// CLIENTE porque os eventos crus, com data, já chegam nele.
function chegadasSemanaisPorIndices(registros, indices, demandas, semanas) { ... }
```

Devolve `number[]` de tamanho `semanas.length`.

- Chave: `chaveDemandas(registro.sup, registro.tipologia)` — a MESMA que
  `pendentesNaData` já usa. **`chaveDemandas` NÃO é exportada**, e isso é deliberado:
  ela é duplicada em cada módulo que entra no bundle do navegador (hoje em
  `render-aba-semanal.js:71` e `compute-balanco.js:182`), porque
  `browser-bundle.js` REMOVE as dependências externas em vez de reescrevê-las.
  `render-aba-grafico-semanal.js` já segue essa convenção com
  `DIMENSOES_ROTULO_SEMANAL` ("duplicado de propósito", linha 65) — então **copie
  as 3 linhas de `chaveDemandas` para este módulo, com o mesmo comentário
  explicando por quê**. Importá-la seria o erro.
- Registro sem entrada em `porRegistroEventos` contribui zero (não lança).
- Evento fora das N semanas do mês exibido não entra em nenhuma delas.
- Semana sem chegada nenhuma é **0**, não `null` — é uma contagem medida, e zero
  chegadas é informação, não ausência de dado. (Contraste com `semanasTendencia`,
  que usa `null` de propósito para "não se projeta aqui".)

**Filtro:** usa os MESMOS `indices` que os outros 3 painéis já recebem, então
tipologia/grupo/SUP/origem/categoria recortam Demandas igual às outras séries.

## Peça 2 — saldo de abertura do mês (função JÁ EXISTENTE)

Não precisa de código novo: `pendentesNaData(registros, indices, demandas, dataEpoch)`
(`render-aba-semanal.js:157`, já exportada) é exatamente o equivalente semanal de
`saldoAberturaPorRegistro`. Ela conta `chegada <= D` menos `saidaEstoque <= D` — a
regra de estoque numa data que a regra 2 de "Regras de dados" do `CLAUDE.md` fixa.

`render-aba-grafico-semanal.js` já faz
`require('./render-aba-semanal.js')` na forma que o `browser-bundle.js` reconhece —
basta acrescentar `pendentesNaData` ao destructure existente.

### O off-by-one que duplica a demanda se passar batido

**O corte é `semanas[0].inicio - 1`, NÃO `semanas[0].inicio`.**

`pendentesNaData` conta `chegada <= dataEpoch` (inclusive). Se o corte fosse
`semanas[0].inicio`, uma demanda que chegou no primeiro dia do mês entraria no saldo de
abertura **e** em `chegadasSemanais[0]` — contada duas vezes, inflando o Acumulado em
silêncio, sem erro nem aviso.

É o mesmo cuidado que o orçamento tomou: lá o corte é `31/12 23:59:59` do ano anterior,
e `chegadasMensaisPorRegistro` bucketiza a partir de janeiro — sem sobreposição. A
diferença é que lá o instante anterior é explícito no `Date`, e aqui a unidade é o
dia-epoch inteiro, então o `- 1` é a forma de dizer "o último dia antes do mês".

**Teste obrigatório:** uma demanda com `chegada` exatamente em `semanas[0].inicio`
aparece em `chegadasSemanais[0]` e **não** no saldo de abertura. Sem esse teste o bug
passa — a soma continua "parecendo certa" para qualquer fixture cuja demanda não caia
justamente no dia 1.

## Peça 3 — a 4ª entrada no gráfico

Em `construirPainelGraficoSemanalHtml` (`render-aba-grafico-semanal.js:331`).

`dadosPorSerie` já é genérico (`{ serie, valores, acumulado, indiceConector }`) e as
funções de SVG (`construirColunasSvg`, `construirLinhasSvg`, `construirLegendaSvg`)
iteram por ele resolvendo cor/rótulo/tracejado pelos mapas — uma 4ª entrada funciona
sem mudar a assinatura de nenhuma delas, desde que os três mapas ganhem a chave.

```js
SERIE_COR.demandas      = '#9700DA';
SERIE_LABELS.demandas   = 'Demandas';
SERIE_TRACEJADO.demandas = '4,3';   // distinto de realizado ('1,5') e tendencia ('9,5')
```

`#9700DA` é o roxo já estabelecido como cor de Demandas no projeto inteiro
(`.linha-pendentes-demandas`/`.linha-demandas`, `tools/comum/render-shell.js` e
`render-aba-demandas.js`). **Não confundir com `#a78bfa`** (lavanda,
`realizadoPrevistoInicial` do orçamento) — outra série, outra cor.

A entrada só é acrescentada quando `dimensao === 'volume'`:

```js
var chegadasSemanais = chegadasSemanaisPorIndices(registros, indices, demandas, semanas);
var aberturaDemandas = pendentesNaData(registros, indices, demandas, semanas[0].inicio - 1);
{
  serie: 'demandas',
  valores: chegadasSemanais,
  acumulado: calcularAcumulado(chegadasSemanais).map(function (v) { return v + aberturaDemandas; }),
  indiceConector: null,
}
```

- **Painel Semanal (barras):** o saldo de abertura NÃO entra — é fluxo por semana, e
  somar um estoque a cada barra não teria leitura nenhuma. Só o Acumulado o usa.
- **`indiceConector: null`** — só a Tendência tem ponto de junção.
- **Acumulado sem corte**, por decisão nº 2 acima: `calcularAcumulado` puro, sem passar
  por `cortarAcumuladoNasElapsadas`.
- A série só existe quando há `demandas` (`temSemanasReais`/`temDemandas` já governa
  isso para Realizado/Tendência) — sem `demandas`, o painel volta às 3 séries de sempre.

### Efeito colateral esperado na largura das barras

`construirColunasSvg` calcula `larguraColuna` a partir de `numSeries`
(`render-aba-grafico-semanal.js:205`). No painel de Volume passam a ser 4 séries em vez
de 3, então **as barras de Volume ficam mais estreitas que as de Equipes/Financeiro**.
Não é defeito, e não pede tratamento: é a mesma mecânica que o orçamento já vive com
5 séries no Gráfico. Só está registrado aqui para não virar "achado" numa revisão.

## Riscos

**Toca a página publicada.** `dist/planejamento-semanal.html` + a cópia obrigatória para
`docs/` (travada por `test/publicacao-docs-sincronizado.test.js`). A verificação correta
é: Equipes e Financeiro ficam byte-a-byte idênticos nos dois painéis; Tabela Semanal,
Balanço, Demandas, Alertas, Consolidado e Alocação ficam byte-a-byte idênticos; **só o
bloco de Volume da aba Gráficos muda**.

**A crase solta.** Qualquer crase não escapada dentro de `SCRIPT_CLIENTE_SEMANAL`/
`CSS_SEMANAL` trunca o script do cliente inteiro, em silêncio, e o sintoma aparece longe
(`montarDashboard is not defined`). Este trabalho mexe em módulo bundlado, não nos
template literals — mas se esse erro aparecer, é o primeiro lugar a olhar.

**`core.autocrlf=true` sem `.gitattributes`.** Nunca fazer `checkout`/`restore` de
`dist/` ou `docs/` isoladamente — regenerar os dois com o build e copiar de novo.

**O botão "Atualizar dados" cobre esta série?** `atualizarDadosAoVivoSemanal` recalcula
`window.__DEMANDAS__` a partir dos 4 arquivos publicados (corrigido em 2026-08-10 —
antes ele zerava o backlog em silêncio). Como esta série lê `porRegistroEventos` do
mesmo objeto, **ela acompanha o refresh sem trabalho adicional** — ao contrário do
orçamento, onde o live-refresh não atualiza Demandas nesta v1. Confirmar na verificação
final, não assumir.

**Não escrever campo novo em `demandasNovas` dentro de `atualizarDadosAoVivoSemanal`.**
Este trabalho não precisa disso, mas se alguém achar que precisa: o objeto é
REATRIBUÍDO no meio da função, e escrever logo após o fetch deixa o valor órfão (foi o
bug `88f137b`). Escrever por último.

## Testes

`test/semanal-render-aba-grafico-semanal.test.js` já existe e é onde tudo isto entra.

- **`chegadasSemanaisPorIndices`**: bucketiza nas semanas certas; respeita `indices`
  (registro fora do filtro não conta); chave sem entrada em `porRegistroEventos`
  devolve zeros sem lançar; evento fora do mês exibido não entra em nenhuma semana;
  semana sem chegada é `0`, não `null`.
- **A fronteira do saldo de abertura** (ver "O off-by-one" acima): demanda chegando
  exatamente em `semanas[0].inicio` conta na S1 e não na abertura; demanda chegando no
  dia anterior conta na abertura e em nenhuma semana. **É o teste que justifica a
  seção — não deixar de fora.**
- **Invariante de soma**: `acumulado[N-1]` = abertura + soma de todas as chegadas do
  mês; o acumulado é monotônico não-decrescente (chegadas nunca são negativas).
- **`dadosPorSerie`**: Volume tem 4 entradas com `serie: 'demandas'` presente; Equipes e
  Financeiro têm 3, sem ela; sem `demandas` no `opcoes`, Volume volta a 3.
- **Cor e rótulo**: `SERIE_COR.demandas === '#9700DA'`; `SERIE_LABELS.demandas`
  aparece na legenda do painel de Volume.
- **Sem corte**: o acumulado de Demandas nas semanas futuras repete o último valor
  (achatamento), NÃO vira `null` — trava a decisão nº 2 contra uma "correção" futura.

**Cuidado com o DOM falso:** `test/helpers/dom-falso-semanal.js` devolve `[]` em
`querySelectorAll` para quase tudo. Teste que dependa de consultar o SVG montado passa
VAZIO contra ele. Estes testes devem exercitar as funções puras e o HTML/SVG como
string, não o DOM.

## Publicação

Regra permanente do repositório: reconstruir, `cp dist/planejamento-semanal.html
docs/planejamento-semanal.html`, commitar os dois juntos e `git push` — sem perguntar de
novo. **Nada é publicado antes das revisões passarem.**

Atenção ao `origin/master`: ele tem uma segunda frente ativa (atualizações diárias
automáticas de dados). Rebase antes de publicar; o upstream ganha nos arquivos de dados
compartilhados; nunca `--force`.
