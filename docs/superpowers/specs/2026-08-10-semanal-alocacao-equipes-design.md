# Aba "Alocação Equipes" — quadro interativo de equipes por contrato — design

Data: 2026-08-10
Página: `docs/planejamento-semanal.html` (sétima aba)

## O pedido

Um painel interativo, tipo kanban, onde a equipe é **arrastada** para o contrato (SUP).
A equipe é um ícone com o ID e o líder, com a tipologia destacada por cor. O objetivo é
alocar recurso respeitando as prioridades do planejamento da semana, tomando como
referência a **tendência por SUP** que a página já calcula. Depois de colocado o recurso,
duas leituras: por equipe (quanto de demanda está alocada, se está sobrecarregada) e por
SUP (se a demanda esperada da semana foi absorvida, ou se há demanda no contrato para
antecipar execução).

O projeto semanal tem três etapas em sequência: **input do realizado → replanejamento pela
tendência → alocação das equipes**. Esta aba é a terceira.

Decisões tomadas pelo dono do projeto durante o brainstorm (2026-08-10):

1. A alocação é gravada numa **planilha Google** (não só no navegador) — todo mundo que
   abrir vê a mesma alocação.
2. A carga da equipe sai da **premissa de produtividade** da MATRIZ, sem nenhum número
   digitado à mão.
3. A unidade é a **semana inteira, um SUP por equipe** — o cartão vive em exatamente uma
   célula.
4. A prioridade das linhas é **automática, pela tendência**.
5. O layout é a **matriz SUP × tipologia**, não colunas de kanban ("no projeto semanal a
   importância é a matriz de demanda e recursos").
6. A carteira de demandas aparece **em toda célula, mesmo sem previsão de atacar**, e o
   aviso de "dá pra colocar recurso" tem **condição**.
7. A referência é **sempre a Tendência recalculada e travada na semana**, nunca a linha do
   Previsto (P).
8. Popup ao passar o mouse na equipe, com a composição — **só com o que a aba EQ já traz**
   (item B da escolha: sem espelhar a aba PESSOAS).

## Ponto de partida: o que já existe

Nada aqui é fonte de dados nova. Tudo já está no cliente:

- **Roster de equipes** — a Sheet espelho da aba EQ (`URL_ESPELHO_EQ`, mês corrente,
  atualizada a cada 30 min pelo Apps Script). 117 equipes em 2026-08-10, colunas
  `ID | Equipe | Habilitação | Serviços | Líderes | Veículo | Proprietário | Equipamento ×5 |
  Tenda | Tomador | sinalização 3P | <uma coluna por dia>`. O build já a busca
  (`buscarEspelhoEq`) **e o live-refresh também** (`URL_ESPELHO_EQ_SEMANAL`,
  `render-semanal.js:1291`).
- **Estado do dia de cada equipe** — `classificar-dia-equipe.js` devolve
  `mobilizada | campoSemFuro | fora | naoEquipe` e **extrai a OS** da célula.
- **OS → SUP** — montado em `montarEquipesAtivas` (`build-dashboard.js`) a partir do Avanço
  Sond. Medido: 1.960 de 1.960 OS resolvem para um SUP.
- **Tendência por (SUP, tipologia) e por semana** — `calcularSeriesSemanaisDimensao`
  (`render-aba-semanal.js`), com o ramo e o diagnóstico de
  `compute-tendencia-semanal.js`.
- **Carteira em aberto por (SUP, tipologia)** — `pendentesNaData` sobre
  `demandas.porRegistroEventos`, o mesmo insumo do Alerta A.
- **Premissa de produtividade** — `premissaProdutividadeDoGrupo`
  (`render-alertas-tendencia.js`) e `diasPremissaRestantes`
  (`compute-alertas-tendencia.js`).

Escala real medida em 2026-08-10 (agosto/2026): **17 SUPs** com volume previsto,
**117 equipes** no roster, e o volume anual por tipologia é
`ST 15.217 · SP 8.777 · PI 3.135 · SM/SM.F/SR 2.663 · SH 321 · VT 221 · CPTu 220 · BL 17`
(mais LAB.C/LAB.E, que não têm equipe de campo nesta aba).

## Decisão 1 — o layout é a matriz (SUP × grupo de tipologia)

Linhas = SUP. Colunas = **grupo de tipologia de equipe**. Cada célula é uma área de
soltura e o par (SUP, tipologia) é literalmente a chave que a MATRIZ, o Balanço e a
tendência já usam.

### Os grupos de tipologia

A coluna `Serviços` da aba EQ tem 9 valores distintos hoje. O mapa para as tipologias da
MATRIZ:

| `Serviços` (aba EQ) | equipes | Coluna(s) que aceita |
|---|---|---|
| `SM` | 45 | `SM / SM.F / SR` |
| `SP` | 43 | `SP` |
| `ST` | 6 | `ST` |
| `PI` | 6 | `PI` |
| `CPTu \| VT \| SH` | 7 | **Especiais** (CPTu + SH + VT) |
| `ST \| PI \| BL` | 6 | `ST`, `PI`, `BL` — **polivalente** |
| `SP/SM` | 1 | `SP`, `SM / SM.F / SR` — **polivalente** |
| `Lab` | 1 | fora do quadro |
| `TST` | 2 | fora do quadro |

**Especiais junta CPTu + SH + VT numa coluna só**, decisão explícita do dono do projeto, e
as 7 equipes dela são polivalentes dentro dela.

**BL fica em coluna própria, não dentro de Especiais.** As equipes `ST | PI | BL` atendem
BL; enfiar BL em Especiais criaria uma coluna que as equipes dela (CPTu/VT/SH) não podem
servir. Na prática a discussão é teórica — BL tem 17 furos no ano inteiro, e a coluna
some sozinha quando zerada (ver Decisão 6).

**Equipe polivalente é decisão humana, não inferência.** As 6 de `ST | PI | BL` e a de
`SP/SM` podem ser soltas em qualquer coluna do conjunto delas, e aparecem com contorno
tracejado. Isso substitui, para efeito desta aba, a heurística de `casarSondador`
(`compute-equipes-ativas.js`), que cruza o nome do líder com o do sondador do Avanço Sond
e falha em 25 das 117 equipes, com 6 ambíguas. Arrastar responde melhor que qualquer
casamento de nome.

`Lab`, `TST` e `SN` ficam fora do quadro: laboratório tem fonte própria e não é equipe de
campo de sondagem; TST/SN não têm demanda correspondente na MATRIZ. Elas não somem em
silêncio — aparecem numa lista recolhida "fora do quadro (3)" abaixo do pool, com o
motivo.

### Bug de tabela corrigido junto

`TIPOLOGIA_DIRETA['CPTu | VT | SH'] = 'Especiais'` e, logo depois,
`traduzir()` chama `rotularTipologia('Especiais')` — que **lança**, porque `ESPECIAIS` não
é chave de `MAPA_TIPOLOGIAS`. O `try/catch` de `traduzir` engole a exceção e devolve
`null`, então **as 7 equipes de Especiais contam hoje como `semTipologia`** e ficam fora
da conta de equipes ativas do Balanço. A aba nova depende do mesmo mapa, então a correção
entra junto: `Especiais` passa a ser reconhecido como grupo, com as três tipologias da
MATRIZ que ele cobre.

## Decisão 2 — a demanda da célula é a Tendência TRAVADA

A célula mostra a **tendência de volume daquele (SUP, tipologia) para aquela semana**,
congelada no início da semana. Nunca a linha do Previsto.

O congelamento é o mecanismo que a aba Consolidado já usa
(`2026-08-04-semanal-consolidado-congelado-e-ativos-design.md`):
`calcularSeriesSemanaisDimensao` chamada com `hojeEpoch = semana.inicio`. Naquela
recomputação a semana escolhida vira a vigente, e o valor devolvido é a projeção que se
fazia para ela inteira ao começar.

- Semana **já começada** → travada em `semana.inicio`.
- Semana **futura** → nada a travar; usa a projeção viva (`hojeEpoch` real).
- Mês inteiramente no passado → há tendência travada (registro histórico), pelo mesmo
  raciocínio que faz o Consolidado ser exceção deliberada à regra 2.1.

**Congelar é RECÁLCULO, não snapshot.** Um lançamento retroativo no Avanço Sond muda um
número já "travado". É reprodutível, não imutável — mesmo preço que o Consolidado já
aceitou. Snapshot de verdade exigiria persistência de série, que este repositório não tem.

**A carteira usa a MESMA data-âncora da tendência.** Tendência travada em segunda-feira
somada a carteira medida hoje daria um saldo que não fecha com nada. Âncora única por
semana: `semana.inicio` se já começou, `hoje` se não.

## Decisão 3 — a conta de capacidade e carga

```
dias_premissa_semana(equipe) = DIAS_PREMISSA_MES[mês] × dias_disponíveis(equipe) ÷ dias_do_mês
capacidade(equipe)           = PROD_premissa(célula) × dias_premissa_semana(equipe)
carga(equipe)                = tendência(célula) × capacidade(equipe) ÷ Σ capacidades da célula
ocupação(equipe)             = carga ÷ capacidade
```

- **`PROD_premissa` vem de `premissaProdutividadeDoGrupo`**, a média das premissas `PROD.`
  da planilha ponderada pelo volume previsto — **nunca** de `produtividadeEsperada()` do
  Consolidado. O `CLAUDE.md` registra por quê: para grupo agregado aquela recalcula
  `V/(E×D)`, e na álgebra `E` e `D` se cancelam, fazendo a conta deixar de medir equipe.
  Aqui o defeito seria pior ainda: `E` é justamente o que o quadro está decidindo.
- **Os dias saem da premissa, não do calendário** (`diasPremissaRestantes`, mesma base dos
  alertas de tendência). Usar dias de calendário faria esta conta discordar da coluna
  "Produtividade média esperada" do Consolidado. `dias_do_mês` é a soma de
  `diasNaSemana(semana)` sobre `semanasDoMes` — o mesmo `diasDoMesNasSemanas` que
  `render-alertas-tendencia.js` já monta, e **não** o número de dias do calendário: as
  semanas são sempre cortadas dentro do mês, e os dois só coincidem por acidente.
- **`dias_disponíveis`** é quantos dias da semana a equipe não está `fora`/`naoEquipe`
  (`classificarDiaEquipe`). Equipe fora a semana toda não é arrastável.
- **O rateio é ponderado por capacidade, não igualitário.** Quando todo mundo está inteiro
  na semana as capacidades são iguais (mesma célula ⇒ mesma premissa) e o rateio degenera
  em divisão igual, como deve. Com uma equipe de 3 de 5 dias, ela puxa menos — que é o
  ponto.

Faixas de ocupação: `< 85%` folga (azul) · `85–105%` equilibrada (verde) · `> 105%`
sobrecarregada (vermelho). Equipe não alocada: 0%, cinza.

## Decisão 4 — a demanda é avaliada em três níveis

Nenhum substitui o outro.

**Nível 1 — faixa no topo da aba.** Tendência da semana, capacidade alocada, saldo,
carteira em aberto e capacidade ociosa. **Capacidade ociosa** = Σ das capacidades das
equipes não alocadas, mais Σ de `capacidade − carga` das alocadas com ocupação < 100%;
equipe sobrecarregada contribui zero, nunca negativo (senão a folga de umas mascararia o
excesso de outras). "Ociosa" e "descoberto" convivem sem contradição: são tipologias
diferentes, e é por isso que a leitura desce para a célula.

**Nível 2 — resumo por SUP.** Ramo da tendência, tendência da semana, capacidade alocada,
saldo, cobertura, carteira em aberto e **"semanas de carteira"** (carteira ÷ tendência
semanal): quanto tempo o contrato aguenta no ritmo atual. Cinco leituras:

As cinco são avaliadas **nesta ordem, e a primeira que casar vence** — sem isso um SUP
com tendência 0, carteira alta e uma equipe solta ali cairia em duas ao mesmo tempo:

| # | Leitura | Condição |
|---|---|---|
| 1 | `Parado c/ carteira` | tendência = 0 **e** carteira > 0 |
| 2 | `Sem equipe` | tendência > 0 **e** nenhuma equipe alocada |
| 3 | `Falta equipe` | saldo < 0 |
| 4 | `Antecipar N` | saldo > 0 **e** carteira > 0 |
| 5 | `Absorvido` | qualquer outro caso com tendência > 0 |

`saldo = capacidade alocada − tendência`. Tendência = 0 e carteira = 0 não é leitura
nenhuma: a linha não existe no quadro.

**`Parado c/ carteira` é o estado que o pedido criou.** Um SUP sem nenhuma previsão na
semana mas com furos represados entra no quadro **só** por causa disso — antes não seria
nem linha. Sem tendência não há ritmo, então "semanas de carteira" fica `∞`, não zero.

**Nível 3 — resumo por equipe.** Carga, capacidade, ocupação e situação. A última coluna é
onde a demanda encosta na equipe: uma equipe livre não diz só "0%", diz **"3 SUPs com
carteira SM"** — a ponta que fecha o ciclo com o aviso da matriz.

### O aviso de antecipação e sua condição

Célula com carteira > 0 e sem tendência recebe a moldura azul "dá pra antecipar" **somente
quando existe equipe do grupo com ocupação abaixo de 100%** (livre no pool ou com folga).
Sem equipe livre, a carteira aparece igual, mas o aviso fica cinza e mudo — informar sem
convocar para uma ação impossível. Foi pedido explicitamente: "avaliar a condição de aviso
de possibilidade de colocar o recurso".

## Decisão 5 — a prioridade não reage ao arrasto

A ordem das linhas sai do **diagnóstico da tendência**: ramo `R < P` primeiro, por saldo
decrescente; depois `R ≈ P`; depois `R > P`; por último os `Parado c/ carteira`, por
carteira decrescente.

**É propriedade do dado, não da alocação.** Se a ordem fosse recalculada a cada equipe
solta, as linhas pulariam debaixo do cursor no meio do arrasto. Estável por construção,
sem precisar de trava nem de botão de reordenar.

## Decisão 6 — a interação

Arrastar de verdade, no HTML gerado, recalculando na hora.

- **Pointer Events, não o drag-and-drop nativo do HTML5.** O nativo é menos código mas não
  funciona em toque nenhum — morre num tablet. Pointer Events cobre mouse e dedo pelo mesmo
  caminho e deixa o cartão-fantasma seguir o cursor.
- **Atalho de clicar-para-selecionar e clicar-para-soltar**, mais rápido quando já se sabe
  o destino, e o caminho acessível por teclado.
- **Ao começar o arrasto, as células válidas acendem** e as demais esmaecem. Célula fora do
  grupo da equipe **recusa** a soltura, com o motivo aparecendo por um instante. Célula
  hachurada (sem tendência) **dentro do grupo aceita** — é o caso de antecipar carteira.
- **Ao soltar, tudo recalcula em um passo**: número e barra da célula, status, linha do SUP,
  linha da equipe, totais do topo, e os avisos azuis de **todas** as células — tirar uma
  equipe do pool muda a condição de aviso no quadro inteiro.
- **A gravação acontece depois do redesenho**, em segundo plano. A tela nunca espera a rede.
- **Coluna zerada some.** Coluna cuja tendência e carteira somam zero em todos os SUPs
  visíveis não é desenhada (é o caso de BL na maior parte do ano). Uma coluna com equipe
  alocada nunca some, mesmo zerada — senão o cartão desapareceria da tela.

Zero biblioteca: o projeto não tem `npm install` e não passa a ter por causa disso.

## Decisão 7 — o popup da equipe

Ao passar o mouse no cartão, um popup com a composição — no espírito do que a Matriz de
Controle faz (lá é `title` nativo com a lista de colaboradores, ver `colaboradoresTitleAttr`
em `tools/matriz/render-dashboard.js`).

**Só com o que a aba EQ já traz** (escolha do dono do projeto): ID, líder, habilitação,
tipologia, veículo + proprietário, os 5 kits de equipamento, tenda, tomador atual,
sinalização 3P, mais capacidade e ocupação calculadas. **Sem os nomes do efetivo** —
esses vivem na aba PESSOAS da planilha de equipes, que esta página não espelha, e
espelhá-la ficou fora de escopo.

Popup próprio (não `title` nativo): o conteúdo tem estrutura e cor, e o `title` atrasa
~1s antes de aparecer, o que atrapalha um quadro que se lê varrendo.

## Decisão 8 — persistência na planilha

Sheet nova, aba `ALOCACAO`, **uma linha por `(ano, semanaInicio, equipeId)`**:

```
ano | semanaInicio (yyyy-mm-dd) | equipeId | sup | tipologia | autor | atualizadoEm (ISO)
```

Web app do Apps Script (`tools/semanal/apps-script-alocacao.gs`), no mesmo estilo dos dois
que já existem, com instruções de setup no topo do arquivo:

- **`doGet` devolve JSON fresco**, sem cache. Publicar a aba como CSV — como as outras três
  fontes — não serve aqui: o CSV publicado é cacheado por minutos, e num quadro
  colaborativo isso significa ver a alocação de outra pessoa desatualizada sem saber.
- **`doPost` grava um movimento**, não o quadro inteiro. Duas pessoas mexendo em equipes
  diferentes não se atropelam; só a mesma equipe colide, e aí vence a última escrita. A
  resposta devolve as linhas daquela semana e o cliente reconcilia.
- **`Content-Type: text/plain;charset=utf-8`** com JSON no corpo, lido em
  `e.postData.contents`. É requisição simples: sem preflight `OPTIONS`, que o Apps Script
  não sabe responder.

**Segurança, dita com todas as letras:** a URL do endpoint vai **dentro do blob cifrado**,
não em texto puro no HTML — só quem destrava a página a enxerga. Ainda assim, **quem tem a
senha pode gravar**. É o mesmo nível de confiança de quem já vê os dados, e não há como
elevá-lo sem autenticação de verdade, que esta página não tem.

**Caminho degradado, e ele é o estado inicial.** Enquanto o script não for publicado, o
literal fica `PENDENTE-...` (mesmo padrão de `RE_URL_PENDENTE`, já coberto por teste nesta
página): a aba roda inteira em `localStorage`, e o status diz isso. Assim ela nasce
funcionando no primeiro build, antes de qualquer configuração no Google.

`localStorage` continua sendo usado mesmo com a Sheet ligada, como cache e **fila de
movimentos não gravados**. Falha de rede não desfaz o que está na tela: o movimento entra
na fila e o status mostra "1 movimento não gravado", com botão de tentar de novo.

## Decisão 9 — o quadro nasce preenchido com o realizado

Ao abrir uma semana sem alocação salva, o quadro é semeado com **onde as equipes estão de
fato**: a última OS vista naquela semana na aba EQ → SUP (mesmo vínculo que
`agregarEquipesAtivas` já monta, inclusive a regra de "vale a última OS vista" nos dias
ativos sem OS). Equipe sem nenhuma OS na semana nasce no pool.

Botão **"Repor o realizado"** refaz isso a qualquer momento, e **"Limpar alocação"** esvazia.
Os dois pedem confirmação quando há alocação salva — são as duas únicas ações destrutivas
da aba.

Isso é o que amarra a aba à primeira etapa do ciclo semanal: você começa ajustando o que já
é, não digitando do zero.

## Arquitetura

Módulos novos em `tools/semanal/`:

| Arquivo | Papel |
|---|---|
| `compute-alocacao.js` | **Puro, sem DOM.** Recebe registros + índices + semana + demandas + equipes + alocação; devolve células, resumo por SUP, resumo por equipe e totais. É o que os testes exercitam e o que o handler de soltura chama. |
| `equipes-alocaveis.js` | Do roster cru da aba EQ para equipes do quadro: grupos de tipologia, dias disponíveis, SUP realizado da semana, campos do popup. |
| `render-aba-alocacao.js` | Markup, Pointer Events, popup, estados visuais. Padrão de `render-aba-balanco.js`. |
| `alocacao-sheet.js` | Cliente do endpoint: ler, gravar, fila, modo degradado. Testável com `fetch` falso. |
| `apps-script-alocacao.gs` | O script e o passo a passo de setup. |

`compute-alocacao.js` e `equipes-alocaveis.js` rodam **no Node e no navegador**: `var`/
`function`, requires no formato exato que `browser-bundle.js` reconhece (mesmo diretório,
`./arquivo.js`).

Mudanças em arquivos existentes:

- `build-dashboard.js` — embutir o roster da aba EQ no payload cifrado (`demandas.equipesRoster`),
  a partir do CSV que ele **já busca**. Sem fonte nova, sem requisição nova.
- `render-semanal.js` — sétima aba em `ABAS_VISUALIZACAO`, ícone próprio, `montarAbaAlocacao`,
  e reconstrução do roster no live-refresh a partir do CSV da EQ que ele **já baixa**
  (`render-semanal.js:1363`).
- `compute-equipes-ativas.js` — a correção de `Especiais` descrita na Decisão 1.

### Integração com a barra compartilhada

- **Os filtros multi-select valem** (SUP, tomador, tipologia, origem, categoria): recortam
  por propriedade do registro, que é o que a grade indexa.
- **O seletor de dimensão é ignorado** — a aba é sempre volume (furos). Emite nota na tela
  quando a dimensão marcada é outra, igual ao que Alertas e Consolidado já fazem.
- **"Somente SUPs ativos" NÃO se aplica**, junto com Gráficos e Demandas. Ele decide por
  registro, com o mês inteiro e o evento `sondagemRealizada` — esconderia exatamente as
  linhas `Parado c/ carteira` que o pedido mandou mostrar.
- **O seletor de semana é próprio da aba** (S1..Sn do mês selecionado), como o do Balanço.

## Limites que precisam aparecer na tela

- **O espelho da aba EQ só traz o MÊS CORRENTE.** Semana de outro mês não tem roster: a aba
  avisa e fica somente-leitura, sem quadro. Fácil de esquecer, e sem o aviso vira um quadro
  vazio inexplicável.
- **Sem a Sheet espelho da EQ, não há aba.** Se `buscarEspelhoEq` falhar no build e o
  refresh também, a aba mostra o motivo e nada mais. Nunca cai num quadro vazio que pareça
  "nenhuma equipe alocada".
- **Congelar é recálculo, não snapshot** — repetido aqui porque é o que mais confunde
  quem lê um número travado que mudou.

## Testes

Novos:

- `test/semanal-compute-alocacao.test.js` — grade, capacidade, rateio ponderado, ocupação,
  os cinco estados de leitura por SUP, aviso condicional (acende com equipe livre, mudo sem),
  polivalente em cada coluna do conjunto, disponibilidade parcial, e a âncora única de
  tendência + carteira.
- `test/semanal-equipes-alocaveis.test.js` — roster, os 9 valores de `Serviços`, `Lab`/`TST`
  fora do quadro com motivo, última OS → SUP (inclusive o dia ativo sem OS herdando a
  anterior), semana toda `fora` ⇒ não arrastável.
- `test/semanal-alocacao-sheet.test.js` — `fetch` falso: upsert, remoção, reconciliação da
  resposta, caminho `PENDENTE-`, fila offline e nova tentativa.
- `test/semanal-render-aba-alocacao.test.js` — markup: dropzones com `data-sup`/`data-tipologia`,
  cartões com `data-equipe`, coluna zerada ausente, coluna zerada COM equipe presente,
  popup, e a nota de dimensão coagida.

Prendendo o que já existe:

- **Invariante que amarra a aba ao resto:** com a alocação vazia, a soma da tendência de
  todas as células da grade tem de bater com a linha da semana na Tabela Semanal, para o
  mesmo conjunto de índices. Se divergir, alguém trocou a fonte de um dos dois.
- `test/publicacao-docs-sincronizado.test.js` já trava a cópia para `docs/` e continua valendo.
- A correção de `Especiais` precisa de asserção em `test/semanal-equipes-ativas.test.js`
  (ou equivalente): as 7 equipes deixam de contar como `semTipologia`.

## Fora de escopo

- **Espelhar a aba PESSOAS** para trazer os nomes do efetivo ao popup. Decidido item B.
- **Alocação por dia** da semana. A unidade é a semana inteira; a granularidade diária foi
  considerada e recusada.
- **Equipe em mais de um SUP** na mesma semana.
- **Logística (veículos, equipes que andam juntas, líderes)** — o dono do projeto pediu
  explicitamente para tratar isso **depois**, e **na aba Veículos do dashboard Matriz de
  Equipes**, com viés analítico e de controladoria. Não é desta aba, não é deste repositório.
  Os campos de veículo/proprietário/carona já estão no popup, o que serve de ponte quando
  esse trabalho começar.
- **Realocação automática / sugestão algorítmica.** O quadro informa; quem decide é quem
  arrasta.
