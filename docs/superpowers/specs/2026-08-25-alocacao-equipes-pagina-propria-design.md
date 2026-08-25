# Alocação Equipes vira página própria

**Data:** 2026-08-25
**Status:** aprovado para plano de implementação

## Contexto

`planejamento-semanal.html` tem hoje 7 abas: Semanal, Gráficos, Balanço de massa,
Demandas, Alertas, Consolidado e Alocação Equipes (a 7ª, adicionada em 2026-08-10 —
ver seção `### Aba Alocação Equipes` do `CLAUDE.md` do repositório). O usuário pediu
que a Alocação Equipes vire uma página HTML própria, publicada separadamente.

Investigação (2026-08-25) confirmou que a aba **não é um módulo isolado**: ela reusa
quase toda a pipeline de dados que as outras 6 abas já calculam.

- `render-semanal.js`: as 7 abas são uma lista (`{id: 'aba-alocacao', rotulo:
  'Alocação Equipes', ...}`, linha ~67-69), mostradas/escondidas trocando `display`
  de `#secao-alocacao` (linha ~1196).
- A aba **não tem seletor de mês próprio** — lê o mesmo `mesSelecionadoIdx`
  compartilhado da barra global (declarado linha ~1118, lido em `montarAbaAlocacao`
  linha ~1874). Tem só `ESTADO_ALOCACAO.semanaIdx` (semana dentro do mês) como
  estado próprio.
- Recebe `window.__REGISTROS__` (MATRIZ inteira), `window.__DEMANDAS__` e
  `window.__ANO__` como globais, e usa os mesmos 5 filtros da barra compartilhada
  via `indicesFiltrados(...)` (`filtrosSelecionadosSemanal`, linha ~1865-1869) — quais
  dos 5 ela de fato aplica precisa ser confirmado lendo `indicesFiltrados` na
  implementação. **Não usa `filtro-ativos`**, decisão deliberada (comentário linha
  ~1820-1824 — esconderia linhas "Parado c/ carteira", que são o motivo da aba
  existir).
- Usa a MESMA pipeline de Tendência que a Tabela Semanal/Consolidado
  (`calcularSeriesSemanaisDimensao`, via `ancoraDaSemana` em `compute-alocacao.js`)
  — não há cálculo de Tendência próprio.
- `build-dashboard.js`: `montarEquipesAtivas(furos, csvEspelho)` (linha ~174-221)
  gera `equipesCsv`, `osParaSup` e `equipesRosterPeriodo` — os **3 únicos campos do
  blob que só a Alocação consome** (comentários linha ~203-209, ~380-408), buscados
  de `buscarEspelhoEq()` (Sheet espelho da aba EQ). Fora esses 3, a Alocação depende
  de `window.__REGISTROS__` inteiro e da mesma pipeline de Tendência que todas as
  outras abas — **não há um recorte pequeno e isolado de dado**.
- Live-refresh: `atualizarDadosAoVivoSemanal` (linha ~2851-2893) já busca
  `equipesCsv`/`osParaSup`/`equipesRosterPeriodo` de novo no clique de "Atualizar
  dados", dentro do MESMO botão que recalcula as outras 6 abas.
- Testes que citam "alocacao": `semanal-alocacao-interacao`,
  `semanal-alocacao-sheet`, `semanal-apps-script-alocacao`,
  `semanal-compute-alocacao`, `semanal-equipes-alocaveis`,
  `semanal-grupos-veiculo`, `semanal-render-aba-alocacao` (tem o teste-invariante
  que compara a soma da grade com a Tabela Semanal), e possivelmente
  `semanal-render-aba-semanal`/`semanal-render-semanal-wireup` (não confirmado se
  fazem assert sobre as 7 abas juntas).

Dois pontos que a investigação não fechou e que a implementação precisa verificar
antes de codar (não bloqueiam este desenho):

- O nome exato do CSV/URL de origem de `csvEspelho` dentro de `montarEquipesAtivas`
  em `build-dashboard.js` — só o parâmetro foi visto, não o fetch em si.
- Quanto do CSS de `cssBase()`/`tools/comum/render-shell.js` é seguro reaproveitar
  sem regenerar o golden test (o CLAUDE.md já registra ~79 de 254 linhas como
  exclusivas do orçamento, herdadas sem uso pela semanal — dividir "exigiria
  regenerar o golden de propósito").

## Decisões (perguntadas e confirmadas com o usuário)

1. **A aba sai do `planejamento-semanal.html`** — fica só na página nova. Sem
   duplicação de manutenção entre dois lugares.
2. **Publicada no mesmo repositório**, novo arquivo (`docs/alocacao-equipes.html`),
   mesmo GitHub Pages que já serve as outras páginas — não um repo/site à parte.
3. **Mantém senha (`ORCAMENTO_SENHA`, blob AES-256-GCM) e o mecanismo de "Atualizar
   dados" ao vivo**, comportamento idêntico ao de hoje, só isolado nessa página.
4. **Mesmo build, dois arquivos de saída** (não um build separado com fetch/cálculo
   próprios) — `build-dashboard.js` continua sendo o único ponto que busca e calcula
   tudo; escreve `dist/planejamento-semanal.html` (6 abas) e
   `dist/alocacao-equipes.html` (a 7ª, sozinha) na mesma execução. Elimina o risco
   de os dois arquivos divergirem no dado de origem e evita duplicar ~539 linhas de
   lógica de busca/parse.

## Arquitetura

### Build (`tools/semanal/build-dashboard.js`)

Continua buscando e calculando tudo exatamente como hoje (MATRIZ, Avanço Sond, Lab,
Sheet EQ). Ganha um segundo passo de renderização + escrita, depois do que já existe:

- `dist/planejamento-semanal.html`: sem a entrada `{id:'aba-alocacao', ...}` na lista
  de abas, sem `#secao-alocacao`, sem a chamada de `RenderAbaAlocacao`/
  `montarAbaAlocacao` no bundle de scripts embutidos do cliente, e **sem** os 3
  campos exclusivos (`equipesCsv`/`osParaSup`/`equipesRosterPeriodo`) no blob
  cifrado — o blob encolhe. O live-refresh dessa página para de buscar a Sheet EQ
  (só a Alocação consumia).
- `dist/alocacao-equipes.html`: gerado por um novo módulo,
  `tools/semanal/render-alocacao-pagina.js`, chamado a partir do mesmo
  `build-dashboard.js` com os mesmos `registros`/`demandas`/`ano` já calculados
  nessa execução (não recalcula nada, só reaproveita).

### Página nova (`render-alocacao-pagina.js`)

Reaproveita `RenderAbaAlocacao.renderAbaAlocacao` (o miolo de 689 linhas de
`render-aba-alocacao.js`) sem alterar sua lógica interna, dentro de um shell PRÓPRIO:

- Gate de senha idêntico ao existente (`cssBase()`/`tools/comum/render-shell.js`
  reaproveitados como estão — não vale a pena dividir o CSS pelo custo de golden
  test registrado no CLAUDE.md, mesmo a página ficando um pouco mais pesada que o
  estritamente necessário).
- **Controle próprio de "Mês selecionado"**, inicializado no mês vigente — a aba não
  tinha um antes porque lia o compartilhado das outras 6 abas, que deixam de
  existir nessa página.
- **Barra de filtros reduzida** aos filtros que `indicesFiltrados` realmente aplica
  para a Alocação (confirmar na implementação quais dos 5 são esses — provável SUP e
  tipologia, a confirmar lendo o código).
- Campo de busca de equipe e `ESTADO_ALOCACAO.semanaIdx` (semana dentro do mês
  selecionado) continuam exatamente como hoje, sem mudança de comportamento.

### Blob cifrado da página nova

Mesma senha (`ORCAMENTO_SENHA`), mesmo esquema AES-256-GCM. Contém `registros`
(MATRIZ inteira — necessária para a Tendência, não dá para cortar) e os campos de
`demandas` que a Alocação usa (`equipesCsv`/`osParaSup`/`equipesRosterPeriodo` +
o necessário para Pendentes/Tendência).

### Live-refresh da página nova

Botão "Atualizar dados" refaz no navegador só o que a Alocação precisa: recalcula
Tendência (mesmo bundle de `compute-semanal.js`/`compute-alocacao.js`/
`grupos-veiculo.js`/`equipes-alocaveis.js` embutido como hoje) e reata a Sheet EQ
(`equipesCsv`/`osParaSup`/`equipesRosterPeriodo`) e o Avanço Sond (para
Tendência/Pendentes) — os MESMOS fetches que a aba já dispara hoje dentro de
`atualizarDadosAoVivoSemanal`, isolados nesse botão, sem recalcular as 6 abas que
não existem mais nesta página.

Persistência da alocação em si (Apps Script `apps-script-alocacao.gs`/cliente
`alocacao-sheet.js`) não muda nada — já é cliente puro, funciona igual em qualquer
página que a hospede.

### Publicação

Mesmo padrão do repositório: `cp dist/alocacao-equipes.html
docs/alocacao-equipes.html`, junto com a cópia de sempre de
`dist/planejamento-semanal.html` → `docs/planejamento-semanal.html`, no mesmo commit.
Servido no mesmo domínio GitHub Pages, path novo.

## Testes

- `test/semanal-render-aba-alocacao.test.js` (teste-invariante: com a alocação
  vazia, a soma da tendência da grade bate com a Tabela Semanal) muda de alvo: hoje
  monta a página via `render-semanal.js`; passa a montar via
  `render-alocacao-pagina.js` novo. A afirmação em si não muda.
- Módulos de cálculo puro (`semanal-compute-alocacao`, `semanal-equipes-alocaveis`,
  `semanal-grupos-veiculo`, `semanal-alocacao-sheet`, `semanal-apps-script-alocacao`,
  `semanal-alocacao-interacao`) não devem precisar mudar — não dependem de qual
  página hospeda a aba.
- `semanal-render-semanal-wireup.test.js` e `semanal-render-aba-semanal.test.js`
  precisam ser conferidos e ajustados se fizerem assert sobre as 7 abas juntas (viram
  6 em `planejamento-semanal.html`).
- `test/publicacao-docs-sincronizado.test.js` (hoje trava a cópia de
  `planejamento-semanal.html` + `avancos-online.csv` para `docs/`) cresce para
  também travar a cópia de `alocacao-equipes.html`.
- Novo teste (ou extensão de um existente) verificando que `planejamento-semanal.html`
  gerado **não** contém mais `equipesCsv`/`osParaSup`/`equipesRosterPeriodo` no blob
  nem a aba Alocação no HTML — evita regressão silenciosa em que os dois arquivos
  saem duplicados por engano.

## Fora de escopo

- Mover os módulos de cálculo (`compute-alocacao.js`, `equipes-alocaveis.js`,
  `grupos-veiculo.js`, `alocacao-sheet.js`) para outro diretório — continuam em
  `tools/semanal/`, só passam a ser importados por dois builds (o de
  `build-dashboard.js` que monta os dois HTMLs) em vez de um.
- Publicar em repositório/site próprio (like `matriz`/`medicoes`) — decidido que fica
  no mesmo repo, mesmo Pages.
- Dividir `cssBase()`/`render-shell.js` para reduzir o peso da página nova — custo
  de golden test não compensa aqui.
- Revisão de design do Open Design — o MCP está desconectado nesta sessão; seguir
  sem ele conforme a regra do CLAUDE.md ("se não estiver disponível, siga sem ele"),
  e rodar quando a ferramenta voltar a estar acessível, antes de considerar o visual
  fechado.
