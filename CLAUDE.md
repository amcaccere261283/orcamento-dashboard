# Contexto para o Claude Code — Dashboard de Orçamento

Repositório próprio (`orcamento-dashboard`), independente do `matriz-equipes-source`,
embora normalmente clonado dentro da pasta dele. Publicado em
https://amcaccere261283.github.io/orcamento-dashboard/.

## Build e testes

```bash
ORCAMENTO_SENHA='...' node tools/orcamento/build-dashboard.js   # gera dist/orcamento-dashboard.html
node --test test/*.test.js                                      # testes usam senha falsa
```

Duas dependências de máquina, ambas fora do git:

- **`ORCAMENTO_SENHA`** — o blob de dados embutido no HTML é cifrado em AES-256-GCM com
  essa senha. Como o HTML gerado vai para um Pages público, a senha **nunca** pode ser
  escrita em arquivo do repositório (código, config, docs ou qualquer outro) — só env var,
  no momento do build. Peça o valor ao dono do projeto.
- **As planilhas de origem**, em caminhos `G:\Meu Drive\PMO\...` (ver
  `tools/orcamento/config.js`): a MATRIZ viva e o estudo de linha de base. Exige o Google
  Drive montado em `G:` com acesso à pasta PMO.

## O HTML é gerado — não edite o build

`dist/orcamento-dashboard.html` e `docs/index.html` são produzidos por
`tools/orcamento/render-dashboard.js` (que emite CSS + markup + JS de cliente como
template literals) e montados por `build-dashboard.js`. Editar o HTML pronto — inclusive
pelo Open Design — não dura: a próxima reconstrução regenera tudo e apaga a alteração.

Porte qualquer ajuste de design para `render-dashboard.js`. Para verificar, construa com
uma senha qualquer num arquivo temporário e compare com o alvo ignorando a linha
`__DADOS_CIFRADOS__` e o timestamp `Gerado em` — o resto deve bater byte a byte. Crases
dentro das strings de JS de cliente precisam ser escapadas (`` \` ``).

## O Pages serve `/docs`, não `/dist`

A configuração do Pages é `{"branch":"master","path":"/docs"}`. O build só escreve em
`dist/` — nada copia para `docs/` automaticamente. **Depois de todo rebuild destinado a
deploy, rode `cp dist/orcamento-dashboard.html docs/index.html` e commite os dois juntos.**

Em 2026-07-22 esse passo foi esquecido: o build do Pages reportou "built" (ele publica o
que estiver em `/docs`, independente de `dist/` ter mudado), dando falsa confiança, e o
site ficou servindo um build de dois commits antes. Ao verificar um deploy, não confie só
no status da API de builds — faça `curl` na URL ao vivo e confira se o "Gerado em" bate
com o `dist/` recém-construído.

## Pendência conhecida: aba Gerencial

Uma 3ª aba (além de Tabela/Gráfico) foi investigada e **adiada** pelo usuário em
2026-07-22 ("voltamos a esse assunto depois"). Não comece até ele retomar. Quando
retomar, parta destas descobertas em vez de investigar de novo:

- Fonte: `G:\Meu Drive\PMO\06 - Orçamento\OR26 - Rev 01 - Frcst 6+6\Dados e extratos\Gerencial Semanal - Juvencio.xlsx`
  (atenção: **não** é a pasta `02 - Atualizações` — um caminho errado em cache já causou
  um loop de `ENOENT` que travou uma sessão inteira).
- A aba `GERENCIAL` é uma PivotTable nativa e serve só como **referência visual** ("o
  modelo"), confirmado pelo usuário — não é a fonte de dados.
- Os dados estão na aba **`B.Dados`**: tabela limpa, uma linha por (Id Contrato, Tipo
  Sondagem) × mês. Colunas: `Id Contrato, Tipo Sondagem, Base(P/R/T), Valor, Mês ref
  (serial Excel), Tipo Custo(VOLUME/FINANCEIRO), Tipo Gerencial(Sondagem/Lab), Sup, Tipo,
  TM, TM 2, TM VALIDAR, Tipo Ensaio, TIPO LAB`.
- `Mês ref` é **mensal**, cobrindo 2026-01-01 a 2026-12-01 (seriais 46023..46357) — mesma
  granularidade da aba MATRIZ existente, não semanal.
- Pergunta ainda em aberto, feita e não respondida: dado que a granularidade é mensal, o
  usuário quer mesmo mensal (recomendação, reaproveita quase toda a pipeline da aba
  Gráfico) ou outra coisa? Pergunte de novo ao retomar, não assuma.
- `tools/orcamento/config.js` e `parse-matriz.js` só conhecem a MATRIZ atual: essa fonte
  precisa de caminho próprio e parser novo — reaproveitaria `readXlsxSheet`/`listZipEntries`
  de `xlsx-reader.js`, mas não `parse-matriz.js`.

## Planejamento Semanal (segunda página, publicada em 2026-07-29)

`docs/planejamento-semanal.html` — aba 1 com o mês vigente dividido em semanas reais
(segunda a domingo, cortadas SEMPRE dentro do mês -- nenhum dia de um mês conta no
acompanhamento do mês vizinho; ver `tools/semanal/compute-semanal.js` e
`docs/superpowers/specs/2026-07-30-semanal-calendario-iso-design.md`), aba 2 com o
gráfico Balanço de massa (barras divergentes por tipologia). Build:
`ORCAMENTO_SENHA='...' node tools/semanal/build-dashboard.js`, e **sempre**
`cp dist/planejamento-semanal.html docs/planejamento-semanal.html` antes de commitar.
`test/publicacao-docs-sincronizado.test.js` trava essa cópia para as duas páginas.

### Recortes de tempo das abas 2 e 3 (2026-08-03)

**Aba Gráficos, painel Acumulado**: o Realizado morre na semana em curso (antes seguia
reto até o fim do mês, porque `semanasRealizado` traz 0 — não null — nas semanas futuras)
e a Tendência nasce nesse ponto, no valor acumulado do Realizado, só subindo depois da
semana em curso. O ponto de junção não desenha marcador/rótulo da Tendência
(`indiceConector`, mesmo mecanismo do Gráfico do orçamento). O par
`cortarAcumuladoNasElapsadas`/`calcularAcumuladoAposElapsadas`
(`compute-grafico-semanal.js`) é o porte do que o orçamento já fazia por mês, com uma
diferença: lá o corte é descoberto nos valores, aqui vem de `semanasElapsadas` — há
calendário, então uma semana fechada que terminou em 0 furos não é confundida com "não
reportado". **Invariante**: o ponto final da curva continua igual ao Fechamento da Tabela
Semanal.

**Aba Balanço de massa, recorte por semana**: uma caixa por semana real do mês
(`semanasDoMes`, 4 a 6), marcáveis independentemente. Realizado é recortado por DATA (os
furos do Avanço Sond têm data — `realizadoDoAvancos` recebe uma lista de janelas); a base
mensal é repartida por DIA via `dividirEmSemanas`; Equipes não se reparte (é foto). Nada
marcado = mês inteiro, e todas marcadas cai no mesmo caminho, então o número fica bit a
bit igual ao de antes do recurso. Fora de "Mês vigente" o grupo aparece desabilitado e o
cálculo ignora a seleção.

**A aba Balanço passou a seguir o seletor de mês** (2026-08-03) — antes ficava presa a
`window.__VIGENTE_IDX__` enquanto as outras três abas usavam `mesSelecionadoIdx`, então
trocar o mês mudava três abas e deixava a quarta descrevendo outro período sem avisar. Por
isso o rótulo do controle é **"Mês selecionado"**, não mais "Mês vigente" (o `value`
continua `'mesVigente'`: é identificador de modo, não texto de tela). `vigenteIdx` e
`semanas` em `montarAbaBalanco` têm que sair SEMPRE do mesmo índice — separados, o recorte
S1..Sn descreveria as semanas de um mês e recortaria o dado de outro.

O subtítulo do cabeçalho (`formatarMesAno(geradoEm)`) continua sendo a data de GERAÇÃO do
build, não o mês selecionado. Parece o mês do relatório e não é — mas é a única pista de
recência que a página tem (ver a pendência do carimbo "Gerado em" abaixo), então não vale
trocar sem antes resolver aquela.

A casca visual (`tools/comum/render-shell.js`) e os utilitários são compartilhados com o
orçamento. `cssBase()` **não** é uma base neutra: cerca de 79 das 254 linhas são CSS
exclusivo do orçamento, que a página semanal herda sem usar. Dividir exigiria regenerar o
golden de propósito — está documentado no topo do próprio módulo.

**A reconciliação da linha de base vive em `tools/comum/linha-base.js`**, e as duas páginas
passam por ela. Não monte a chave `sup||tipologia` crua: `LAB.C` e `LAB.E` têm nomes
diferentes no estudo, e 7 SUPs foram renomeados. Sem os mapas, 68 das 340 linhas viram
"sem base", indistinguível de "contrato entrou depois do estudo" — foi o Critical que a
revisão final pegou.

### Aba Demandas (base do Avanço Sond)

Terceira aba da página semanal, alimentada por
`Dados e extratos\Extratos Sond\Avanço Sond.xlsx`, aba `Avanços` (51.819 linhas úteis em
2026-08-03, uma por furo, já descontados 10.427 deslocamentos) — ver
`tools/semanal/config-demandas.js`. É a única fonte de EXECUÇÃO do repositório; as outras
duas são mensais. Cinco séries em quantidade de furos, mensal e acumulado.

Quatro coisas desta planilha que parecem bug e não são:

- **A coluna `P` (Cancelamento) é a data real do cancelamento, gravada como TEXTO
  `dd/MM/yyyy`** — a única data da aba que não é serial Excel. `Number()` nela devolve `NaN`.
  É exatamente essa armadilha que fez uma sondagem inicial concluir que a coluna estava
  vazia, e o spec chegou a declarar `Q` (Atualizado) como âncora proxy das canceladas. `Q`
  não serve: a linha 22 foi cancelada em 27/02/2025 e tem `Q` = 19/12/2025.
- **Nenhuma das 811 linhas EXECUTADO tem data de Conclusão**, e nenhuma das 50.662 CONCLUIDO
  está sem ela. A série de relatório filtra por `status = CONCLUIDO` de propósito: o status é
  que carrega o significado da etapa, e a planilha pode passar a preencher `O` em linha
  EXECUTADO sem avisar.
- **Pendentes é estoque, não fluxo:** no acumulado mostra o saldo do mês, nunca a soma, e
  fecha em "Saldo" nos dois modos. Cancelada sai do saldo pela DATA do cancelamento, não por
  status — um furo cancelado em julho estava aberto em janeiro.
- **Furos CONCLUIDO/EXECUTADO sem data de término nunca saem do estoque** pela regra de
  data, e por isso engordam o saldo de dezembro. Eram 74 em 2026-07-30; na planilha de
  2026-08-03 são 0 (os que faltavam eram deslocamentos, hoje descartados antes da conta).
  O build reporta a contagem — se ela voltar a subir, é aqui que a diferença aparece.

`tools/comum/tipologias-avancos.js` mapeia os 20 rótulos crus nos 10 da MATRIZ mais
`SP.F`/`SM.A` (independentes), `SEG.A`/`SEG.V` (só quando acionadas) e `Especiais`. Rótulo
novo **falha o build de propósito** — não caia calado em Especiais.

**Para medir esta planilha, use `readXlsxSheet` do próprio repositório, nunca um leitor
improvisado.** Os números da primeira versão do spec vieram de um script de sondagem cujo
regex de célula era guloso (`[^>]*` engole a barra de `<c r="M9" s="5"/>` e devora a célula
seguinte), e duas decisões de design foram tomadas em cima deles. Está registrado no bloco
"Correção de 2026-07-30" do spec.

### Botão "Atualizar dados" (live-refresh, 2026-07-31)

A página semanal ganhou o mesmo botão que o orçamento já tinha: busca CSVs
publicados ao vivo (MATRIZ -- mesma Sheet espelho do orçamento -- e Avanço
Sond, via `tools/semanal/apps-script-espelho-avancos.gs`, Apps Script novo)
e recalcula tudo no navegador, sem precisar de um novo build/publish. Ver
`docs/superpowers/specs/2026-07-31-semanal-atualizar-dados-design.md` pro
desenho completo. `window.__BASELINE__` nunca é tocado pelo refresh -- ao
contrário do orçamento, a semanal mantém a linha de base separada dos
registros desde sempre, então não precisa do transplante de
`previstoInicial` que o orçamento precisa.

**Ligado em 2026-08-03** — o Apps Script do Avanço Sond foi publicado e as três
fontes funcionam. `tools/semanal/apps-script-espelho-avancos.gs` já carrega o
`ORIGEM_FILE_ID` real, e as duas URLs estão em `URL_ESPELHO_AVANCOS_SEMANAL`/
`URL_ESPELHO_LAB_SEMANAL` (`render-semanal.js`, dentro de `SCRIPT_CLIENTE_SEMANAL`).

São a MESMA Sheet publicada, abas diferentes: o que as distingue é só o `gid`
(`943230110` = Avanços, `213649864` = Lab Concluido). Trocá-las de lugar não daria
erro nenhum — cada parser leria a planilha errada em silêncio. Se um dia forem
republicadas, **confira o cabeçalho do CSV** antes de confiar na ordem: Avanços
começa em `Contrato,Tomador,Objeto,...`; Lab, em `ID Contrato,Tomadora,OS,...`.

O caminho degradado continua existindo e coberto por teste (`RE_URL_PENDENTE`): se
as URLs voltarem ao literal `PENDENTE-...`, o botão atualiza só a MATRIZ, preserva
`window.__DEMANDAS__` e diz isso no `#status-atualizacao`.

Verificação de ponta a ponta feita no dia de ligar: as três requisições retornaram
200 e a aba Demandas fechou em **15.515 chegadas em 2026**, o mesmo número medido
no `.xlsx` local (ver `test/semanal-demandas-planilha-real.test.js`) — é assim que
se confirma que a Sheet espelho não está servindo dado velho ou truncado.

**O espelho atrasa até 30 min**: o gatilho do Apps Script (`criarGatilho`) roda
nesse intervalo. Uma edição no `.xlsx` não aparece no botão antes disso — não é
defeito do refresh.

### Pendências conhecidas

**Fase 2 — os filtros: FEITA em 6ff1bfc.** `tools/comum/render-shell.js` exporta
`scriptFiltros()` (estado, `indicesFiltrados`, `montarFiltroMulti` com
`aoMudar(cfg)`), consumido pelas duas páginas -- ver `FILTROS_SEMANAL` em
`tools/semanal/render-semanal.js` (origem/categoria/tipologia/grupo/SUP +
seletor de dimensão). A aba Balanço de massa ficou com 4 controles PRÓPRIOS
(período/base/dimensão/somente ativos, em `renderControles`), não com o filtro
de tipologia da barra como o plano original supunha. Specs de referência:
docs/superpowers/specs/2026-07-29-planejamento-semanal-filtros-design.md.

O branch `semanal-filtros-layout-orcamento` ficou ÓRFÃO: ele saiu de um master
velho (2502943) e extraía a lógica de cliente para `tools/comum/trechos-cliente.js`,
`filtros-cliente.js` e `refresh-cliente.js`, arquivos que não existem no master
atual. Nada dele foi incorporado -- se a extração ainda interessar, é replanejar,
não rebase.

**A página semanal não tem carimbo "Gerado em"**, ao contrário do orçamento. Sem ele não
dá para confirmar um deploy pelo conteúdo — que é justamente a verificação que este
arquivo exige por causa do incidente de 2026-07-22. Vale acrescentar.

**`fecharMes` com semanas parcialmente nulas** faz média/soma só dos válidos. Ninguém
exercita isso hoje (Realizado e Tendência são nulos até a planilha semanal existir), mas
decida a semântica da semana corrente incompleta **antes** de escrever `parse-semanal.js`.

**RESOLVIDO em 2026-08-03 — Δ equipes agora sai do Avanço Sond.** O texto abaixo fica
como histórico do problema. A barra passou a comparar **equipes mobilizadas** (medidas)
contra o Previsto da MATRIZ, com verde/vermelho igual ao desvio de valor:

- Fonte: coluna `Sondador` (Y) do Avanço Sond. Sondador distinto por dia é o proxy de
  equipe. Ver `tools/semanal/compute-equipes-mobilizadas.js`.
- **A unidade é "equipe equivalente" (equipe-dia ÷ dias do período), não pessoas
  distintas.** Contar distintos por (SUP, tipologia) infla: em julho/2026, 95 pessoas
  viravam 185 "equipes", porque o mesmo sondador atende vários contratos e era contado
  inteiro em cada um. Com equivalentes dá 52,8 — cabe dentro das 95, como tem de ser.
- **A janela sempre para em hoje.** Sem isso a média do mês corrente é dividida pelos
  dias que ainda não aconteceram: em 03/08 agosto dava 3,5 contra 52,8 de julho, e a
  barra mostrava um déficit falso — o mesmo defeito que a troca de fonte veio corrigir.
- Ocupação é o INTERVALO do furo (`Inicio Sondagem`..`Termino Sondagem`), não o dia do
  término. `Inicio Sondagem` e `Sondador` viraram colunas obrigatórias em `parse-avancos.js`.
- **Sondador vazio não é lacuna de preenchimento.** São 10.195 dos 51.819 furos úteis,
  e a distribuição por status explica tudo (medido em 2026-08-03): CONCLUIDO 40.749 com
  ZERO vazios, EXECUTADO 859 com zero, PENDENTE 5.910 todos vazios, CANCELADO 4.301 com
  4.285. Todo furo executado tem sondador; os vazios são os que ninguém executou, que
  por definição não ocuparam equipe. A conta cobre 100% do que existe para medir — não
  há nada a corrigir na planilha. O build vigia o inverso: se aparecer furo
  CONCLUIDO/EXECUTADO sem sondador, ele avisa, porque aí a conta passaria a subestimar
  em silêncio.
- **Atenção ao tipo:** `parseAvancos` entrega `Date`, não dia-desde-época. A primeira
  versão assumiu número, passou nos testes sintéticos e travou o build na planilha real
  (o laço por dia iterava de milissegundo em milissegundo: 2,87 trilhões de iterações).
  `paraDiaEpoch` normaliza os dois, e há teste prendendo o tipo real.
- Diferente de volume/financeiro, que só usam o Avanço Sond em Mês Vigente, equipes usa
  **sempre**: a coluna da MATRIZ é inservível nos dois sentidos (0 no mês corrente, vazia
  no mês fechado — 350 de 350 registros em julho/2026).

O histórico do problema:

**Balanço de Massa: barra de equipes em Mês Vigente continua sem dado (2026-08-01).**
Depois de mover o Realizado de Volume/Financeiro pra Mês Vigente pro Avanço Sond (ver
`compute-balanco.js`, `realizadoDoAvancos`), `equipesRealizado` continua vindo só da
coluna Realizado da MATRIZ -- que, igual às outras, só é preenchida depois que o mês
fecha. Resultado: a barra de equipes desenha "sem dado" (não mais barra zero enganosa,
mas ainda sem dado real) em Mês Vigente. Não existe rastreamento de equipes por furo no
Avanço Sond -- a candidata mais próxima é a coluna "Sondador" (quem executou o furo), hoje
não lida em lugar nenhum do projeto. O dono do projeto pediu explicitamente pra NÃO
decidir agora ("guardar pra retomar depois") -- ele ainda não escolheu como contar
"equipes" a partir do Avanço Sond. Uma opção levantada (ainda não confirmada por ele):
contar Sondadores distintos ativos no mês, por (SUP, tipologia), como proxy de "quantas
equipes trabalharam". Ao retomar, pergunte a ele antes de implementar -- não assuma essa
opção como decidida.

## Estilo de trabalho

Vale o mesmo do repositório principal: decidir e implementar sem parar para perguntar
quando existe um default razoável, e rodar a revisão de design do Open Design em trabalho
de HTML. Ver o `CLAUDE.md` do `matriz-equipes-source`.
