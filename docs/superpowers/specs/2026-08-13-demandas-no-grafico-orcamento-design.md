# Demandas no Gráfico do Orçamento — design

Data: 2026-08-13 (revisado no mesmo dia: série trocada de `chegadas` para `pendentes`)

## Contexto

O dashboard ORÇAMENTO (`docs/index.html`, aba "Gráfico") mostra hoje um combo chart —
barras mensais no eixo primário + linha de acumulado tracejada no eixo secundário — para
Previsto/Realizado/Tendência, repetido por dimensão (Equipes/Volume/Financeiro/Produtividade/
Ticket médio). O pedido: trazer também a série "Demandas Pendentes" (o item roxo já usado em
todo o resto do projeto, `#9700DA`), como uma 4ª barra + 4ª linha, **só na dimensão Volume**,
sempre visível (sem checkbox próprio — decidido com o dono do projeto em 2026-08-13).

"Demandas" já existe como conceito maduro na página irmã `planejamento-semanal.html` (aba
Demandas, `tools/semanal/compute-demandas.js`), com 5 séries. Este trabalho porta só
**`pendentes`** — o saldo de demandas em aberto (furos de sondagem + ensaios de laboratório
ainda não executados) no **fim de cada mês**. `chegadas`/`sondagemRealizada`/
`relatorioConcluido`/`canceladas` continuam exclusivas da aba Demandas da página semanal.

**`pendentes` é ESTOQUE, não fluxo — e isso muda a mecânica do painel "Acumulado".** O
próprio `compute-demandas.js` documenta isso com todas as letras: *"'pendentes' é ESTOQUE: o
saldo aberto no fim de cada mês. Somar saldos de meses diferentes daria um número crescente e
sem significado."* `render-aba-demandas.js` (`acumularSerie`) já implementa essa regra na
aba Demandas da semanal: para uma série de estoque, o modo "Acumulado" devolve os MESMOS
valores do modo "Mensal" (`entrada.slice()`), nunca uma soma corrida — diferente de
Previsto/Realizado/Tendência no Gráfico do orçamento, que SOMAM mês a mês no painel
Acumulado.

**Portanto, "demandas mensais" e "demandas acumuladas" neste pedido usam o MESMO array de 12
valores** (o saldo pendente ao fim de cada mês) — a barra do painel Mensal e a linha do
painel Acumulado desenham o mesmo dado, só em geometrias diferentes (barra vs. linha, eixo
primário vs. secundário). Isso segue literalmente a mesma regra que a aba Demandas da
semanal já aplica, e evita reproduzir o número "crescente e sem significado" que o próprio
código do projeto já identificou como armadilha. Se este entendimento não for o que você
tinha em mente (por exemplo, se "acumulado" deveria significar outra coisa, como "pendentes
mais o que já foi executado no ano"), me avise antes da implementação — é o ponto do spec
com maior risco de eu ter lido errado a sua intenção.

**Achado importante desta investigação:** o clone local deste repositório estava 340 commits
atrás de `origin/master` (sem `git fetch`) — a página semanal já tinha evoluído muito além do
que os specs de 2026-07-29 (última leitura anterior) descreviam, inclusive ganhando a aba
Demandas inteira, fontes online (`avancos-online.csv`, `lab-online.csv`,
`demandas-sondagem-online.csv`, `demandas-lab-online.json`) e mais 5 abas. `CLAUDE.md` está
atualizado e é a referência real — os specs de fase 2 de filtros mencionados nele como
pendentes já foram feitos (`6ff1bfc`).

## Fora de escopo

- **Chegadas/Canceladas/Relatório concluído/Sondagem realizada** — este trabalho porta só
  `pendentes` (o saldo em aberto por mês). As outras 4 séries de `computeDemandas` continuam
  exclusivas da aba Demandas da página semanal.
- **Tabela do orçamento** — só o Gráfico ganha a série nova. A Tabela não muda.
- **Financeiro/Equipes/Produtividade/Ticket médio** — Demandas é uma contagem física (furos +
  ensaios), sem equivalente em R$ nem headcount. Aparece só quando a dimensão marcada é
  Volume.
- **planejamento-semanal.html** — não muda. Este trabalho só afeta `docs/index.html`/
  `dist/orcamento-dashboard.html`.
- **Filtro/checkbox para esconder Demandas** — decidido explicitamente: sempre visível
  quando a dimensão Volume está marcada, sem controle próprio.
- **Coluna de fechamento/total do painel** — Previsto/Realizado/Tendência fecham o ano
  somando os 12 meses (painel Mensal) ou terminam em dezembro (painel Acumulado). Demandas,
  sendo estoque, não tem "total do ano" com significado — se o gráfico expõe algum rótulo de
  fechamento por série (a confirmar lendo `construirGraficoMensalSvg`/
  `construirGraficoAcumuladoSvg` por inteiro), Demandas precisa ficar de fora dele ou mostrar
  "Saldo em Dez" em vez de "Total", mesmo cuidado que `rotuloColunaFechamento`
  (`render-aba-demandas.js`) já toma na Tabela de Demandas.

## Pipeline de dados (build, Node)

`tools/orcamento/build-dashboard.js` hoje só lê a MATRIZ + a linha de base. Passa a también
ler as mesmas fontes online que `tools/semanal/build-dashboard.js` já lê (geradas por
`tools/semanal/atualizar-*-online.js`, que continuam rodando do lado do projeto semanal —
este trabalho não cria fetchers novos):

- `dist/avancos-online.csv` (obrigatório — mesmo erro explícito de caminho que o semanal já
  lança se faltar) + `dist/demandas-sondagem-online.csv` (opcional, mesmo aviso).
- `dist/lab-online.csv` (obrigatório) + `dist/demandas-lab-online.json` (opcional).

**Para `pendentes` os dois arquivos "opcionais" importam mais do que importavam para
`chegadas`.** `demandas-sondagem-online.csv`/`demandas-lab-online.json` carregam exatamente
os furos/ensaios AINDA NÃO executados — sem eles, o saldo pendente conta só quem já foi
executado tarde o bastante para aparecer em `avancos-online.csv`/`lab-online.csv` com status
pendente, subestimando o backlog real. O próprio `CLAUDE.md` registra um incidente assim: o
botão "Atualizar dados" da semanal esqueceu de buscar esses dois arquivos por um tempo e
"zerava o backlog a cada clique, com status verde". Mantemos o mesmo tratamento
(opcional + aviso no console, não erro fatal — mesma robustez que o semanal já tem), mas
vale destacar isso na mensagem de aviso do build do orçamento também.

Réplica literal da sequência já provada em `tools/semanal/build-dashboard.js:270-369`:
`parseAvancos`/`parseLab` (reexportados de `tools/semanal/` — não duplicar a leitura de
CSV/JSON), `redirecionarSupsDesconhecidos(furos, registros)` e
`redirecionarSupsDesconhecidos(ensaios, registros)` contra os `registros` da MATRIZ do
orçamento (não os da semanal — os dois pipelines leem a mesma MATRIZ mas por caminhos/parsers
diferentes, então os `registros` não são o mesmo array), e por fim
`computeDemandas(furos, periodos, ensaios)`.

**`computeDemandas` (hoje em `tools/semanal/compute-demandas.js`) muda para
`tools/comum/compute-demandas.js`** — passa a ter 2 consumidores, mesmo critério que já
moveu `xlsx-reader.js`/`linha-base.js`/outros para `tools/comum/` nas Fases A/B do projeto
semanal. `tools/semanal/compute-demandas.js` vira um re-export (ou os `require` em
`tools/semanal/build-dashboard.js`/`render-semanal.js` apontam para o novo caminho) — sem
mudar nenhum comportamento da página semanal.

O orçamento não precisa de `tipologias`/`totais` (agregados por tipologia, que a página
semanal usa) nem dos eventos crus de `porRegistroEventos` — precisa de "saldo pendente ao
fim de cada mês, por (sup, tipologia)", já bucketizado. O bucketing acontece no BUILD (Node),
não no cliente — o Gráfico do orçamento só tem 12 meses fixos do ano do build (mesmos
`periodos` que `parseMatriz`/`renderDashboard` já usam para todo o resto), e o cliente hoje
só tem `MESES_ABREVIADOS` (rótulos fixos) e `window.__VIGENTE_IDX__` — nenhuma data real —
então bucketizar no cliente exigiria embutir o ano, sem necessidade.

Novo helper em `tools/comum/compute-demandas.js`, ao lado de `computeDemandas`:

```js
// Bucketiza o SALDO PENDENTE (estoque, não fluxo) de cada (sup, tipologia)
// nos mesmos 12 meses de 'periodos' -- versão por REGISTRO do que
// 'series.pendentes' já faz por TIPOLOGIA dentro de computeDemandas.
// Reaproveita a MESMA regra de saidaEstoque/pendentes já implementada lá
// (chegou até o fim do mês E ainda não foi executado até o fim do mês) --
// não reimplementar a regra aqui, chamar o mesmo cálculo por registro em
// vez de por tipologia. Validar com um teste que soma este resultado, por
// mês, e compara contra demandas.totais.pendentes (ou o correspondente por
// tipologia) para os mesmos furos/ensaios.
function pendentesMensaisPorRegistro(furos, ensaiosLab, periodos) { ... }
```

Devolve `{ [chaveMatriz(sup,tipologia)]: [12 inteiros] }` — o saldo pendente ao fim de cada
mês, por registro. É ISSO que entra no blob cifrado do orçamento.

## Blob cifrado: de array para objeto

Hoje `renderDashboard` (`tools/orcamento/render-dashboard.js:1865+`) cifra só
`registrosJson = JSON.stringify(registros.map(...))` — um array. Passa a cifrar
`{ registros: [...], demandasPendentesMensais: { [chaveMatriz]: [12 inteiros] } }`, mesmo
espírito de `render-semanal.js` (`window.__DEMANDAS__ = dados && dados.demandas` logo após
decifrar, ao lado de `window.__REGISTROS__ = dados.registros` — hoje o orçamento faz
`window.__REGISTROS__ = JSON.parse(jsonTexto)` direto porque o payload é só o array; muda
para `JSON.parse(jsonTexto).registros`, com `window.__DEMANDAS_MENSAIS__ =
JSON.parse(jsonTexto).demandasPendentesMensais` ao lado).

**Isso muda o formato do golden usado por `test/orcamento-html-inalterado.test.js`** (diff
byte-a-byte contra `dist/orcamento-dashboard.html`) — não há como fazer essa mudança sem
alterar o HTML gerado, então o golden precisa ser regenerado deliberadamente como parte
desta entrega, não é uma regressão a evitar. Mesma coisa para
`test/fixtures/orcamento-golden.html` e os testes que constroem o dashboard fictício
(`orcamento-build-dashboard.test.js`, `orcamento-render-dashboard.test.js`).

`tentarDesbloquear` e `atualizarDadosAoVivo` (os dois pontos que hoje setam
`window.__REGISTROS__`, ver `docs/superpowers/specs/2026-07-27-alertas-tendencia-e-filtros-design.md`
Seção A) passam a setar `window.__DEMANDAS_MENSAIS__` também. O botão "Atualizar dados ao
vivo" do orçamento hoje só busca a Sheet espelho da MATRIZ — como a fonte de Demandas é
CSV/JSON publicado (não a MATRIZ), **o live-refresh não atualiza Demandas** nesta v1: mantém
`window.__DEMANDAS_MENSAIS__` como veio do build, do mesmo jeito que a semanal preserva
`window.__DEMANDAS__` quando as URLs de espelho ainda não existem. Ficaria para uma rodada
futura se isso incomodar.

## Cálculo cliente (dentro de `SCRIPT_CLIENTE_TABELA`)

Sem cálculo de data nenhum no cliente — o build já entrega `window.__DEMANDAS_MENSAIS__`
como `{ chave: [12 inteiros] }`, já sendo o saldo pendente por mês. Nova função, ao lado de
`mensalBruto`/`calcularAcumulado` em `construirPainelGraficoHtml`, soma os arrays das chaves
que passam no filtro atual:

```js
function demandasPendentesMensaisPorIndices(indices, registros, demandasMensais) {
  var mensal = new Array(12).fill(0);
  if (!demandasMensais) return mensal;
  indices.forEach(function (idx) {
    var registro = registros[idx];
    var chave = registro.sup + '||' + registro.tipologia; // mesma chave de chaveMatriz
    var porMes = demandasMensais[chave];
    if (!porMes) return;
    for (var i = 0; i < 12; i++) mensal[i] += porMes[i] || 0;
  });
  return mensal;
}
```

**Somar o saldo pendente de vários registros no mesmo mês é uma soma válida** (o saldo total
do recorte filtrado é a soma dos saldos individuais em um instante — diferente de somar o
MESMO registro em MESES diferentes, que não faria sentido). A armadilha documentada em
`compute-demandas.js` é a segunda, não a primeira.

(`chaveMatriz` já é `${sup}||${tipologia}` — `tools/comum/linha-base.js:56-58` — client-side
usa a mesma concatenação, sem importar o módulo, mesmo padrão que `render-semanal.js` já
segue para código embutido no bundle.)

**Filtro:** usa os MESMOS `indices` que a Tabela/Gráfico já calculam
(`indicesFiltrados(registros, filtroTipologia, filtroCategoria, filtroGrupo, filtroSup,
filtroOrigem)`) — tipologia/grupo/SUP/origem/categoria recortam Demandas igual às outras 3
séries. `filtro-serie` (Previsto Inicial/Previsto/Realizado/Total) NÃO afeta Demandas —
decidido: sempre visível quando a dimensão é Volume.

**"Acumulado" NÃO soma.** Diferente de Previsto/Realizado/Tendência (que usam
`calcularAcumulado`, soma corrida), Demandas usa o MESMO array `mensal` também como
`acumulado` — nenhuma soma corrida, mesma regra que `acumularSerie(valores, true)` já aplica
na aba Demandas da semanal. Ver "Contexto" acima para a justificativa completa.

## Onde entra no gráfico

Em `construirPainelGraficoHtml` (`tools/orcamento/render-dashboard.js:784+`), quando
`dimensao === 'volume'`, `dadosPorSerie` ganha uma 5ª entrada além das 4 de
`ORDEM_SERIES_GRAFICO`:

```js
var demandasMensal = demandasPendentesMensaisPorIndices(indices, registros, window.__DEMANDAS_MENSAIS__);
// acumulado === mensal, de propósito -- estoque não soma (ver "Contexto").
{ serie: 'demandas', mensal: demandasMensal, acumulado: demandasMensal, indiceConector: null }
```

- `SERIE_LABELS.demandas = 'Demandas Pendentes'` (nome já estabelecido no resto do projeto —
  ver "Demandas Pendentes" na Tabela Semanal), `SERIE_COR.demandas = '#9700DA'` — mesmo hex
  já estabelecido como "cor padrão de Demandas no dashboard inteiro" (ver
  `.linha-pendentes-demandas`/`.linha-demandas` em `tools/comum/render-shell.js` e
  `tools/semanal/render-aba-demandas.js`). **Não confundir com `realizadoPrevistoInicial`
  (`#a78bfa`, lavanda)** — cor diferente, série diferente, ambas "arroxeadas" mas
  distinguíveis lado a lado.
- Barra roxa no painel Mensal (eixo primário, junto de Previsto/Realizado/Tendência), linha
  roxa no painel Acumulado (eixo secundário) — mesmas funções
  `construirGraficoMensalSvg`/`construirGraficoAcumuladoSvg` (`render-dashboard.js:727,755`),
  sem mudança de assinatura: as duas já iteram `dadosPorSerie` genericamente por `serie`/
  `mensal`/`acumulado`, então uma 5ª entrada só funciona se `SERIE_LABELS`/`SERIE_COR`
  tiverem a chave `demandas` — não deveria exigir mudar o corpo das duas funções, mas
  confirmar ao implementar (ver "Riscos").
- Legenda: aparece como "Demandas Pendentes" (bolinha roxa) só no painel de Volume, ao lado
  de Previsto/Realizado/Tendência — a legenda já lê `seriesVisiveis`/seus rótulos
  dinamicamente; Demandas entra na lista só quando `dimensao === 'volume'`, fora do
  `ORDEM_SERIES_GRAFICO` normal (que vale para as outras 4 dimensões).
- Tooltip: mesmo mecanismo de `data-tooltip` já usado pelas outras séries
  (`MESES_ABREVIADOS[mes] + ' · ' + SERIE_LABELS[d.serie] + ...`) — funciona sem mudança
  desde que `demandas` entre em `dadosPorSerie` com o mesmo formato `{serie, mensal,
  acumulado, indiceConector}`.
- **Escala do eixo secundário (painel Acumulado):** hoje auto-escala pelo MAIOR acumulado
  visível entre as séries, "tipicamente bem maior que o eixo primário" porque
  Previsto/Realizado/Tendência somam 12 meses. Demandas, sem somar, fica na mesma ordem de
  grandeza do saldo mensal (tipicamente MENOR que o acumulado de Volume em dezembro) — a
  linha roxa deve aparecer achatada perto da base do eixo secundário na maioria dos casos, o
  que é o comportamento correto (reflete a diferença real de grandeza), não um bug de escala.
  Vale confirmar visualmente com dado real antes de fechar, mas não é motivo para dar
  escala própria a Demandas nesta v1 (o pedido original não menciona isso, e as 4 dimensões
  de soma já compartilham eixo entre si sem escala própria por série).

## Riscos

**Toca no dashboard publicado.** Mesma disciplina de sempre: reconstruir com senha fictícia
e comparar contra o HTML anterior — mas desta vez o diff **não** é esperado ficar idêntico
(o formato do blob cifrado muda, e o Gráfico de Volume ganha uma série nova). A verificação
correta aqui é: (a) as dimensões Equipes/Financeiro/Produtividade/Ticket médio ficam
byte-a-byte idênticas (nenhuma delas toca em Demandas); (b) Tabela e Alertas ficam
byte-a-byte idênticas; (c) só o painel de Volume do Gráfico muda, de forma prevista.

**`construirGraficoMensalSvg`/`construirGraficoAcumuladoSvg` podem ter alguma suposição de
"sempre 4 séries"** (por exemplo, layout de legenda, largura de coluna por série, cor
default para série desconhecida) não capturada nesta investigação de spec — confirmar lendo
o corpo das duas funções por inteiro antes de implementar, não só a interface via
`dadosPorSerie`.

**Uma série de estoque dentro de um painel que hoje só conhece séries de fluxo** é a maior
mudança conceitual deste spec. Qualquer lógica que hoje assuma "toda série do painel
Acumulado é uma soma corrida crescente" (por exemplo, para decidir onde desenhar rótulo de
"Total do ano", ou para decidir a direção/monotonicidade de algo) precisa ser auditada —
Demandas pode CAIR mês a mês (saldo diminuindo), o que as outras 3 séries acumuladas nunca
fazem hoje.

**O live-refresh não atualiza Demandas** (ver seção do blob cifrado) — um usuário que clicar
"Atualizar dados ao vivo" depois do saldo pendente mudar no `avancos-online.csv`/
`demandas-*-online.*` continuará vendo o Gráfico de Volume com Demandas do build anterior,
enquanto Previsto/Realizado/Tendência já mostram o dado novo da MATRIZ. Aceito nesta v1;
documentar na tela não está no escopo pedido, mas vale considerar um aviso textual pequeno
se o dono do projeto achar confuso na prática.

**Dependência de build cruzada:** o build do orçamento passa a exigir os mesmos 4 arquivos
online que hoje só o build da semanal produz (`atualizar-avancos-online.js` etc.) — se
alguém rodar só o build do orçamento numa máquina nova sem nunca ter rodado os fetchers da
semanal, o build falha com o mesmo erro explícito de caminho que a semanal já usa (não um
ENOENT cru). Documentar em `CLAUDE.md` do orçamento que o build agora depende dessas 4
buscas, com o mesmo comando de sempre.

## Testes

- **`computeDemandas` movida para `tools/comum/`**: os testes existentes
  (`test/semanal-compute-demandas.test.js`) continuam passando sem alteração de
  comportamento — só o caminho do `require` muda.
- **`pendentesMensaisPorRegistro` (build, Node)**: soma de todas as chaves, por mês, bate com
  `demandas.totais.pendentes[mes]` que `computeDemandas` já produziria para os mesmos
  furos/ensaios (prova de que o bucketing por registro reproduz a mesma regra de estoque, só
  quebrada por SUP em vez de só por tipologia); saldo pode cair de um mês para o outro
  (não é uma sequência não-decrescente); chave sem nenhum evento devolve 12 zeros (ou não
  aparece no objeto — decidir na implementação, documentar o escolhido, e cobrir o caso "sem
  entrada" em `demandasPendentesMensaisPorIndices` de qualquer forma).
- **Novo teste de unidade cliente** (`demandasPendentesMensaisPorIndices`, extraído via
  `extrairFuncoesPuras` como o resto do script cliente do orçamento já é testado): soma
  correta das chaves que passam no filtro; registros fora dos `indices` filtrados não
  contam; sem `window.__DEMANDAS_MENSAIS__` devolve 12 zeros (não lança); saldo decrescente
  entre meses consecutivos não quebra nada a jusante.
- **`dadosPorSerie` com Demandas**: dimensão Volume inclui a 5ª entrada com `mensal` correto
  e `acumulado === mensal` (mesma referência ou mesmo conteúdo — travar isso explicitamente
  para não regredir para `calcularAcumulado` por engano numa refatoração futura); as outras
  4 dimensões NÃO incluem Demandas (array de 4 entradas, não 5).
- **Regenerar goldens** (`test/fixtures/orcamento-golden.html`,
  `dist/orcamento-dashboard.html` de referência do `test/orcamento-html-inalterado.test.js`)
  com uma senha fictícia e fixtures sintéticas de `avancos-online.csv`/`lab-online.csv` —
  mesma técnica que os testes de build da semanal já usam para não depender de
  `G:\`/Chrome.
- **Build falha com mensagem clara** se `dist/avancos-online.csv`/`dist/lab-online.csv`
  não existirem (obrigatórios) — mesmo padrão de erro explícito que
  `tools/semanal/build-dashboard.js` já usa, testável sem os arquivos reais presentes.
- **Legenda/cor**: `SERIE_COR.demandas === '#9700DA'`, distinto de
  `SERIE_COR.realizadoPrevistoInicial`.
