# Botão "Atualizar dados" na página semanal

## Motivação

A página `planejamento-semanal.html` é 100% estática: os dados ficam congelados
no que estava nas três fontes (MATRIZ, linha de base, Avanço Sond) no momento
do último `build-dashboard.js` + publish manual. O usuário notou que edições
recentes na MATRIZ (em especial ticket médio) não estavam aparecendo, e pediu
um botão "Atualizar dados" equivalente ao que o dashboard de orçamento já tem.

O orçamento resolve isso com um mecanismo já em produção: um Apps Script
separado espelha a aba MATRIZ do `.xlsx` real pra uma Google Sheet, publicada
como CSV, atualizada a cada 30 min; o botão busca esse CSV no navegador,
reconstrói os registros e re-renderiza. Este documento estende o mesmo padrão
pra semanal, cobrindo as três fontes que ela usa (não só a MATRIZ).

Confirmado com o usuário: o botão deve atualizar tanto o que vem da MATRIZ
(Previsto, ticket médio) quanto o que vem do Avanço Sond (Realizado,
Demandas, Tendência).

## Estado atual (linha de base pra este design)

- `render-semanal.js` não tem `fetch`, `atualizar` nem `URL_ESPELHO` em
  lugar nenhum -- confirmado por grep antes de começar este documento.
- `window.__REGISTROS__` (MATRIZ + linha de base já mesclada como
  `previstoInicial`... **não**: ver próximo ponto) e `window.__DEMANDAS__`
  (Avanço Sond, já agregado) são montados uma vez, na decriptação inicial, a
  partir do blob cifrado gerado em build.
- `window.__BASELINE__` (linha de base, `previstoInicial`) é mantido **à
  parte** de `window.__REGISTROS__` -- ao contrário do orçamento, que anexa
  `previstoInicial` em cada registro no momento do build. Em semanal,
  `achaBaseline`/`chaveBaseline` (`compute-balanco.js`) procuram
  `window.__BASELINE__` por `sup||tipologia` a cada cálculo. **Consequência
  direta pro design abaixo: atualizar `window.__REGISTROS__` ao vivo não
  precisa de nenhum transplante de `previstoInicial`** (o `preservarPrevistoInicial`
  que o orçamento precisa não tem equivalente necessário aqui) -- só
  substituir o array; os lookups em `window.__BASELINE__` continuam válidos
  porque as chaves (`sup`, `tipologia`) vêm da mesma MATRIZ de sempre.
- O Realizado/Tendência semanal e a aba Demandas já leem de
  `window.__DEMANDAS__` em tempo de render (`contarEventosNoIntervalo` em
  `render-aba-semanal.js`, `realizadoDoAvancos` em `compute-balanco.js`) --
  não há um valor "Realizado" pré-calculado embutido em cada registro que
  precisaria de recomputo separado. Substituir `window.__DEMANDAS__` já é
  suficiente pro resto do pipeline (que já roda inteiramente no cliente hoje,
  disparado a cada troca de filtro) refletir os dados novos.

## Fontes ao vivo necessárias

### 1. MATRIZ (Previsto, ticket médio) -- já existe

Reaproveita o CSV `URL_ESPELHO_MATRIZ` do orçamento, incluindo a coluna
TICKET (`extrairValoresLinhaClient`, `render-dashboard.js:1682`, já lê
`columns.volumeResumo.ticket`). Nenhuma peça nova de infraestrutura.

### 2. Avanço Sond (Realizado, Demandas, Tendência) -- nova

O workbook `Avanço Sond.xlsx` (mesmo `config-demandas.js`/`config-lab.js`)
tem as abas `Avanços` e `Lab Concluido` que a semanal já lê no build. Um novo
Apps Script, no mesmo molde de `apps-script-espelho-matriz.gs`, roda ligado a
UMA nova Sheet espelho com DUAS abas (uma por aba de origem: `Avanços` e
`Lab Concluido`), copiadas pela mesma função-gatilho a cada 30 min. Cada aba
espelho é publicada (Arquivo > Compartilhar > Publicar na Web) como seu
próprio CSV -- duas URLs, um `gid` por aba, mesma Sheet. Configuração manual
do usuário, igual à que ele já fez pra MATRIZ (colar script, autorizar,
criar gatilho, publicar as duas abas como CSV, me passar as duas URLs).

Não é preciso espelhar "Ensaios Campo" (3ª aba do mesmo workbook, mencionada
em `config-lab.js` mas não usada por nenhum parser hoje).

## Arquitetura: por que os módulos Node de Avanços/Lab não entram direto no bundle

`tools/comum/browser-bundle.js` (`transformaModulo`) sabe rescrever
`require('./arquivo.js')` (mesmo diretório) pra uma leitura de `MODULOS[...]`,
mas **remove inteiramente** qualquer `require('../outro-dir/arquivo.js')` --
o bundle só concatena os arquivos de UM diretório, e alguns módulos de
`tools/comum/` têm `require('node:fs')` no topo, que quebraria a IIFE inteira
se fosse incluído cru. Isso já está documentado no próprio código (comentário
de `transformaModulo`) e é o motivo de `parse-avancos.js` ter, no topo,
"Node-only: NUNCA entra no bundle do navegador".

O padrão já usado neste repositório pra resolver isso (`calculo-equipes.js`
-> `mediaEquipesPonderada`, consumida por `compute-balanco.js`, que já está
no bundle da semanal) é: o módulo de `tools/comum/` expõe uma função
`fonteParaCliente()` que devolve, como texto, só os trechos marcados
`// <<< INICIO CLIENTE ... // FIM CLIENTE >>>` do próprio arquivo. Esse texto
é injetado num `<script>` **antes** do bundle, viram funções globais de
verdade (`function nome(...) {...}` no topo do escopo), e o bundle (cujo
`require('../comum/...')` foi removido pelo `transformaModulo`) resolve a
referência pelo escopo global -- exatamente como já acontece hoje com
`mediaEquipesPonderada`.

Módulos afetados, e o tratamento de cada um:

- **`tools/comum/tipologias-avancos.js`** (`MAPA_TIPOLOGIAS`,
  `rotularTipologia`, `ORDEM_TIPOLOGIAS`, `SO_QUANDO_ACIONADA`) -- ganha
  marcadores + `trechosParaCliente()`/`fonteParaCliente()`. Não duplicar:
  esta tabela já sofreu 7 reclassificações numa única sessão (2026-08-01) e é
  o tipo de coisa que diverge em silêncio se existir em dois lugares.
- **`tools/comum/tipologias-lab.js`** (`classificarEnsaioLab`) -- mesmo
  tratamento, mesmo motivo.
- **`tools/comum/datas.js`** (`excelSerialParaData`) -- ganha marcadores.
  Função de 2 linhas, mas usada por `parse-avancos.js` E `parse-lab.js`;
  duplicar duas vezes (uma em cada) é pior que expor uma vez.
- **`tools/comum/linha-base.js`** (`chaveMatriz`) -- **não precisa de
  marcador**: como o parágrafo "Estado atual" acima estabelece, a página
  semanal nunca chama `chaveMatriz`/reconciliação de linha de base no
  cliente (ela já recebe a linha de base pré-rechaveada do build, e
  atualizar `window.__REGISTROS__` não mexe em `window.__BASELINE__`).
  `compute-demandas.js` importa `chaveMatriz` de lá só pra uso Node-side
  (build); no cliente, os registros vindos do CSV de Avanços/Lab não passam
  por essa chave -- ver próxima seção.
- **`tools/semanal/build-dashboard.js` (`redirecionarSupsDesconhecidos`)** --
  hoje é uma função local desse arquivo (orquestração Node-only), não um
  módulo separado. Precisa se mudar pra um arquivo que o bundle alcance
  (proposta: mover pra dentro de `compute-demandas.js`, já que é sempre
  chamada logo antes de `computeDemandas` e opera nos mesmos `itens`/
  `registros` -- ou um novo `tools/semanal/reconciliar-sups.js` se
  `compute-demandas.js` ficar grande demais). `build-dashboard.js` volta a
  importar essa função de onde ela for morar, sem mudança de comportamento.

Com isso, `parse-avancos.js`, `parse-lab.js` e `compute-demandas.js` (+ onde
`redirecionarSupsDesconhecidos` for morar) entram em `BUNDLE_ARQUIVOS` da
semanal como estão, sem reescrever a lógica em ES5 nem duplicá-la numa
"réplica" -- é o próprio arquivo testado no Node que roda no navegador,
igual ao que `compute-semanal.js`/`compute-balanco.js` já fazem hoje.

### Parsing do CSV da MATRIZ (o lado que já existe, mas só no orçamento)

`parseMatrizClient`/`locateColumnsClient`/`extrairValoresLinhaClient` (as
~150 linhas de `render-dashboard.js:1604-1746`) são, pelo próprio comentário
do arquivo, uma "réplica em JS de parse-matriz.js" -- não um módulo Node
testável, e sim texto escrito à mão dentro do template literal do script de
cliente do orçamento. `build-dashboard.js` (semanal) confirma que os
registros de semanal vêm do MESMO `parseMatriz`/`locateColumns`
(`tools/orcamento/parse-matriz.js`) que o orçamento usa -- mesma forma de
registro nas duas páginas -- então essa réplica já pronta é reaproveitável
como está, sem reescrever nada.

Duas formas de reaproveitar, com um trade-off real entre elas:

1. **Extrair `parse-matriz.js` pro padrão `fonteParaCliente()`** (marcar os
   trechos relevantes, gerar o texto injetável, e trocar o hand-write atual
   em `render-dashboard.js` por essa injeção) -- mais correto a longo prazo
   (um só texto fonte pros dois lados), mas mexe num arquivo do orçamento
   trancado por teste de byte-a-byte (`test/orcamento-html-inalterado.test.js`)
   fora do escopo desta feature.
2. **Duplicar as ~150 linhas numa réplica nova, só de semanal** -- mesmo
   nível de duplicação que o próprio `parseMatrizClient` já é em relação a
   `parse-matriz.js` (uma "réplica da réplica", mas de um trecho estável:
   raramente muda, e quando muda é porque a MATRIZ mudou de forma, o que já
   quebra o build normal e forçaria olhar os dois lados de qualquer jeito).

**Escolha: opção 2**, por manter esta feature isolada do arquivo golden-locked
do orçamento. Fica registrado aqui como dívida consciente, não como
descuido -- se um dia `parse-matriz.js` ganhar `fonteParaCliente()` por outro
motivo, a réplica de semanal deve ser trocada pela injeção também.

### Parsing de CSV

O orçamento já tem `parseCsvGrid` (client-side, dentro de
`render-dashboard.js`). Extrair pra `tools/comum/` (com o mesmo tratamento
de marcador, já que os dois dashboards passam a precisar do idêntico
comportamento de escaping de CSV) e as duas páginas passam a importar dali,
em vez de a semanal duplicar o parser um a mais.

### `periodos`

`computeDemandas(furos, periodos, ensaios)` precisa do array de 12 `Date`
(Jan..Dez do ano vigente). Hoje isso é montado em `build-dashboard.js`.
No cliente, constrói-se trivialmente a partir de `window.__ANO__` (já
presente hoje, usado por `montarAbaGraficoSemanal`): 12 `new
Date(Date.UTC(window.__ANO__, i, 1))`.

## Fluxo do botão

Mesmo desenho do orçamento (`atualizarDadosAoVivo`, `render-dashboard.js`),
adaptado:

1. `definirStatusAtualizacao('Atualizando…')`.
2. `fetch` em paralelo: CSV da MATRIZ (URL já existente), CSV de Avanços
   (novo), CSV de Lab Concluido (novo) -- todos com cache-bust
   (`?_=Date.now()`).
3. Parse: réplica própria de semanal (ver seção "Parsing do CSV da MATRIZ"
   acima) pro CSV da MATRIZ, produzindo os novos `registros` SEM transplante
   de baseline (ver "Estado atual" acima); `parseAvancos` pro grid de
   Avanços; `parseLab` pro grid de Lab.
4. `redirecionarSupsDesconhecidos` nos dois conjuntos de itens, contra os
   `registros` recém-buscados (mesma ordem de dependência que
   `build-dashboard.js` usa hoje: registros primeiro, porque o redirect
   precisa saber quais SUP existem na MATRIZ viva).
5. `computeDemandas(furos, periodosDoAno, ensaios)` monta a nova
   `demandas`.
6. Se qualquer fetch/parse falhar (rede, coluna ausente/renomeada -- mesma
   validação por rótulo que `acharColunaClient`/`locateColunasAvancos` já
   fazem, erro-cedo): não troca nada em `window`, `definirStatusAtualizacao`
   com o texto do erro e `ehErro:true`. Falha parcial (ex.: MATRIZ ok, Avanços
   falhou) também não troca nada -- atualização é tudo-ou-nada, pra nunca
   deixar `window.__REGISTROS__` e `window.__DEMANDAS__` referindo a
   momentos diferentes.
7. Sucesso: substitui `window.__REGISTROS__` e `window.__DEMANDAS__`
   (`window.__BASELINE__` intocado), refaz `fecharTendenciaVigente`,
   remonta os 6 filtros compartilhados (SUP/tipologia novos podem ter
   aparecido), re-renderiza a aba ativa (Semanal/Gráficos/Balanço/Demandas
   -- mesmas funções que já rodam a cada troca de filtro hoje:
   `recalcularSemanal`, `montarAbaGraficoSemanal`, `montarAbaBalanco`,
   `montarAbaDemandas`), `definirStatusAtualizacao('Atualizado às HH:MM')`.

## UI

Reaproveita o markup e o CSS já existentes e compartilhados
(`#atualizar-dashboard`, `#status-atualizacao`, `.status-atualizacao` já
estão em `cssBase()`, `tools/comum/render-shell.js` -- herdados sem uso pela
semanal hoje). Só falta o `<button>`/`<span>` no HTML de `render-semanal.js`
e o `addEventListener`. Nenhuma CSS nova.

## Fora de escopo

- Não muda o pipeline de build/publish estático -- o botão é um refresh
  efêmero em memória; recarregar a página volta ao último snapshot
  publicado (mesmo comportamento que o orçamento já tem hoje).
- Não espelha "Ensaios Campo" (3ª aba do workbook, não usada por nenhum
  parser existente).
- Configuração do(s) Apps Script(s) novo(s) é ação manual do usuário na
  própria conta Google -- não é algo que o build/código automatize.

## Riscos conhecidos

- **Tamanho**: Avanços tem ~62 mil linhas. Espelhamento via Apps Script fica
  dentro dos limites de Sheets/execução, mas o fetch+parse no navegador é
  perceptivelmente mais pesado que o da MATRIZ (algumas centenas de linhas)
  -- alguns segundos de "Atualizando…" são esperados, não bug.
- **Dois lugares de verdade por design, não por acidente**: os módulos que
  ganham `fonteParaCliente()` continuam existindo como arquivo Node E como
  texto injetado; qualquer edição futura em `tipologias-avancos.js`/
  `tipologias-lab.js`/`datas.js` continua valendo pros dois lados
  automaticamente (é o próprio texto do arquivo que é injetado, não uma
  cópia mantida à mão) -- mesma garantia que já vale pra
  `mediaEquipesPonderada` hoje.
