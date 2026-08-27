# Camada de referência: rodovias das concessionárias na aba Mapa (Alocação Equipes)

**Data:** 2026-08-27
**Status:** aguardando revisão do usuário

## Contexto

A aba Mapa de `docs/alocacao-equipes.html` (spec base:
`docs/superpowers/specs/2026-08-26-alocacao-equipes-mapa-design.md`, branch
`semanal-alocacao-mapa`) já está praticamente pronta: MapLibre + tiles Esri, pino por
SUP colorido pela leitura, popup, arrasto de equipe até o pino, coordenada vinda do
Patrick (Link 2). Commits recentes na branch confirmam isso funcionando
(`abb42a1 fix: coordenadas do Link 2 chegam ao mapa`).

O usuário pediu uma segunda informação geográfica, complementar (não substituta) à
coordenada de demanda do Patrick: **o traçado da rodovia de cada concessionária**,
como camada de referência — "essa informação é a referência de todo o local dos
clientes". As duas coisas convivem: pino = ponto de atuação da demanda; linha da
rodovia = território/identidade geográfica do cliente (concessionária).

**Fonte:** https://melhoresrodovias.org.br/mapa-de-concessoes/ (site da ABCR).
Investigado nesta sessão via `curl` com User-Agent de navegador (o WebFetch do Claude
tomou 403 — provavelmente bloqueio no proxy de fetch, não no site em si; `curl` puro
devolveu HTTP 200, ~7,2 MB) e via Playwright (MCP) para inspecionar a página renderizada.

Achado técnico: os dados NÃO vêm de um endpoint JSON/KML separado nem de fetch algum —
estão embutidos como literais JS dentro de um `<script>` inline, já no HTML servido
(confirmado também via `curl` puro, sem JS rodando: `const CONCESS = [` e
`const ROADS = [` aparecem no HTML bruto). Duas estruturas:

- `CONCESS`: 61 objetos `{ id, nome, slug, cor }` — uma por concessionária (ex.:
  `Sorocabana`, `Autoban`, `Fernão Dias`...). Bate com o padrão de nome que já aparece
  na memória do projeto (`SUP-8370-25 (Rota Sorocabana)`), reforçando que o "SUP" da
  MATRIZ corresponde à concessionária/rodovia do cliente.
- `ROADS`: 60 objetos `{ id, nome, slug, programa, extensao, concessionaria_id,
  conc_nome, conc_slug, cor, geojson }`, onde `geojson` é uma STRING contendo um
  `FeatureCollection` de `LineString`(s) com o traçado real da rodovia. Coordenadas
  vêm com precisão absurda (25+ dígitos, ex. `-46.7202809999999999490682967007...`) —
  puro artefato de serialização de ponto flutuante, sem significado além da 6ª/7ª
  casa decimal.

## Decisões

1. **Extração é um script Node puro, sem dependência nova.** `fetch`/`https.get` com
   um User-Agent de navegador comum basta — nenhum navegador headless necessário no
   pipeline (Playwright só foi usado nesta sessão, manualmente, pra investigar). Segue
   o padrão de nome já estabelecido: `tools/semanal/atualizar-concessoes-rodovias.js`.
2. **Roda manualmente, fora do live-refresh e fora de `atualizar-arquivos.js`.**
   Concessão rodoviária muda raríssimas vezes (leilão, término de contrato) — não faz
   sentido reprocessar um site externo de 7 MB a cada 30 minutos, e isso arrisca
   bloqueio/rate-limit no site de terceiro. Rodar de novo quando alguém notar uma
   concessão desatualizada.
3. **Coordenadas simplificadas para ~5 casas decimais** (≈1,1 m de precisão — mais que
   suficiente pra uma linha de referência visual) antes de gravar. Corta o tamanho do
   JSON drasticamente sem perda perceptível.
4. **`dist/concessoes-rodovias.json`**, formato `[{ id, nome, slug, cor, geojson }]`
   (um item por concessionária de `CONCESS`; `geojson` é `null` para as poucas sem
   trecho em `ROADS` — o seletor lista a concessionária mesmo assim, mas ela não
   desenha nada se escolhida). Publicado do mesmo jeito que os outros CSV/JSON da
   página (`cp dist/... docs/...`, versionado, `test/publicacao-docs-sincronizado.test.js`
   ganha mais um par a travar).
5. **Sem cruzamento automático SUP↔concessionária.** O usuário pediu um seletor NOVO,
   independente dos filtros existentes (não o filtro de SUP da barra, não o clique no
   pino) — o usuário escolhe manualmente a concessionária pelo nome. Fica fora de
   escopo casar `Tomador`/`SUP` da MATRIZ com `nome`/`conc_nome` do site — se um dia
   isso for pedido, é um resolvedor tolerante à parte (mesmo padrão de
   `coordenadas-sup.js`), não parte deste desenho.
6. **"Banco de dados" tem as 61; o mapa só desenha a(s) selecionada(s).** Nada aparece
   por padrão — o seletor novo (dropdown/checklist, reaproveitando o padrão de
   `montarFiltroMulti` de `tools/comum/render-shell.js`) lista as 61 por nome,
   ordenadas; marcar uma adiciona a camada, desmarcar remove.
7. **Carregamento sob demanda.** `concessoes-rodovias.json` não entra no HTML
   principal (embutir 61 traçados sempre, mesmo sem uso, infla a página à toa) — é
   buscado (`fetch`, mesma origem do Pages, sem CORS) na primeira vez que o seletor é
   aberto ou uma concessionária é marcada, e cacheado em memória depois disso.
8. **Paleta própria, cíclica, por ORDEM de seleção — não a `cor` do site, não uma cor
   única fixa.** Mudança pedida pelo usuário depois da primeira versão deste desenho:
   com seleção múltipla, as linhas precisam se diferenciar ENTRE SI, não só do resto
   do mapa. O desenho já em produção reserva dois canais de cor que não podem colidir:
   leitura/status do pino (`#f6b53f`/`#e0684f`/`#4f8ff0`/`#7fd858`) e tipologia do pool
   (`#3f851a`/`#2f6ad0`/`#8d6f00`/`#606060`/`#4a3aa7`/`#db244e`) — juntos já cobrem
   verde, azul, amarelo-oliva, cinza, roxo e vermelho-rosado. Usar a `cor` própria de
   cada concessionária (61 valores do site) não dá pra garantir isso: `#aa2e2e`/
   `#007a3d` do site colidem em cheio com o vermelho/verde de leitura.
   - **Paleta fixa e pequena** (6 a 8 tons), pensada pra não colidir com os dois
     canais acima — hues fora de verde/azul/amarelo-oliva/cinza/roxo/vermelho-rosado
     (candidatos: ciano/petróleo, magenta frio, marrom, azul-violeta bem distinto do
     `#2f6ad0`/`#4a3aa7` existentes). Tons exatos calibrados na revisão do Open Design
     (regra já existente no `CLAUDE.md` para qualquer HTML novo) — o ponto fechado
     aqui é a MECÂNICA de atribuição, não os hex finais.
   - **Atribuição por ORDEM DE SELEÇÃO, não identidade fixa da concessionária.** A
     1ª concessionária marcada pega a cor 1 da paleta, a 2ª pega a cor 2, e assim por
     diante; ao passar do tamanho da paleta, cicla (`indice % paleta.length`) — com 61
     concessionárias no banco mas uma seleção prática de poucas por vez (o caso de uso
     é comparar 2-5 clientes, não as 61 juntas), fixar 61 cores únicas de antemão seria
     trabalho sem benefício real. Desmarcar libera a cor; marcar de novo pode pegar
     outra posição na ordem — a cor não é uma identidade permanente da concessionária,
     é só um diferenciador dentro da seleção atual.
   - A legenda/rótulo de cada linha (popup ao clicar nela, ou um mini-legend perto do
     seletor) mostra o nome da concessionária ao lado da cor atribuída, pra não deixar
     a cor sozinha como única forma de identificação.

## Arquitetura

### Extração (`tools/semanal/atualizar-concessoes-rodovias.js`)

- `https.get`/`fetch` de `https://melhoresrodovias.org.br/mapa-de-concessoes/` com
  User-Agent de navegador.
- Regex/parse pra achar `const CONCESS = [...]` e `const ROADS = [...]` no HTML bruto
  (são literais JS válidos — `JSON.parse` funciona direto depois de isolar o array).
- Função pura `montarConcessoesRodovias(concess, roads)` → array combinado (Task de
  teste isolado, sem rede) — o parsing bruto do HTML é a única parte que precisa de
  rede, e fica fininho e não testado por unidade (mesmo padrão dos outros
  `atualizar-*-online.js`: a extração de rede não entra na suíte, só a lógica pura).
- Função pura `simplificarCoordenadas(featureCollection, casas=5)` — arredonda
  recursivamente todo par `[lon, lat]` de qualquer `LineString`/`MultiLineString`.
  Testável isoladamente com uma fixture pequena.
- Concessionária sem nenhum `ROADS` correspondente entra com `geojson: null` — nunca
  lança, nunca é descartada da lista (o seletor precisa listá-la mesmo assim).
- Grava `dist/concessoes-rodovias.json`.

### Aba Mapa (`render-aba-alocacao-mapa.js` + script cliente do mapa)

- Novo bloco de UI: seletor "Rodovias" (checklist multi, mesmo componente visual dos
  filtros existentes), fora da barra de filtros compartilhada — é um controle PRÓPRIO
  da aba Mapa, não afeta Kanban nem o resto da página.
- Cliente: ao marcar uma concessionária, se `concessoes-rodovias.json` ainda não foi
  buscado, busca e cacheia; localiza a entrada pelo `id`, e se `geojson` não for nulo,
  adiciona `map.addSource`/`map.addLayer` (tipo `line`) com a próxima cor livre da
  paleta cíclica (função pura `atribuirCorRodovia(idsMarcadosEmOrdem, paleta)` —
  reaproveitável em teste sem DOM/mapa nenhum). Desmarcar remove a layer/source
  correspondente E libera a cor pra próxima atribuição. Popup/legenda da linha mostra
  nome da concessionária ao lado da cor.
- Nenhuma mudança em `aplicarMovimento`/`resolverAlvoAlocacao`/dado de alocação — é
  puramente uma camada visual de contexto, não participa de nenhuma regra de negócio.

### Testes

- `simplificarCoordenadas`: casas decimais corretas, `LineString` e
  `MultiLineString`, não muta o objeto de entrada, tolera `geojson` ausente/`null`
  sem lançar.
- `montarConcessoesRodovias`: concessionária sem `ROADS` correspondente vira
  `geojson: null`; concessionária com mais de um trecho em `ROADS` mescla num
  `FeatureCollection` só.
- `atribuirCorRodovia`: 1ª seleção pega a cor 1; N seleções simultâneas pegam N cores
  distintas em ordem; ultrapassar o tamanho da paleta cicla (`indice % length`);
  desmarcar uma do meio da lista não embaralha a cor das que continuam marcadas.
- Wireup do seletor: marcar/desmarcar adiciona/remove a camada certa, com a cor
  correspondente (mesmo padrão de teste que a integração do pino com
  `resolverAlvoAlocacao` já usa, adaptado).
- Sem teste de rede ao vivo na suíte (`node --test`) — mesma convenção de todo
  `atualizar-*-online.js` deste projeto.

## Fora de escopo

- Cruzamento automático SUP ↔ concessionária (seletor é manual, por nome).
- Desenhar as 61 rodovias por padrão — só a(s) marcada(s) no seletor.
- Entrar no live-refresh (botão "Atualizar dados") ou em `atualizar-arquivos.js`
  (dado quase estático, atualização manual quando notado desatualizado).
- Uma skill/ferramenta genérica de extração de mapas para qualquer site — este
  desenho é específico para `melhoresrodovias.org.br` → aba Mapa da Alocação. Se um
  dia for pedida uma ferramenta reaproveitável para outros sites, é um pedido à parte,
  não uma generalização deste script.
- Revisão de Open Design ao vivo nesta etapa de brainstorming — roda como parte do
  plano de implementação, quando o CSS/markup da aba Mapa tiver a camada nova pra
  revisar de verdade (regra do `CLAUDE.md`: sempre em HTML, só não dá pra rodar em
  cima de uma spec, precisa do HTML de fato).
