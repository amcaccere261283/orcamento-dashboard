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

**Pendência**: as URLs `URL_ESPELHO_AVANCOS_SEMANAL`/`URL_ESPELHO_LAB_SEMANAL`
em `tools/semanal/render-semanal.js` (dentro de `SCRIPT_CLIENTE_SEMANAL`)
são placeholder até o dono do projeto terminar o setup manual do Apps
Script novo (ver o arquivo `.gs`) e publicar as duas abas como CSV. Até lá o
botão funciona pra MATRIZ mas falha (com mensagem de erro clara no
`#status-atualizacao`) ao tentar buscar Avanços/Lab.

### Pendências conhecidas

**Fase 2 — os filtros: lógica compartilhada extraída, semanal ainda não
consome.** `tools/comum/render-shell.js` agora exporta `scriptFiltros()`
(estado, `indicesFiltrados`, `montarFiltroMulti` com `aoMudar(cfg)`) --
ver docs/superpowers/specs/2026-07-29-planejamento-semanal-filtros-design.md
e docs/superpowers/plans/2026-07-29-planejamento-semanal-filtros-fase1-extracao.md.
O orçamento já consome (comportamento idêntico, golden regenerado de
propósito). A página semanal (aba 1 com a barra completa + seletor de
dimensão, aba 2 só com o filtro de tipologia da mesma barra) ainda não foi
ligada -- é o Plano 2, a escrever separadamente.

**A página semanal não tem carimbo "Gerado em"**, ao contrário do orçamento. Sem ele não
dá para confirmar um deploy pelo conteúdo — que é justamente a verificação que este
arquivo exige por causa do incidente de 2026-07-22. Vale acrescentar.

**`fecharMes` com semanas parcialmente nulas** faz média/soma só dos válidos. Ninguém
exercita isso hoje (Realizado e Tendência são nulos até a planilha semanal existir), mas
decida a semântica da semana corrente incompleta **antes** de escrever `parse-semanal.js`.

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
