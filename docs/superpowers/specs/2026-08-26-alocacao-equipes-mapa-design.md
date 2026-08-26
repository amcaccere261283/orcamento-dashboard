# Aba Mapa na página Alocação Equipes

**Data:** 2026-08-26
**Status:** aprovado para plano de implementação

## Contexto

`docs/alocacao-equipes.html` (página própria desde 2026-08-25, ver seção `### Aba
Alocação Equipes` do `CLAUDE.md`) mostra hoje um quadro SUP × tipologia onde equipes
são arrastadas por Pointer Events para células. O usuário pediu uma segunda visão da
MESMA alocação, num mapa: pinos por SUP em vez de células, arrastando equipes até o
pino em vez da célula.

Levantamento feito antes deste desenho:

- **Não existe hoje nenhuma coordenada de demanda em nenhuma fonte do pipeline**
  (MATRIZ mirror — `ORIGEM/GRUPO/TOMADOR/SUP/ESCOPO/APOIO/INICIO/TERMINO/SONDAGEM/
  BASE` —, CSV de demandas de sondagem, roster de equipes). Perguntado ao dono do
  projeto: **Patrick vai atualizar a fonte de demandas do planejamento semanal com
  lat/long por demanda** — ainda não publicado no momento deste desenho.
- Referência de mapa: projeto **Mapa Sondagens**, rodando em
  `http://192.168.1.53:8080/` (acessível por HTTP puro na rede local). Setup real
  inspecionado (`js/app.js`): MapLibre GL JS 4.7.1, três fontes raster Esri/ArcGIS
  Online (`World_Imagery` como base, `Reference/World_Transportation` e
  `Reference/World_Boundaries_and_Places` sempre por cima, sem toggle), atribuição
  `'Tiles © Esri'`, zoom do mapa só com Ctrl+scroll (scroll normal rola a página),
  `NavigationControl` sem bússola.
- Identidade visual de referência: `GUIA DE MARCA - SUPORTE.pdf` (pasta do Drive
  informada pelo usuário) — paleta `#FFFFFF / #00163B / #000000 / #F3B53F`,
  tipografia principal Nimbus Sans Extd (títulos), tipografia de apoio Poppins
  (Google Fonts, corpo de texto). É exatamente a paleta que `css/style.css` do Mapa
  Sondagens já usa (`--acento:#f3b53f`, `--acento-contraste:#00163b`, fundo
  `#0c0d10`, painéis "glass" com blur, textura de fundo da capa do guia).
- Arquitetura de dados da aba existente (`tools/semanal/compute-alocacao.js`,
  `render-aba-alocacao.js`): `montarGradeAlocacao` produz `grade.linhas`, uma
  entrada por SUP com `celulas` por coluna de tipologia; `resumirAlocacao` produz
  `resumo.porSup`, com `leitura: leituraDoSup(...)` — 6 estados
  (`parado-com-carteira`, `sem-equipe`, `falta-equipe`, `antecipar`, `absorvido`,
  `sem-demanda`), já com rótulo e classe CSS de cor definidos
  (`ROTULO_LEITURA`/`CLASSE_LEITURA` em `render-aba-alocacao.js`, cores em
  `render-alocacao-pagina.js`: `#f6b53f` / `#e0684f` / `#4f8ff0` / `#7fd858` /
  cinza neutro).
- Cor por TIPOLOGIA já existe e é compartilhada entre orçamento/matriz/semanal —
  `tipologiaColor`/`TIPOLOGIA_COLOR` (`render-aba-consolidado.js`, reexportada como
  `corDaColuna` em `render-aba-alocacao.js`): `SP #3f851a, SM #2f6ad0, ST #8d6f00,
  PI #606060, BL #4a3aa7, Especiais/CPTU #db244e`. **Deliberadamente evita verde/
  vermelho** (`#7fd858`/`#e0684f`), reservados ao semáforo de leitura — comentário
  no código documenta um bug antigo causado por essa colisão. O mapa não pode
  reintroduzi-la: cor de PINO (leitura/status) e cor de TIPOLOGIA (pool/badges) são
  dois canais visuais separados.
- Arrasto: `resolverAlvoAlocacao(e)` usa `document.elementFromPoint` pra achar
  `.celula-alocacao` (com `data-sup`/`data-coluna`) ou `.pool-alocacao`, e chama
  `aplicarMovimento(equipeId, sup, coluna)`. Gestos suportados: arrasto (Pointer
  Events) e clique-clique (seleciona cartão, clica no alvo).
- Meu checkout local (`orcamento-dashboard`) estava 18 commits atrás de
  `origin/master` — a extração pra página própria já foi implementada e publicada
  por outra sessão. O trabalho deste desenho parte de `origin/master`, numa branch
  nova.

## Decisões

1. **Duas abas dentro da MESMA página** (`docs/alocacao-equipes.html`), nav no
   topo igual ao padrão Mapa Sondagens (`Kanban` / `Mapa`). Mesmo estado
   (`ESTADO_ALOCACAO`), mesma persistência (Sheet/localStorage), mesma trava de
   veículo, mesmo pool, mesmos filtros e busca — a aba Mapa é outra RENDERIZAÇÃO
   do mesmo estado, não um sistema paralelo.
2. **Nenhuma regra de negócio nova ou duplicada.** `aplicarMovimento`,
   `resolverAlvoAlocacao`, `montarGradeAlocacao`, `resumirAlocacao`,
   `leituraDoSup`, a trava de veículo (`grupos-veiculo.js`) continuam sendo os
   únicos donos das regras. A aba Mapa estende `resolverAlvoAlocacao` para
   reconhecer um marcador do MapLibre como alvo (além da célula da tabela),
   nada além disso.
3. **Coordenada por SUP, tolerante e opcional.** Novo módulo
   `tools/semanal/coordenadas-sup.js` com um resolvedor que aceita variações
   comuns de nome de coluna (`Latitude`/`Lat`, `Longitude`/`Lon`/`Lng`,
   comparação exata após normalizar acento/caixa — mesmo padrão "resolver por
   igualdade exata, nunca por prefixo" já documentado no `CLAUDE.md` pro parser
   de medições) e devolve `null` sem lançar quando a coluna não existir ou o
   valor não for um par de números válido. **Nunca inventa dado**: um SUP sem
   coordenada não vira pino, mas continua normal no Kanban.
   - Quando existir mais de um registro de demanda para o mesmo SUP com
     coordenadas diferentes, usa a PRIMEIRA coordenada não-nula encontrada
     (ordem de `registros`) — o pino representa o SUP inteiro, não uma OS
     individual, porque a alocação em si é por SUP.
   - Se as colunas reais que Patrick publicar tiverem nomes diferentes dos
     assumidos, o ajuste fica contido nesse módulo (uma função, testada
     isoladamente) — não espalha pelo pipeline.
4. **SUPs sem coordenada**: painel lateral "N SUP(s) sem localização" na aba
   Mapa, listando sup+tomador, pra não parecer bug quando a maioria ainda não
   tiver lat/long (situação esperada até Patrick publicar a fonte).
5. **Mapa igual ao Mapa Sondagens**: MapLibre GL JS 4.7.1 via unpkg (mesma
   versão), três fontes raster Esri (`World_Imagery` base +
   `Reference/World_Transportation` + `Reference/World_Boundaries_and_Places`
   sempre visíveis, sem toggle — replica exata do que já está em produção lá),
   atribuição `'Tiles © Esri'`, `NavigationControl` sem bússola,
   scroll-zoom só com Ctrl.
6. **Pino = marcador DOM do MapLibre com a MESMA classe `leitura-*`** que já
   colore a linha no Kanban (reaproveita `ROTULO_LEITURA`/`CLASSE_LEITURA` e as
   cores existentes — nenhuma paleta nova). Clique no pino abre popup com
   SUP, tomador, tendência total, saldo e as colunas/equipes alocadas naquele
   SUP (mesmo dado do card do Kanban, formato popup).
7. **Pool lateral na aba Mapa**: mesmos cartões de equipe agrupados por
   tipologia com busca, reaproveitando `corDaColuna`/`tipologiaColor` pro
   indicador de tipologia de cada cartão (mesma bolinha de cor que já existe
   no Kanban) — sem inventar cor nova, sem colidir com o semáforo de leitura
   dos pinos.
8. **Arrasto**: mesmo gesto (Pointer Events, arrasto ou clique-clique) —
   arrasta o cartão do pool até o pino do SUP. `resolverAlvoAlocacao` passa a
   reconhecer o elemento DOM do marcador (`data-sup` nele) como alvo válido,
   além de `.celula-alocacao`/`.pool-alocacao`.
   - **Resolução de coluna para equipe polivalente**: como o pino não separa
     colunas/tipologias fisicamente (ao contrário da célula), ao soltar uma
     equipe polivalente (ex. `ST | PI | BL`) sobre um pino com mais de uma
     coluna candidata naquele SUP, o sistema escolhe automaticamente a coluna
     candidata com **maior saldo negativo** (a mais carente); em empate ou
     sem nenhum déficit, usa a primeira candidata em `COLUNAS_ALOCACAO`. Sem
     seletor extra — mantém o gesto idêntico ao da tabela.
9. **Identidade visual Suporte Infra só na aba Mapa por enquanto**: cabeçalho,
   nav de abas, painel de filtros/pool e popups da aba Mapa adotam a paleta e
   tipografia do Guia de Marca (dark, `--acento:#f3b53f`,
   `--acento-contraste:#00163b`, painéis glass, Nimbus Sans Extd + Poppins),
   bem próxima da tela do Mapa Sondagens. **A aba Kanban mantém o visual atual
   dela** (já revisado pela skill `design-kanban-alocacao-equipes`) — migrá-la
   pro mesmo padrão é a FASE 2 deste trabalho, tarefa própria no plano,
   executada **depois** do Mapa estar pronto, revisado e publicado (pedido
   explícito do usuário: "após a conclusão do mapa"). Só o cabeçalho/nav de
   abas compartilhado entre as duas fica consistente desde já, pra não parecer
   dois apps colados.
10. **Branch nova a partir de `origin/master`** (não da branch local
    desatualizada `semanal-mesclar-producao-testavel`).

## Arquitetura

### Dados (build, `tools/semanal/build-dashboard.js` → `render-alocacao-pagina.js`)

- Novo módulo `tools/semanal/coordenadas-sup.js`:
  `resolverCoordenadasPorSup(registros)` → `{ [sup]: { lat, lon } }`, só com SUPs
  que têm coordenada válida. Roda no Node (build/testes) e no navegador (mesmo
  padrão `var`/`function` + comentário de `browser-bundle.js` dos módulos
  existentes), porque o live-refresh recalcula a alocação no cliente.
- `montarGradeAlocacao`/`resumirAlocacao` não mudam. A aba Mapa consome o mesmo
  `grade`/`resumo` que a aba Kanban já monta, só junta com
  `resolverCoordenadasPorSup(registros)` pra decidir quais linhas viram pino.
- Entra em `BUNDLE_ARQUIVOS_ALOCACAO` (`render-alocacao-pagina.js`), na mesma
  ordem relativa que os outros módulos de dado puro (antes de
  `render-aba-alocacao.js`, que não depende dele).

### Página (`render-alocacao-pagina.js` + novo `render-aba-alocacao-mapa.js`)

- `render-aba-alocacao-mapa.js` (novo, paralelo a `render-aba-alocacao.js`):
  monta o HTML da aba Mapa — `<div id="mapa-alocacao">`, painel de filtros/pool
  reaproveitado (mesmo markup dos filtros compartilhados), painel "sem
  localização". Não desenha os pinos em si (isso é MapLibre no cliente, os
  pinos vêm de dado JS, não de HTML estático).
- Nav de abas Kanban/Mapa no shell da página (`markupAbas`-like, mesmo padrão
  do Mapa Sondagens `<nav class="abas-principais">`), trocando `display` de
  `#secao-kanban-alocacao`/`#secao-mapa-alocacao` — mesmo mecanismo que
  `render-semanal.js` já usa entre as 6 abas dele.
- Script cliente do mapa entra em `SCRIPT_CLIENTE_ALOCACAO` (ou um bloco novo
  concatenado, decidido no plano): inicializa o MapLibre (mesmo setup do Mapa
  Sondagens), desenha um marcador por SUP com coordenada, liga
  `resolverAlvoAlocacao` ao marcador, redesenha os pinos toda vez que
  `aplicarMovimento` redesenha a grade (mesmo padrão "redesenha antes, grava
  depois" que a tabela já segue).
- CSS novo (paleta Suporte Infra) só nos seletores da aba Mapa — não toca no
  CSS existente do Kanban.

### Testes

- `coordenadas-sup.js`: unit puro — várias variações de nome de coluna, coluna
  ausente, valor não-numérico, múltiplos registros do mesmo SUP (usa o
  primeiro válido), nunca lança.
- Resolução de coluna polivalente no drop do pino: unit puro sobre a função de
  escolha (maior saldo negativo / empate / sem déficit).
- Wireup: `resolverAlvoAlocacao` reconhece o marcador (elemento com `data-sup`)
  como alvo — mesmo padrão de teste que já existe pra célula/pool, adaptado.
- Invariante herdada (não muda): a soma da grade bate com a Tabela Semanal —
  continua valendo porque `montarGradeAlocacao` não muda.
- `snapshot-alocacao.js` ganha (ou ganha um par) os estados visuais da aba
  Mapa, se o tempo permitir dentro deste plano — decidido na tarefa de
  revisão de design.

## Fora de escopo deste plano

- Migração visual da aba Kanban pro padrão Suporte Infra — fica pra depois,
  como tarefa própria, só depois do Mapa publicado (decisão explícita do
  usuário).
- Qualquer geocodificação automática por texto — Patrick fornece lat/long
  direto na fonte; se a coluna vier com nome muito diferente do assumido,
  ajusta-se `coordenadas-sup.js` quando isso acontecer, não se anda o desenho
  disso agora.
- Revisão de Open Design ao vivo — o MCP do Open Design está desconectado
  nesta sessão; o CLAUDE.md já orienta seguir sem ele quando indisponível.
