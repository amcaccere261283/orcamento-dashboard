# Atualizar Demandas ao clicar em "Atualizar dados" (Matriz de Orçamento)

**Pedido do usuário:** hoje o botão "Atualizar dados" da Matriz de Orçamento
(`docs/index.html`) só re-busca o espelho da MATRIZ e recalcula
Previsto/Realizado/Tendência. A série Demandas (chegadas mensais + saldo de
abertura, adicionada em 2026-08-13) fica congelada no valor do último build.
O usuário pediu para o clique também recalcular Demandas.

## Contexto

A página irmã (`docs/planejamento-semanal.html`) já resolve exatamente este
problema: seu botão "Atualizar dados" busca `avancos-online.csv`,
`lab-online.csv`, `demandas-sondagem-online.csv` e `demandas-lab-online.json`
(os 4 arquivos que o build também usa) e recalcula Demandas no navegador via
`ComputeDemandas.computeDemandas(...)`. Esse caminho é código testado e em
produção há semanas (`tools/semanal/render-semanal.js`,
`atualizarDadosAoVivoSemanal`).

A página de orçamento nunca usou o mecanismo de *bundle* para navegador
(`tools/comum/browser-bundle.js`) que a semanal usa para embutir
`parse-avancos.js`/`parse-lab.js`/`compute-demandas.js` inteiros no cliente —
seu script de cliente é hoje só o handwritten `SCRIPT_CLIENTE_TABELA`, com
funções isoladas injetadas via `fonteParaCliente()`/`trechosParaCliente()`
(padrão já usado para `tools/comum/calculo-equipes.js`).

## Decisão: reaproveitar o bundle da semanal, não duplicar a lógica

Duas opções foram consideradas:

1. **Reaproveitar `buildBrowserBundle` para embutir os mesmos 4 módulos**
   (`compute-semanal.js`, `parse-avancos.js`, `parse-lab.js`,
   `compute-demandas.js`) no cliente do orçamento, mais as 4 pequenas
   injeções de função que esses módulos já precisam
   (`fonteParaClienteTipologiasAvancos`, `fonteParaClienteTipologiasLab`,
   `fonteParaClienteDatas`, `fonteParaClienteLinhaBase`, todas já existentes
   em `tools/comum/`). **Escolhida.**
2. Reescrever à mão uma versão simplificada dessas regras direto no script
   do orçamento. Descartada: duplicaria regras de negócio não triviais
   (deslocamento, metragem 0,01 descartada, tradução de tipologia, parsing
   de data com fallback serial/texto) com risco real de o live-refresh
   divergir do build.

`buildBrowserBundle(dir, arquivosEmOrdem)` já é genérico (aceita qualquer
diretório e lista de arquivos — não é hardcoded para a semanal), então nada
muda em `tools/comum/browser-bundle.js`. `tools/orcamento/render-dashboard.js`
passa a chamar `buildBrowserBundle(path.join(__dirname, '..', 'semanal'), ['compute-semanal.js', 'parse-avancos.js', 'parse-lab.js', 'compute-demandas.js'])`
— mesma ordem de dependência que `BUNDLE_ARQUIVOS` já usa na semanal
(`compute-demandas.js` precisa vir depois de `compute-semanal.js`, de quem
consome `diaEpoch` via `require('./compute-semanal.js')`).

`tools/semanal/compute-demandas.js` continua morando em `tools/semanal/` —
nenhuma mudança de localização (decisão já tomada e documentada na feature
original de 2026-08-13).

## periodos: valor derivado do ano do build, não recalculado do espelho

`chegadasMensaisPorRegistro`/`saldoAberturaPorRegistro` só precisam do ano de
`periodos[0]` (12 meses consecutivos de janeiro a dezembro desse ano). Em vez
de re-derivar isso da linha de cabeçalho do espelho da MATRIZ (que viria como
texto formatado pelo Google Sheets, um formato diferente do serial Excel que
`excelSerialParaData` espera no build — risco novo de parsing sem
necessidade), o build já baked um `window.__VIGENTE_IDX__` do mesmo jeito;
vamos seguir o MESMO precedente e expor `window.__ANO_ORCAMENTO__` (inteiro)
num `<script>` — dado não sensível (é só o ano do orçamento, não SUP/valor).
No cliente:

```js
function periodosDoAnoOrcamento() {
  var periodos = [];
  for (var i = 0; i < 12; i++) periodos.push(new Date(Date.UTC(window.__ANO_ORCAMENTO__, i, 1)));
  return periodos;
}
```
— cópia direta de `periodosDoAnoSemanal()` (`tools/semanal/render-semanal.js:2427`).

## Divergência deliberada do padrão semanal: degradação por par, não tudo-ou-nada

Na semanal, um 404 em `avancos-online.csv`/`lab-online.csv` derruba o refresh
inteiro (são centrais para várias abas). Na Matriz de Orçamento, Demandas é
uma 5ª série opcional só na dimensão Volume — Previsto/Realizado/Tendência
(o conteúdo principal da página) não depende desses 2 arquivos. Por isso os 4
fetches de Demandas (avancos, lab, demandas-sondagem, demandas-lab) entram
como um grupo independente do fetch da MATRIZ:

- Todos os 4 usam `.catch(() => null)` individualmente (mesmo padrão que a
  semanal já usa para as fontes opcionais: EQ, roster, pendentes).
- Se `avancos-online.csv` OU `lab-online.csv` vier `null` (falha ou 404),
  Demandas simplesmente NÃO é recalculada nesta rodada —
  `window.__DEMANDAS_MENSAIS__`/`window.__DEMANDAS_SALDO_ABERTURA__`
  continuam com o valor do build (ou do último refresh bem-sucedido), e o
  restante do botão (MATRIZ → Previsto/Realizado/Tendência) atualiza
  normalmente, sem erro.
- `demandas-sondagem-online.csv`/`demandas-lab-online.json` (backlog) são
  opcionais mesmo COM avancos/lab presentes — igual à semanal: sem eles,
  Demandas recalcula só com furos/ensaios já executados (sem o backlog
  ainda não executado), em vez de travar tudo.
- O fetch da MATRIZ continua exatamente como hoje: falha nele ainda derruba
  o botão inteiro (`throw new Error(...)`), sem mudança de comportamento.

## Fluxo completo dentro de `atualizarDadosAoVivo()`

```
Promise.all([
  buscarCsv(URL_ESPELHO_MATRIZ),                                    // obrigatório, como hoje
  buscarCsv('avancos-online.csv').catch(() => null),                // opcional
  buscarCsv('lab-online.csv').catch(() => null),                    // opcional
  buscarCsv('demandas-sondagem-online.csv').catch(() => null),      // opcional
  fetch('demandas-lab-online.json').then(r => r.json()).catch(() => null), // opcional
]).then(function (textos) {
  // 1. MATRIZ: parseCsvGrid + parseMatrizClient -- igual a hoje, sem mudança.
  // 2. Se textos[1] e textos[2] vieram (avancos e lab OK):
  //    - grid de avanços = parseCsvGrid(textos[1]); se textos[3] (pendentes
  //      sondagem) veio, anexa as linhas de dado ao grid ANTES do parse
  //      (mesmo formato de 10 colunas -- parseAvancos as lê como furos
  //      PENDENTE normais).
  //    - furosLidos = ParseAvancos.parseAvancos([null, ...grid]).furos
  //    - ensaiosLidos = ParseLab.parseLab(gridCsvComoXlsx(textos[2])).ensaios
  //    - se textos[4] (pendentes lab) veio, reidrata e concatena em ensaiosLidos
  //      (mesmo shape {sup, tipologia, concluido: null, criacao: Date}).
  //    - furos = ComputeDemandas.redirecionarSupsDesconhecidos(furosLidos, registrosNovos).itens
  //    - ensaios = ComputeDemandas.redirecionarSupsDesconhecidos(ensaiosLidos, registrosNovos).itens
  //    - window.__DEMANDAS_MENSAIS__ = ComputeDemandas.chegadasMensaisPorRegistro(furos, ensaios, periodosDoAnoOrcamento())
  //    - window.__DEMANDAS_SALDO_ABERTURA__ = ComputeDemandas.saldoAberturaPorRegistro(furos, ensaios, periodosDoAnoOrcamento())
  //    - senão (avancos ou lab falharam): não mexe nos dois globais acima.
  // 3. Resto igual a hoje: preservarPrevistoInicial, fecharTendenciaVigente,
  //    montarTodosFiltrosMulti, re-render da tabela, recalcularTabela,
  //    recalcularAlertas -- e agora também precisa re-renderizar o Gráfico
  //    se a aba Gráfico estiver montada (montarGraficos), já que Demandas só
  //    aparece lá.
})
```

`fecharTendenciaVigente` já tem os dois `if` condicionais (não sobrescreve
`window.__DEMANDAS_*__` quando recebe um array puro) — nenhuma mudança
necessária nela.

## Re-render do Gráfico após o clique

Hoje `atualizarDadosAoVivo` re-renderiza só `#corpo-tabela`
(`renderCorpoTabela`) e chama `recalcularTabela`/`recalcularAlertas`. Nenhuma
delas toca a aba Gráfico. Vamos adicionar uma chamada equivalente a
`montarGraficos(...)` (a mesma função que já roda depois de qualquer mudança
de filtro, ver `tools/orcamento/render-dashboard.js:982`) ao final do
`.then()`, para que uma atualização vinda do botão também reflita nos
gráficos imediatamente — não só na próxima troca de filtro.

## Escopo de arquivos

- `tools/comum/browser-bundle.js`: sem mudanças (já genérico).
- `tools/orcamento/render-dashboard.js`:
  - importa `buildBrowserBundle` e as 4 `fonteParaCliente` de
    `tools/comum/{tipologias-avancos,tipologias-lab,datas,linha-base}.js`;
  - monta o bundle (`compute-semanal.js`, `parse-avancos.js`, `parse-lab.js`,
    `compute-demandas.js` de `tools/semanal/`) e injeta um novo `<script>`
    com as 4 `fonteParaCliente()` ANTES dele, mesmo padrão da semanal;
  - expõe `window.__ANO_ORCAMENTO__` num `<script>`;
  - reescreve `atualizarDadosAoVivo()` com o fluxo acima.
- `tools/orcamento/build-dashboard.js`: nenhuma mudança -- `renderDashboard`
  já recebe `periodos` como parâmetro; `window.__ANO_ORCAMENTO__` é derivado
  de `periodos[0].getUTCFullYear()` dentro do próprio `render-dashboard.js`.
- `test/orcamento-render-dashboard.test.js`: novos testes para o bundle
  embutido, `window.__ANO_ORCAMENTO__`, e o fluxo completo de
  `atualizarDadosAoVivo` com furos/ensaios/pendentes mockados (fetch
  stubado), cobrindo: caminho feliz, avancos/lab ausentes (Demandas não
  muda), pendentes ausentes (Demandas recalcula sem backlog).
- `test/fixtures/orcamento-golden.html`: regeneração esperada (o bundle novo
  muda o texto do script de cliente).
- `CLAUDE.md`: nova seção documentando a decisão de reaproveitar o bundle.

## Segurança

Os 4 arquivos de furos/ensaios já são servidos em texto puro pelo GitHub
Pages e já são buscados em texto puro pela página semanal — nenhuma mudança
de superfície de exposição. SUP/Grupo/Tomador/Tipologia/valores da MATRIZ
continuam cifrados no HTML estático; isso nunca esteve em jogo aqui (o
live-refresh sempre buscou o espelho da MATRIZ em texto puro também, mesmo
antes desta mudança).
