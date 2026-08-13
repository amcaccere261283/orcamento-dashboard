# Demandas no Gráfico do Orçamento — design

Data: 2026-08-13 (revisado duas vezes no mesmo dia — ver "Histórico da decisão" no fim)

## Contexto

O dashboard ORÇAMENTO (`docs/index.html`, aba "Gráfico") mostra hoje um combo chart —
barras mensais no eixo primário + linha de acumulado tracejada no eixo secundário — para
Previsto/Realizado/Tendência, repetido por dimensão (Equipes/Volume/Financeiro/Produtividade/
Ticket médio). O pedido: trazer também a série "Demandas" (o item roxo já usado em todo o
resto do projeto, `#9700DA`), como uma 4ª barra + 4ª linha, **só na dimensão Volume**, sempre
visível (sem checkbox próprio — decidido com o dono do projeto em 2026-08-13).

**A série é `chegadas`**, de `tools/semanal/compute-demandas.js`: quantos itens de demanda
(furos de sondagem + ensaios de laboratório) chegaram em cada mês. É um FLUXO — o painel
Mensal mostra o valor de cada mês, o painel Acumulado mostra a soma corrida (mesma mecânica
que Previsto/Realizado/Tendência já usam via `calcularAcumulado`). `pendentes` (estoque,
saldo em aberto no fim de cada mês) e as outras 3 séries de `computeDemandas`
(`sondagemRealizada`/`relatorioConcluido`/`canceladas`) continuam exclusivas da aba Demandas
da página semanal.

### Validação: comparação com o BI de referência (Power BI "SUPORTE SOLOS")

Esta decisão passou por uma correção e uma reversão no mesmo dia — vale registrar o porquê,
para não repetir a mesma dúvida numa sessão futura. O dono do projeto pediu, a princípio,
`chegadas`; depois pediu para trocar para `pendentes` ("saldo ao final de cada mês"); depois,
para resolver a ambiguidade entre as duas leituras, comparamos contra a página 2
("Curva S Consolidada") do relatório Power BI público da empresa, filtrando o contrato **Via
Araucária S.A** e o ano **2026** — o mesmo relatório que a Sondagem usa para acompanhar
demanda por contrato.

O gráfico "Sondagens Executadas, Planejadas e Solicitadas" de lá tem exatamente o padrão que
este spec porta: 3 barras mensais (Executado/Planejado/**Solicitados**) + 3 linhas de
acumulado (Executado Acumulado/Planejado Acumulado/**Solicitado Acumulado**). Medido ao vivo:
"Solicitado Acumulado" cresce mês a mês de forma monotônica (6.027 em jan/2026 → 6.980 →
7.133 → 7.456 → 7.812 → 8.275 → 8.435 → 8.437 em jul/ago, achatando depois porque não há
"solicitado" pra meses ainda não vividos) — **isso só é possível como soma corrida de um
fluxo**, exatamente `calcularAcumulado` de `chegadas`. Não existe, naquele relatório, nenhuma
linha de estoque/saldo pendente — "Solicitados" no BI é conceitualmente `chegadas`, não
`pendentes`. Confirmado explicitamente com o dono do projeto depois dessa comparação: usar
`chegadas`.

**Portanto, a mecânica é a mesma dos outros 3 painéis do Gráfico do orçamento**: mensal = o
valor de cada mês; acumulado = soma corrida (`calcularAcumulado`, já existe, reaproveitada
sem mudança). Nenhuma regra especial de "estoque não acumula" se aplica aqui — essa regra
(documentada em `compute-demandas.js` e usada por `acumularSerie` em
`render-aba-demandas.js`) vale para `pendentes`, que está fora do escopo deste trabalho.

**Achado importante desta investigação (do início do dia):** o clone local deste repositório
estava 340 commits atrás de `origin/master` (sem `git fetch`) — a página semanal já tinha
evoluído muito além do que os specs de 2026-07-29 (última leitura anterior) descreviam,
inclusive ganhando a aba Demandas inteira, fontes online (`avancos-online.csv`,
`lab-online.csv`, `demandas-sondagem-online.csv`, `demandas-lab-online.json`) e mais 5 abas.
`CLAUDE.md` está atualizado e é a referência real.

## Fora de escopo

- **Pendentes/Canceladas/Relatório concluído/Sondagem realizada** — este trabalho porta só
  `chegadas` (a série que responde "quantas demandas chegaram por mês"). As outras 4 séries
  de `computeDemandas` continuam exclusivas da aba Demandas da página semanal.
- **Tabela do orçamento** — só o Gráfico ganha a série nova. A Tabela não muda.
- **Financeiro/Equipes/Produtividade/Ticket médio** — Demandas é uma contagem física (furos +
  ensaios), sem equivalente em R$ nem headcount. Aparece só quando a dimensão marcada é
  Volume.
- **planejamento-semanal.html** — não muda. Este trabalho só afeta `docs/index.html`/
  `dist/orcamento-dashboard.html`.
- **Filtro/checkbox para esconder Demandas** — decidido explicitamente: sempre visível
  quando a dimensão Volume está marcada, sem controle próprio.

## Pipeline de dados (build, Node)

`tools/orcamento/build-dashboard.js` hoje só lê a MATRIZ + a linha de base. Passa a também
ler as mesmas fontes online que `tools/semanal/build-dashboard.js` já lê (geradas por
`tools/semanal/atualizar-*-online.js`, que continuam rodando do lado do projeto semanal —
este trabalho não cria fetchers novos):

- `dist/avancos-online.csv` (obrigatório — mesmo erro explícito de caminho que o semanal já
  lança se faltar) + `dist/demandas-sondagem-online.csv` (opcional, mesmo aviso — furos ainda
  não executados também têm data de chegada, então também contam pra `chegadas` de meses
  passados/correntes que ainda estão em aberto).
- `dist/lab-online.csv` (obrigatório) + `dist/demandas-lab-online.json` (opcional).

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
semanal usa) nem dos eventos crus de `porRegistroEventos` — precisa de "chegadas por mês, por
(sup, tipologia)", já bucketizado. O bucketing acontece no BUILD (Node), não no cliente — o
Gráfico do orçamento só tem 12 meses fixos do ano do build (mesmos `periodos` que
`parseMatriz`/`renderDashboard` já usam para todo o resto), e o cliente hoje só tem
`MESES_ABREVIADOS` (rótulos fixos) e `window.__VIGENTE_IDX__` — nenhuma data real — então
bucketizar no cliente exigiria embutir o ano, sem necessidade.

Novo helper em `tools/comum/compute-demandas.js`, ao lado de `computeDemandas`:

```js
// Bucketiza os eventos 'chegada' de cada (sup, tipologia) nos mesmos 12
// meses de 'periodos' -- versão por REGISTRO do que 'series.chegadas' já
// faz por TIPOLOGIA dentro de computeDemandas. Reaproveita indiceDoMes
// (já definida acima no módulo); roda sobre os MESMOS furos/ensaiosLab,
// então tem que ver exatamente os mesmos eventos que
// porRegistroEventos[chave].chegada já contaria -- validar com um teste
// que soma este resultado, por mês, e compara contra demandas.totais.chegadas
// (ou o correspondente por tipologia) para os mesmos furos/ensaios.
function chegadasMensaisPorRegistro(furos, ensaiosLab, periodos) { ... }
```

Devolve `{ [chaveMatriz(sup,tipologia)]: [12 inteiros] }`. É ISSO que entra no blob cifrado
do orçamento — não `porRegistroEventos` inteiro (que carrega listas de eventos crus,
desnecessárias aqui e mais pesadas que 12 inteiros por chave).

## Blob cifrado: de array para objeto

Hoje `renderDashboard` (`tools/orcamento/render-dashboard.js:1865+`) cifra só
`registrosJson = JSON.stringify(registros.map(...))` — um array. Passa a cifrar
`{ registros: [...], demandasChegadasMensais: { [chaveMatriz]: [12 inteiros] } }`, mesmo
espírito de `render-semanal.js` (`window.__DEMANDAS__ = dados && dados.demandas` logo após
decifrar, ao lado de `window.__REGISTROS__ = dados.registros` — hoje o orçamento faz
`window.__REGISTROS__ = JSON.parse(jsonTexto)` direto porque o payload é só o array; muda
para `JSON.parse(jsonTexto).registros`, com `window.__DEMANDAS_MENSAIS__ =
JSON.parse(jsonTexto).demandasChegadasMensais` ao lado).

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
como `{ chave: [12 inteiros] }`, já sendo a quantidade de chegadas por mês. Nova função, ao
lado de `mensalBruto`/`calcularAcumulado` em `construirPainelGraficoHtml`, soma os arrays das
chaves que passam no filtro atual:

```js
function demandasMensaisPorIndices(indices, registros, demandasMensais) {
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

(`chaveMatriz` já é `${sup}||${tipologia}` — `tools/comum/linha-base.js:56-58` — client-side
usa a mesma concatenação, sem importar o módulo, mesmo padrão que `render-semanal.js` já
segue para código embutido no bundle.)

**Filtro:** usa os MESMOS `indices` que a Tabela/Gráfico já calculam
(`indicesFiltrados(registros, filtroTipologia, filtroCategoria, filtroGrupo, filtroSup,
filtroOrigem)`) — tipologia/grupo/SUP/origem/categoria recortam Demandas igual às outras 3
séries. `filtro-serie` (Previsto Inicial/Previsto/Realizado/Total) NÃO afeta Demandas —
decidido: sempre visível quando a dimensão é Volume.

**Acumulado:** soma corrida simples (`calcularAcumulado`, já existe e é reaproveitada sem
mudança nenhuma — mesma função que Previsto/Realizado/Tendência já usam).

## Onde entra no gráfico

Em `construirPainelGraficoHtml` (`tools/orcamento/render-dashboard.js:784+`), quando
`dimensao === 'volume'`, `dadosPorSerie` ganha uma 5ª entrada além das 4 de
`ORDEM_SERIES_GRAFICO`:

```js
var demandasMensal = demandasMensaisPorIndices(indices, registros, window.__DEMANDAS_MENSAIS__);
{ serie: 'demandas', mensal: demandasMensal, acumulado: calcularAcumulado(demandasMensal), indiceConector: null }
```

- `SERIE_LABELS.demandas = 'Demandas'`, `SERIE_COR.demandas = '#9700DA'` — mesmo hex já
  estabelecido como "cor padrão de Demandas no dashboard inteiro" (ver
  `.linha-pendentes-demandas`/`.linha-demandas` em `tools/comum/render-shell.js` e
  `tools/semanal/render-aba-demandas.js`). **Não confundir com `realizadoPrevistoInicial`
  (`#a78bfa`, lavanda)** — cor diferente, série diferente, ambas "arroxeadas" mas
  distinguíveis lado a lado.
- Barra roxa no painel Mensal (eixo primário, junto de Previsto/Realizado/Tendência), linha
  tracejada roxa no painel Acumulado (eixo secundário) — mesmas funções
  `construirGraficoMensalSvg`/`construirGraficoAcumuladoSvg` (`render-dashboard.js:727,755`),
  sem mudança de assinatura: as duas já iteram `dadosPorSerie` genericamente por `serie`/
  `mensal`/`acumulado`, então uma 5ª entrada só funciona se `SERIE_LABELS`/`SERIE_COR`
  tiverem a chave `demandas` — não deveria exigir mudar o corpo das duas funções, mas
  confirmar ao implementar (ver "Riscos").
- Legenda: aparece como "Demandas" (bolinha roxa) só no painel de Volume, ao lado de
  Previsto/Realizado/Tendência — a legenda já lê `seriesVisiveis`/seus rótulos
  dinamicamente; Demandas entra na lista só quando `dimensao === 'volume'`, fora do
  `ORDEM_SERIES_GRAFICO` normal (que vale para as outras 4 dimensões).
- Tooltip: mesmo mecanismo de `data-tooltip` já usado pelas outras séries
  (`MESES_ABREVIADOS[mes] + ' · ' + SERIE_LABELS[d.serie] + ...`) — funciona sem mudança
  desde que `demandas` entre em `dadosPorSerie` com o mesmo formato `{serie, mensal,
  acumulado, indiceConector}`.
- **Ordem de grandeza:** no exemplo do BI (um contrato só, 2026), Solicitados/mês chegou a
  933 num mês só, e o acumulado passou de 8.000 em agosto — para o orçamento inteiro (todos
  os contratos, sem filtro), os números tendem a ser bem maiores. Isso é esperado e não pede
  nenhum tratamento especial: o eixo primário (barras) e o secundário (acumulado) já
  auto-escalam pelo maior valor visível entre as séries, mesma mecânica que as outras 3 já
  usam.

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

**O live-refresh não atualiza Demandas** (ver seção do blob cifrado) — um usuário que clicar
"Atualizar dados ao vivo" depois de novas demandas chegarem no `avancos-online.csv`
continuará vendo o Gráfico de Volume com Demandas do build anterior, enquanto
Previsto/Realizado/Tendência já mostram o dado novo da MATRIZ. Aceito nesta v1; documentar
na tela não está no escopo pedido, mas vale considerar um aviso textual pequeno se o dono do
projeto achar confuso na prática.

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
- **`chegadasMensaisPorRegistro` (build, Node)**: soma de todas as chaves, por mês, bate com
  `demandas.totais.chegadas[mes]` que `computeDemandas` já produziria para os mesmos
  furos/ensaios (prova de que o bucketing por registro reproduz a mesma regra de fluxo, só
  quebrada por SUP em vez de só por tipologia); evento fora da janela dos 12 `periodos` não
  entra em nenhum mês; chave sem nenhum evento devolve 12 zeros (ou não aparece no objeto —
  decidir na implementação, documentar o escolhido, e cobrir o caso "sem entrada" em
  `demandasMensaisPorIndices` de qualquer forma).
- **Novo teste de unidade cliente** (`demandasMensaisPorIndices`, extraído via
  `extrairFuncoesPuras` como o resto do script cliente do orçamento já é testado): soma
  correta das chaves que passam no filtro; registros fora dos `indices` filtrados não
  contam; sem `window.__DEMANDAS_MENSAIS__` devolve 12 zeros (não lança).
- **`dadosPorSerie` com Demandas**: dimensão Volume inclui a 5ª entrada com `mensal`/
  `acumulado` corretos (`acumulado` é soma corrida de `mensal`, crescente ou estável, nunca
  decrescente); as outras 4 dimensões NÃO incluem Demandas (array de 4 entradas, não 5).
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

## Histórico da decisão

Registrado para não reabrir a mesma investigação numa sessão futura:

1. Primeira versão deste spec (2026-08-13, manhã): série `chegadas`, mensal + acumulado por
   soma corrida.
2. Revisão no mesmo dia: o dono do projeto pediu para trocar para `pendentes` ("saldo ao
   final de cada mês"), o que teria mudado a mecânica do acumulado (sem soma, por ser
   estoque — ver a regra em `compute-demandas.js`/`acumularSerie`).
3. Antes de implementar, comparação ao vivo com a página 2 do Power BI "SUPORTE SOLOS"
   (filtro Via Araucária S.A, ano 2026): "Solicitados"/"Solicitado Acumulado" lá é
   estruturalmente `chegadas` + soma corrida, sem nenhuma linha de estoque. Decisão final,
   confirmada com o dono do projeto: `chegadas`, como na primeira versão.
