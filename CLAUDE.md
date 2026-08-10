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

`docs/planejamento-semanal.html` — SEIS abas: Semanal (o mês dividido em semanas
reais — segunda a domingo, cortadas SEMPRE dentro do mês, nenhum dia de um mês
conta no acompanhamento do vizinho; ver `tools/semanal/compute-semanal.js` e
`docs/superpowers/specs/2026-07-30-semanal-calendario-iso-design.md`), Gráficos,
Balanço de massa (barras divergentes por tipologia), Demandas, Alertas e
Consolidado. Build:
`ORCAMENTO_SENHA='...' node tools/semanal/build-dashboard.js`, e **sempre**
`cp dist/planejamento-semanal.html docs/planejamento-semanal.html` antes de commitar.
`test/publicacao-docs-sincronizado.test.js` trava essa cópia para as duas páginas.

### Avanços online (2026-08-05)

A fonte de "Realizado" (furos de sondagem, alimenta as abas Semanal, Gráficos,
Balanço de massa e Demandas) deixou de ser o arquivo local `Avanço Sond.xlsx`
(G:\...) e passou a ser buscada direto do sond.com.br, só dos contratos
financeiros **ATIVOS** (confirmado 2026-08-05: entre 83 e 84, o número muda em
tempo real conforme o portfólio da empresa). Ver
`docs/superpowers/specs/2026-08-05-avancos-online-design.md` para o desenho
completo.

**Atualizar os dados:**

```bash
node tools/semanal/atualizar-avancos-online.js   # gera dist/avancos-online.csv (~alguns minutos, ~83 contratos)
```

Exige o **Google Chrome** (não Brave) aberto com a porta de depuração remota e
já logado em sond.com.br:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

Cerca de 40% dos contratos ativos retornam resposta vazia (0 bytes) — são
contratos sem nenhuma sondagem registrada ainda, o script já trata isso como
esperado (loga e continua, não é erro). Se a MAIORIA ou TODOS falharem, aí sim
é sinal de problema real (sessão expirada, endpoint mudou).

Depois de rodar, o build principal (`tools/semanal/build-dashboard.js`) já lê
esse CSV automaticamente — se o arquivo não existir, o build falha com uma
mensagem que já diz o comando acima pra rodar. **Sempre**
`cp dist/avancos-online.csv docs/avancos-online.csv` junto com o
`cp dist/planejamento-semanal.html docs/planejamento-semanal.html` de sempre
— o botão "Atualizar dados" da página busca esse CSV publicado (mesmo domínio
do GitHub Pages, sem CORS), então esquecer essa cópia deixa o botão buscando
uma versão desatualizada mesmo depois de reconstruir a página.

**O mecanismo antigo foi aposentado**: `tools/semanal/apps-script-espelho-avancos.gs`
(que espelhava o `.xlsx` do Drive numa Sheet publicada a cada 30 min, alimentando
tanto o build quanto o botão) foi removido do repositório. O gatilho do Apps
Script em si, se ainda existir na conta Google dona daquela Sheet, precisa ser
desligado manualmente por lá — este repositório não tem como alcançá-lo.

**Rodando de outra máquina:** só precisa do Chrome com a porta de depuração e
login manual em sond.com.br (sessão por cookie, sem senha guardada em lugar
nenhum) — diferente da MATRIZ/linha de base/Lab, que ainda exigem o G:\ com o
Google Drive montado, esta fonte específica não depende mais de nenhum
caminho de Drive.

**Atualização em 2026-08-05**: a aba "Lab Concluido" também migrou pro online —
ver "Lab Realizado + Equipes online" logo abaixo. A frase acima ("só
Sondagens/Demandas migrou") descrevia o estado antes dessa migração.

### Lab Realizado + Equipes online (2026-08-05)

Duas fontes a mais migraram do arquivo/Sheet local pro sond.com.br direto, mesmo
padrão de Avanços. Ver
`docs/superpowers/specs/2026-08-05-lab-e-equipes-online-design.md`.

- **Lab Realizado** substitui a aba "Lab Concluido" -- conta agora por "Ensaiado Dia",
  não "Concluído Dia" (mudança de semântica deliberada, ver o spec).
- **Equipes produtivas** (Sondador distinto por dia, via `campo/fotos`) virou a fonte
  PRINCIPAL do Δ equipes do Balanço de massa -- ativas (aba EQ)/mobilizadas (furos)
  continuam de reserva se o CSV novo faltar.
- **Equipes não produtivas** é informação nova e separada (aba Balanço de massa,
  perto do Δ equipes) -- não some com produtivas. Não precisa de busca nova: usa os
  mesmos dados da aba EQ que "ativas" já buscava.

**Atualizar:**

```bash
node tools/semanal/atualizar-lab-online.js
node tools/semanal/atualizar-equipes-online.js
```

Mesmo requisito de Chrome com `--remote-debugging-port=9222` logado em sond.com.br
que Avanços já documenta acima. **Sempre** `cp` os dois CSVs novos pra `docs/` junto
com o HTML, mesma regra de sempre.

**Limpeza pendente no Google (fora deste repositório):** com Lab também migrado, o
gatilho do Apps Script que ainda espelhava "Avanços" + "Lab Concluido" fica **sem
nenhum consumidor neste projeto**. Se ainda estiver rodando na conta Google dona da
Sheet, pode ser desligado de vez.

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

### Cinco decisões de 2026-08-03 (segunda leva de pedidos)

**O Previsto semanal é INTEIRO.** `dividirEmSemanasInteiras` (`compute-semanal.js`)
reparte pelo método do maior resto com teto em `Math.floor(total do mês)`: a soma das
semanas é exatamente esse piso — nunca supera o mês, nunca fica mais de 1 unidade
abaixo. A coluna Total passa a mostrar essa soma, então a linha fecha na conta que
está na tela. `dividirEmSemanas` (fracionária) continua existindo e é o que
`baseNasSemanas` (`compute-balanco.js`) e a Tendência usam — **não troque uma pela
outra sem pensar**: Tendência é projeção, não meta, e arredondá-la não faria sentido.
Equipes fica fora dos dois arredondamentos (é foto/média ponderada, "2,5 equipes" é
um número real).

**Consequência, e ela é maior do que parece:** cada linha do Consolidado arredonda
INDEPENDENTEMENTE, então a linha de TOTAL não é a soma das linhas que estão acima
dela. Uma versão anterior deste parágrafo dizia "podem somar 1 a menos" — está
errado, e a revisão de código de 2026-08-03 mediu: com 40 registros em julho/2026 a
diferença por semana foi de até 14 em ~199 (7%), e é SISTEMÁTICA, não aleatória —
como todas as linhas compartilham o mesmo perfil de dias, o desempate por menor
índice (`compute-semanal.js`) despeja o excedente sempre nas mesmas semanas. Efeito
irmão: registro com previsto mensal pequeno (0,8 furo) zera em todas as semanas.
Se isso incomodar, a correção é repartir em DOIS níveis (o total do grupo entre as
linhas, também por maior resto), não afrouxar o arredondamento.

**Balanço de massa tem uma 3ª dimensão, "Demandas".** Compara o que CHEGOU (evento
`chegada` do Avanço Sond) contra o Previsto de VOLUME da MATRIZ — a MATRIZ não tem
previsão de demanda própria, e furo previsto é a grandeza comparável. Diferente de
volume/financeiro, usa o Avanço Sond em QUALQUER período (não só Mês Vigente): não
existe coluna de demandas na MATRIZ pra servir de fallback, e a de volume responderia
outra pergunta. Sem o agregado de demandas a linha fica sem dado, nunca zero.

**Aba Alertas** (`tools/semanal/render-aba-alertas.js`) é o porte da aba Alertas do
orçamento — mesmo semáforo (hex e rótulos copiados literalmente), mesmas 7 colunas,
mesma busca, mesmos 5 filtros próprios. A ÚNICA mudança de lógica são os períodos:
S1..Sn do mês selecionado + "Acumulado até a semana atual" + "Mês inteiro", em vez dos
8 buckets mensais. Isso torna a lista de períodos **dinâmica** (um mês tem 5 ou 6
semanas), então `montarFiltrosAlertasSemanal` é chamada de novo a cada troca de mês e
readiciona os padrões se a poda esvaziar o filtro (ele é `minimoUm`). Os números NÃO
são recalculados ali: saem de `calcularSeriesSemanaisDimensao`, a mesma função da
Tabela Semanal e dos Gráficos. Com a dimensão Equipes marcada as células ficam "Sem
dado" — a página não mede equipes por semana em lugar nenhum, e cinza é a resposta
honesta.

**Aba Consolidado** (`tools/semanal/render-aba-consolidado.js`) porta a ABERTURA DE
LINHAS da Tabela do orçamento (TOTAL GERAL → total por tipologia → registros do SUP →
TOTAL do SUP), mas não a forma das colunas: como só há UMA semana, as três séries
viram colunas e cada abertura é uma linha só. Controle próprio: só o de semana (padrão
automático = a última que já começou) — o seletor de dimensão dela saiu em 2026-08-04,
ver "Consolidado congelado" abaixo.
Separação pedida explicitamente — **Volume mostra Equipes previstas + Produtividade
média esperada; Financeiro mostra só o Ticket médio**, nunca os dois juntos. As três
premissas são do MÊS (equipes é foto; PROD./TICKET valem o ano), ao lado de colunas
que são da semana — a nota no rodapé da aba diz isso na tela. Regra de dois ramos
herdada do orçamento: um registro só usa a premissa da planilha; agregado recalcula
(volume ÷ equipes×`DIAS_PREMISSA_MES`, e financeiro ÷ volume).

**Botão "Limpar filtros"**, o mesmo do orçamento. Zera só a barra compartilhada — não
o mês selecionado (é navegação) nem os controles próprios das abas.

### Tendência por ramo e alertas de tendência (2026-08-04)

Spec: `docs/superpowers/specs/2026-08-04-semanal-tendencia-regras-e-alertas-design.md`.

**A projeção da Tendência saiu de `render-aba-semanal.js` e virou
`tools/semanal/compute-tendencia-semanal.js`**, com TRÊS ramos em vez de dois. O ramo é
escolhido comparando `R_ac` (Realizado somado nas semanas **totalmente encerradas**)
contra `P_ac` (Previsto das mesmas semanas), com tolerância de 1%:

| Ramo | Semana em curso | Semanas futuras |
|---|---|---|
| `R ≈ P` | `max(P[vigente], realizado parcial)` | `P[semana]`, a fatia INTEIRA |
| `R > P` | realizado parcial + ritmo × dias que faltam dela | ritmo × dias da semana |
| `R < P` | realizado parcial + fatia do saldo | saldo × dias ÷ dias restantes |

**A semana em curso fica FORA da comparação que escolhe o ramo.** Meia semana de
Realizado contra um Previsto de semana inteira acusaria `R < P` toda segunda-feira. É o
mesmo erro que este projeto já corrigiu duas vezes (o degrau da semana nova; a janela de
equipes mobilizadas que precisava parar em hoje).

**Mês inteiramente no passado não tem Tendência nenhuma** — células **e** coluna Total
vazias, e a curva some dos Gráficos. Antes o Total mostrava um número que era, por
construção, idêntico ao Total do Realizado. **O invariante continua valendo e é o que
prende tudo:** no mês corrente, o Total da Tendência = ponto final da curva Acumulada.
`semanasTendenciaCompleta` alimenta a curva, o semáforo e o Consolidado;
`semanasTendencia` é só exibição.

**Valores financeiros passaram a inteiros** nesta página (linhas Realizado/Tendência da
Tabela Semanal e Ticket médio do Consolidado). Equipes segue com 2 casas (é média
ponderada) e Volume também (a Tendência dele é projeção fracionária).

**Dois alertas novos**, em bloco próprio na aba Alertas, abaixo do semáforo
(`tools/semanal/compute-alertas-tendencia.js` decide, `render-alertas-tendencia.js`
desenha). Só na dimensão **Volume**: as duas perguntas são físicas, e em R$ não existe
estoque de demanda. Disparam só quando a verificação falha — o semáforo já mostra desvio.

- Ramo `R > P` → **"Avaliar equipe e demanda"**, quando o saldo de demandas em aberto do
  SUP não cobre o excedente projetado.
- Ramo `R < P` → **"Equipes com pouco recurso ou improdutividade"**, quando a
  produtividade exigida para zerar o saldo passa a premissa.

**Duas armadilhas que a revisão final pegou, e que voltariam fácil:**

- **Não use `produtividadeEsperada()` do Consolidado como referência do Alerta B.** Para
  grupo agregado ela recalcula `V/(E×D)` — e como o `saldo` sai do mesmo `V` e a exigida
  usa o mesmo `E` e `D`, tudo se cancela: `exigida > esperada ⟺ saldo > V×R/C`. Medido:
  2 equipes previstas e 200.000 equipes previstas disparavam igual, com a evidência
  virando "exigida 0,00 · esperada 0,00". O alerta prometia medir equipe e media atraso
  pro-rata. A referência certa é `premissaProdutividadeDoGrupo`
  (`render-alertas-tendencia.js`): média das premissas `PROD.` da planilha ponderada pelo
  volume previsto, que não depende de `E`. `produtividadeEsperada()` continua intacta —
  ela alimenta uma coluna que tem de bater com o dashboard de orçamento.
- **`previstoAPartirDeHoje`/`tendenciaAPartirDeHoje` recortam em HOJE, não no início da
  semana em curso.** Somar a semana vigente inteira fazia o Alerta A exigir carteira
  aberta para furo que já tinha sido entregue (num caso medido: excedente de 140, dos
  quais 130 já estavam prontos). Os nomes são compridos de propósito.

### Consolidado congelado, filtro global de ativos e o anel do status (2026-08-04)

Spec: `docs/superpowers/specs/2026-08-04-semanal-consolidado-congelado-e-ativos-design.md`.

**A aba Consolidado perdeu a coluna Previsto** e mostra só Realizado + Tendência (as
colunas de premissa ficam). **A Tendência das semanas que já começaram é CONGELADA**: o
que se projetava para aquela semana no 1º dia dela, como registro histórico.

**Congelar é RECÁLCULO, não snapshot** — `calcularSeriesSemanaisDimensao` chamada com
`hojeEpoch = semanas[k].inicio`. Nessa recomputação a semana `k` vira a vigente, e o
valor devolvido é a projeção que se fazia para ela inteira ao começar. Funciona porque
os eventos do Avanço Sond têm data. **O preço:** um lançamento RETROATIVO muda um número
já "congelado" — é reprodutível, não imutável. Snapshot de verdade exigiria persistência,
e este repositório não tem workflow agendado nenhum; se um dia incomodar, a correção é
persistência, não remendo no recálculo.

**O Realizado exibido NUNCA congela** — sai de uma segunda série, calculada com o hoje
real. Congelar os dois faria uma semana encerrada mostrar Realizado ≈ 0, porque a
contagem de furos pararia no 1º dia dela. São duas chamadas por linha quando congela;
custo medido com 340 registros: 78 ms contra 62 ms (+26%, não +100% — a recomputação só
varre até a semana `k`).

**A aba é exceção deliberada à regra 2.1** (Tendência nunca sobre período realizado): num
mês fechado ela MOSTRA Tendência, porque ali é registro histórico, não projeção sobre o
passado. As duas coisas têm o mesmo nome e sentidos opostos — por isso o cabeçalho diz
qual está na tela, com a data-âncora.

**A aba usa a primeira dimensão da barra compartilhada**, igual a Alertas; o seletor
próprio saiu. **Cuidado que a revisão final pegou:** a tabela COAGE a dimensão para
volume/financeiro (`dimensaoDaTabela`), e `equipes` é a PRIMEIRA na ordem canônica de
`DIMENSOES_CONFIG_SEMANAL` — então filtrar pela dimensão crua escondia registros por um
critério diferente do que a tela mostra. Filtrar e exibir têm de usar a MESMA dimensão
coagida. Com `equipes` marcada a aba emite uma nota dizendo que mostra Volume.

**"Somente SUPs ativos" é filtro da página inteira** (`tools/semanal/filtro-ativos.js`,
aplicado por `indicesDaAba`), ligado por padrão. O check próprio do Balanço saiu.
**Ele NÃO cabe em `indicesFiltrados`**: os filtros de lá recortam por propriedade do
registro e não conhecem período; "ativo" depende do mês que a aba mostra, então é estado
compartilhado aplicado POR ABA. Aplicado em Semanal, Alertas e Consolidado; **fora de
Gráficos** (soma tudo numa série só, inativo contribui zero — código sem efeito) e **fora
de Demandas** (lê agregado por tipologia, não quebra por registro).

**Há DUAS noções de "ativo", e elas não coincidem** — o comentário no topo de
`filtro-ativos.js` que diz o contrário está errado. O Balanço decide por linha
(`compute-balanco.js`) com a dimensão e o período PRÓPRIOS dele, e na dimensão Demandas
usa o evento `chegada`; `filtro-ativos.js` decide por registro, com a dimensão da barra,
o mês inteiro e o evento `sondagemRealizada`. Um SUP só com chegadas e MATRIZ zerada
aparece no Balanço e some das outras três com o MESMO check ligado.

**O anel do `.status-circulo` foi removido** para o indicador ficar idêntico ao do
orçamento. O `#1414CC` ("Excelente") volta a ~1,65:1 e quase some — **preço aceito
explicitamente pelo dono do projeto; não recolocar numa revisão de design sem perguntar.**

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

`tools/comum/tipologias-avancos.js` mapeia os 20 rótulos crus nos 10 da MATRIZ. Rótulo
novo **falha o build de propósito** — não caia calado em Especiais.

**Correção (2026-08-10):** este parágrafo dizia que `SP.F` e `SM.A` eram tipologias
independentes — não são desde 2026-08-01, quando foram reclassificadas em `SP` e
`SM / SM.F / SR` (ver o bloco de sete reclassificações no próprio módulo). E
`SEG.A`/`SEG.V`/`SN` deixaram de chegar por completo desde que a exclusão passou a
valer em todas as fontes: `SEG.A`/`SEG.V` nunca aparecem, e `Especiais` (cujo único
rótulo é `SN`) fica permanentemente zerada.

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

### Formato numérico da Tabela Semanal e Gráficos, bug do Realizado de Equipes (2026-08-06/07)

**Nenhum número na Tabela Semanal mostra mais casa decimal** (Previsto/Realizado/
Tendência em Equipes/Volume, Demandas Pendentes) — pedido do dono do projeto,
substitui a regra de 2026-08-03/04 que mantinha Equipes/Volume com 2 casas.
`formatarNumero(v, 0)` (`render-aba-semanal.js:25-30`) já agrupa milhar em pt-BR via
`toLocaleString` ("4.415"), cobrindo os dois pedidos (inteiro + agrupamento) no mesmo
lugar. **Realizado de Equipes especificamente arredonda pra CIMA**
(`Math.ceil` em `mediaEquipesNoIntervalo`, `render-aba-semanal.js:148-157`), não pro
mais próximo — a média diária de equipes ativas quase sempre sai quebrada, e a leitura
conservadora pedida foi a de cima.

**Financeiro (Previsto/Realizado/Tendência) mudou pra milhões com sufixo "M"**
(substituindo a regra de inteiro puro de 2026-08-04), e depois **essa regra foi
substituída de novo em 2026-08-07** -- ver a seção própria mais abaixo. `renderLinhaSerie`
aceita tanto um número de casas quanto uma função formatadora no último parâmetro — é
assim que o Financeiro pluga a regra da vez sem a linha genérica precisar conhecer o
formato exato.

**Aba Gráficos não divide mais por mil.** `GRAFICO_LIMIAR_MILHARES`
(`render-aba-grafico-semanal.js`) e a lógica de divisão em `formatarValorGrafico`
continuam no arquivo, mas as duas atribuições `usarMilhares = max... >= LIMIAR` viram
sempre `false` -- reverter é só trocar essas duas linhas de volta. Título "(em
milhares)" nunca mais aparece (consequência direta, não precisou tocar nele).

**Bug corrigido (commit `88f137b`): "Realizado de Equipes" ficava em branco depois de
qualquer clique em "Atualizar dados".** Causa raiz: `atualizarDadosAoVivoSemanal()`
escrevia `demandasNovas.equipesAtivoPorDia` logo após buscar `historico.json`, mas
`demandasNovas` era REATRIBUÍDA ~20 linhas depois (`= ComputeDemandas.computeDemandas(...)`)
sempre que `avancosLabConfigurados` é true (o caso normal) -- o valor buscado ficava
órfão no objeto descartado. Fix: captura o valor numa variável própria
(`equipesAtivoPorDiaAtualizado`) e aplica em `demandasNovas.equipesAtivoPorDia` só no
final da função, depois de qualquer reatribuição possível -- mesmo padrão que
`equipesPorDia`/`equipesPeriodo` já usavam pra sobreviver a essa troca de objeto. **Ao
adicionar qualquer campo novo em `demandasNovas` dentro dessa função, escrever por
ÚLTIMO, nunca logo após o fetch** -- é a segunda vez que esse padrão de reatribuição no
meio da função pega um campo desprevenido.

### `tools/semanal/atualizar-arquivos.js` -- atalho local pras 3 buscas + build + publish (2026-08-07)

Pedido original do dono do projeto: um botão "Atualizar arquivos" na própria página
publicada, perto de "Atualizar dados", que buscasse dado novo de verdade. **Não dá pra
existir como botão** -- `planejamento-semanal.html` é HTML estático servido pelo Pages, e
as cinco buscas (`atualizar-avancos-online.js`, `atualizar-demandas-sondagem-online.js`,
`atualizar-lab-online.js`, `atualizar-demandas-lab-online.js`,
`atualizar-equipes-online.js`) são processos Node que precisam do Chrome local
aberto com `--remote-debugging-port=9222` já logado em sond.com.br -- JS de página nenhuma
aciona isso na máquina de quem só está vendo o site. "Atualizar dados" (acima) só troca
dados JÁ publicados; ele nunca busca nada sozinho, e não tem como passar a buscar sem virar
esse mesmo processo Node.

Diagnóstico que levou a isto: em 2026-08-07 o dono do projeto reportou "o Realizado não
atualiza pelo botão". Não era bug no refresh (que já recalcula as 6 abas a partir de
`window.__DEMANDAS__`/`window.__REGISTROS__` corretamente) -- era que `docs/avancos-online.csv`
e `docs/lab-online.csv`/`docs/equipes-produtivas-online.csv` estavam publicados de
2026-08-05/06: o botão buscava, de novo, os mesmos arquivos de 1-2 dias atrás. "Atualizar
dados" só é tão fresco quanto o último `atualizar-arquivos.js` (ou os 3 comandos manuais)
+ publish.

O script substitui a sequência manual documentada em "Atualizar os dados"/"Lab Realizado +
Equipes online" acima (3 buscas + `build-dashboard.js` + `cp` dos 4 arquivos pra `docs/` +
commit + push) por uma chamada só:

```bash
ORCAMENTO_SENHA='...' node tools/semanal/atualizar-arquivos.js
```

Cada busca já se protege sozinha contra gravar um CSV vazio/malformado por cima do bom (o
guard de "mês corrente falhou -> aborta sem gravar", em `atualizar-avancos-online.js`;
`TAXA_SUCESSO_MINIMA`, citada aqui antes de 2026-08-10, não existe mais desde que a busca
deixou de ser por contrato e passou a ser por mês) -- por isso uma busca falhando
**não aborta as outras nem o build**: `build-dashboard.js` sempre lê o que já estiver em
`dist/`, seja do run de agora ou de um anterior. Só aborta ANTES de tentar qualquer coisa
se `ORCAMENTO_SENHA` não estiver definida. O commit final lista no corpo da mensagem quais
das 3 buscas falharam, se alguma falhou. `git push origin master` roda automático no final
-- mesma regra permanente de "sempre publicar depois de reconstruir, sem perguntar de
novo" do `CLAUDE.md` do `matriz-equipes-source` (ver "Estilo de trabalho" no fim deste
arquivo).

### Financeiro na Tabela Semanal: de milhões ("M") pra milhares truncados (2026-08-07)

**Financeiro (Previsto/Realizado/Tendência) passou a mostrar em milhares, sem sufixo**
(`formatarFinanceiroMilhares`, `render-aba-semanal.js:195-201`), substituindo o "M" de
milhões de 2026-08-06 no mesmo dia em que esse formato foi criado -- pedido do dono do
projeto. Exemplo confirmado com ele antes de implementar (a mensagem original cortou no
meio, então a confirmação foi por exemplo concreto, mesmo padrão de todas as mudanças de
formatação deste projeto): **R$ 12.345.648 vira "12.345"**.

**`Math.floor`, não `Math.round`** -- é o que faz o exemplo acima bater: 12.345.648 em
milhares é 12345,648, e o pedido trunca pra "12.345", não arredonda pra "12.346" (que
`Math.round` daria). Zero casas decimais, agrupamento de milhar em pt-BR via
`formatarNumero` (mesmo mecanismo que Equipes/Volume já usam) — sem sufixo nenhum, ao
contrário do "M" que durou um dia só.

**Indicador de unidade no título do bloco:** como Volume/Equipes mostram o valor cheio e
Financeiro mostra em MILHARES, uma célula de Financeiro e uma de Volume podiam ter o mesmo
número (`123`) significando coisas de escala bem diferente -- sinalizado ao dono do
projeto, que pediu o indicador de volta no mesmo dia. O título do bloco (`.tabela-semanal-
titulo`, só em `dimensao === 'financeiro'`) passou a ser **"Financeiro (mil R$)"**, não só
"Financeiro" -- ver `render-aba-semanal.js` logo antes do `return` de `renderAbaSemanal`.
Diferente do título "(em milhares)" da aba Gráficos (removido em 2026-08-06, sem
substituto): aqui o indicador ficou porque a divisão em si (milhares) também ficou, e sem
rótulo o número sozinho é ambíguo. Consolidado e Alertas usam `calcularSeriesSemanaisDimensao`
mas NÃO passam pelo formatador de milhares (chamam `formatarNumero` direto sobre o valor
cheio) -- só a Tabela Semanal trunca pra milhares, então só ela precisava do indicador.

### Tendência de Equipes: da linha BASE=T da MATRIZ, não de furos (2026-08-07)

A aba Gráficos, dimensão Equipes, só desenhava Previsto -- comentário no código dizia
"Realizado/Tendência não existem pra Equipes", mas isso ficou desatualizado: a Tabela
Semanal já tinha ganhado Realizado de Equipes em 2026-08-06 (via `demandas.equipesAtivoPorDia`,
ver seção acima) e ninguém atualizou o Gráfico pra usar o mesmo dado. **Corrigido**:
`seriesVisiveis` em `construirPainelGraficoSemanalHtml` (`render-aba-grafico-semanal.js`)
não faz mais exceção pra Equipes -- as 3 dimensões desenham as mesmas 3 séries agora. O
painel Acumulado continua excluído pra Equipes (é foto, não flui ao longo do mês -- isso
não mudou).

**Tendência de Equipes é conceito novo, adicionado no mesmo pedido.** Diferente de
Volume/Financeiro (que projetam a partir do RITMO de furos concluídos -- não existe
"ritmo" pra um headcount), a Tendência de Equipes vem direto da própria MATRIZ: cada
(contrato, tipologia) tem 3 linhas físicas na planilha por `BASE` (P/R/T -- ver
`tools/orcamento/parse-matriz.js:123-129`), e a linha `T` ("Total") é exatamente a mesma
fonte que o dashboard de Orçamento já usa como "Tendência" pra TODAS as dimensões
(`SERIE_LABELS: { total: 'Tendência', ... }`, `tools/orcamento/render-dashboard.js:1109`).
O semanal simplesmente nunca tinha lido `registro.total` pra Equipes -- confirmado com o
dono do projeto antes de implementar ("está na planilha MATRIZ, na mesma fonte do valor
das equipes previstas").

**Implementação** (`calcularSeriesSemanaisDimensao`, `render-aba-semanal.js`):
`previstoMesVigente` virou `somaMesVigente(registros, indices, campo, dimensao, vigenteIdx)`
com um parâmetro `campo` novo (`'previsto'` ou `'total'`) -- mesma soma-através-de-registros
de sempre, só trocando qual bloco do registro é somado. A Tendência de Equipes soma
`registro.total.equipes[vigenteIdx]` e repete o resultado em TODAS as semanas via
`dividirEmSemanasInteiras` (que, pra `dimensao='equipes'`, só repete o valor mensal -- é
foto, não se reparte por dia, mesmo tratamento que o Previsto já recebe). **Diferente do
Realizado de Equipes, a Tendência NÃO trunca em hoje** -- é premissa/plano do mês inteiro,
não uma medição, então semanas futuras mostram o mesmo valor das passadas (exatamente como
o Previsto já fazia). Fechamento usa `fecharMes`, que já faz MÉDIA (não soma) quando
`dimensao === 'equipes'`.

**A aba Consolidado continua coagindo Equipes pra Volume** (`dimensaoDaTabela`,
`render-aba-consolidado.js`) com uma nota na tela dizendo "a página não mede equipes por
semana em lugar nenhum" -- essa frase ficou desatualizada por este mesmo pedido (a página
JÁ mede, na Tabela e no Gráfico), mas mexer no Consolidado não foi pedido nesta rodada;
fica como pendência se um dia isso incomodar.

### Regras de dados da Tabela Semanal e dos Gráficos (2026-08-10)

Seis regras fechadas pelo dono do projeto depois de uma auditoria de origem/regra
de cada número desses dois quadros. **Elas mandam sobre qualquer coisa datada antes
disto nesta seção.** Escopo declarado: só Tabela Semanal e Gráficos — Balanço,
Demandas, Alertas e Consolidado entram numa rodada seguinte.

1. **Cobertura e corte em d−1.** Realizado de Sondagem (Link 1) e de Lab (Link 4)
   cobrem **de 2025-01 em diante** — o Lab buscava só o mês corrente, o que fazia
   LAB.C/LAB.E aparecer com Realizado zero em qualquer mês passado (medido: 3.550
   ensaios contra os 169.041 reais de 15 meses). Equipes (Link 7) faz backfill do
   **ano corrente**, por mês faltante. E **todo Realizado para em d−1** — o dia
   corrente está incompleto por construção. `realizadoAteEpoch`
   (`render-aba-semanal.js`) existe só para isso; `hojeEpoch` continua sendo hoje
   para semana em curso, saldo de pendentes e congelamento do Consolidado.
2. **Demanda é estoque numa data:** pendência ≤ D e execução > D, com **D = o
   primeiro dia do período**. Execução exatamente em D já não é demanda em D.
   Cancelamento **não** participa mais da saída do estoque.
3. **O Link 1 é a fonte única de sondagem executada** — só muda mês/ano na URL.
4. **A exclusão vale em todas as fontes** (`tools/comum/exclusoes.js`, uma
   implementação só). No Lab, `Tomadora` é lida como `Tomador` — é a mesma coluna.
5. **UTC−3 sempre** (`hojeNoFusoProjeto`/`diaEpochDeOntem` em `tools/comum/datas.js`),
   inclusive no navegador. **E nada que vem dos links é transformado.**
6. **Troca de fonte pergunta sobre a anterior** antes de deixar órfão no repositório.

**Duas correções de fato que vieram junto, e que contradiziam o que este arquivo
dizia:**

- **O Link 1 NÃO tem data de início de sondagem.** Ele tem `Criação da OS` e
  `Executado Dia`, e só. O mapeador gravava o mesmo `Executado Dia` em duas colunas,
  uma batizada `Inicio Sondagem` — coluna que a fonte não tem. Confirmado com o dono
  do projeto que é o mesmo campo; a duplicata saiu, e `parse-avancos.js` expõe um
  campo só, `executadoDia`. **Isso anula a regra de 2026-08-06** ("sai do estoque
  quando a sondagem COMEÇA") descrita mais abaixo: com uma data só, começar e
  executar são o mesmo evento.
- **Deslocamento vem da coluna `Deslocamento` do Link 1**, não de um regex sobre
  `Observações de Campo`. Definição do dono do projeto: sondagem com `"Sim"` não foi
  finalizada por alguma situação durante a execução e foi refeita em outra linha —
  origina outra sondagem **sem gerar demanda nova**, então fica fora de Sondagens
  Realizadas **e** das contas de Demandas. Medido na base inteira: a coluna acusa
  2.950, o regex acusava 7.735, concordando em 2.793 — o regex derrubava **4.942
  furos legítimos** e deixava passar 157. O Realizado subiu de 40.117 para 44.902
  furos (**+11,9%**).

**Cuidado ao mexer no cache:** `dist/cache/*.csv` guarda o grid **já mapeado**.
Mudou o conjunto de colunas, o cache velho tem que ser invalidado — senão os meses
fechados voltam no formato antigo e o combinador, que usa o cabeçalho do PRIMEIRO
grid para todos, desalinha o histórico inteiro em silêncio. `cacheUtilizavel()`
(nos dois fetchers com cache) faz esse guard.

### Pendências conhecidas

**SUPERADO em 2026-08-10 — ver "Regras de dados" acima. O Link 1 não tem data de início
separada da de execução, então esta distinção deixou de existir; a saída do estoque é a
data de execução. O texto abaixo fica como histórico.** ~~RESOLVIDO em 2026-08-06 (commit
`88f137b`) — saída do estoque de "Demandas Pendentes" passou a usar Início Sondagem, não
Término.~~ `pendentesNaData`/`saidaEstoque`
(`compute-demandas.js:91-99`, `render-aba-semanal.js:111-127`) agora tiram um furo do
saldo pendente pela data de **Início Sondagem** (mais Cancelamento, o menor dos dois) —
confirmado pelo dono do projeto contra o extrato Avanço Sondagens: uma demanda deixa de
estar "disponível para execução" quando a sondagem COMEÇA, não quando termina.

A ressalva de qualidade de dado (`parse-avancos.js:22-33`: **3.929 de 61.927 linhas
(≈6,3%) de Início Sondagem com data fora da janela 2023-2027**) não precisou de
tratamento novo — `dataSaneada` já descarta essas datas como ausentes, e o furo
correspondente simplesmente não sai do estoque (mesmo tratamento conservador que já
existia para furo sem data de término, antes desta troca).

**Mesmo dia, pedido separado:** Tabela Semanal também mudou pra mostrar, em cada semana,
o saldo pendente FIXO do seu primeiro dia (não mais o saldo de hoje na semana em curso
nem o saldo do domingo nas semanas fechadas) — ver `render-aba-semanal.js:394-407`.

**Fase 2 — os filtros: FEITA em 6ff1bfc.** `tools/comum/render-shell.js` exporta
`scriptFiltros()` (estado, `indicesFiltrados`, `montarFiltroMulti` com
`aoMudar(cfg)`), consumido pelas duas páginas -- ver `FILTROS_SEMANAL` em
`tools/semanal/render-semanal.js` (origem/categoria/tipologia/grupo/SUP +
seletor de dimensão). A aba Balanço de massa ficou com controles PRÓPRIOS
(período/base/dimensão, em `renderControles`), não com o filtro de tipologia da
barra como o plano original supunha. O quarto que ela tinha, "somente ativos",
virou filtro da página inteira em 2026-08-04 — ver "Consolidado congelado" abaixo. Specs de referência:
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
