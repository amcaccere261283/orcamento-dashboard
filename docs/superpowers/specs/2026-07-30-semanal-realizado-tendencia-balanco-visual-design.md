# Realizado/Tendência semanal (via Demandas) + ajustes no Balanço de massa — design

Data: 2026-07-30

Fecha duas lacunas pedidas pelo Américo depois de ver a Fase 2 (filtros) no ar:

1. **Aba 1 (Tabela semanal)**: as linhas Realizado e Tendência (dimensão Volume) estão vazias
   desde que a aba existe — a spec original (`2026-07-28-planejamento-semanal-design.md`)
   deixou isso pendente de "uma planilha semanal" que nunca chegou. Ela chegou: é a mesma
   fonte que já alimenta a aba Demandas (`Avanço Sond.xlsx`), que mede exatamente a mesma
   unidade que a MATRIZ usa em Volume — **quantidade de furos** (confirmado pelo dono do
   projeto). Além disso, uma linha nova, **Demandas Pendentes**, mostra o estoque de furos em
   aberto.
2. **Aba 2 (Balanço de massa)**: uma coluna de Tomador ao lado do SUP, e um ajuste visual
   (fonte do SUP menor, linha divisória entre SUPs).

## Escopo

**Entra**: Realizado/Tendência semanais (só dimensão Volume), a linha Demandas Pendentes,
coluna Tomador no gráfico de Balanço, os dois ajustes visuais.

**Não entra**: Realizado/Tendência nas dimensões Equipes/Financeiro (o Avanço Sond não mede
nem uma nem outra — fica como pendência futura, sem fonte à vista). Mudar a definição de
"semana" em si (S1..S4 continuam fatias nominais do mês, não semanas ISO — ver "Semana
atual" abaixo, que estende essa mesma lógica em vez de substituí-la).

## Realizado semanal (Volume) — fonte e granularidade

**Fonte**: `tools/semanal/compute-demandas.js`, série `sondagemRealizada` (contagem de
furos com sondagem terminada no mês, status CONCLUIDO/EXECUTADO — já implementada e testada
contra a planilha real, ver `test/semanal-demandas-planilha-real.test.js`).

**Granularidade — o problema e a solução.** `computeDemandas` hoje agrega furos só por
`(tipologia, mês)`, nunca por SUP — porque é isso que a aba Demandas precisa. Mas a barra de
filtros compartilhada (Fase 2) filtra por SUP/Grupo/Origem além de Tipologia, e o dono do
projeto confirmou que o Realizado semanal **precisa respeitar todos esses filtros**, "a
informação está contida na planilha" — cada furo (`parse-avancos.js`) já carrega `sup` e
`tipologia`, só a agregação atual descarta o primeiro.

`computeDemandas` ganha um segundo agregado, **na mesma passada pelos furos** (sem reler a
planilha): `porRegistro`, chaveado por `sup + '||' + tipologia` — a MESMA expressão que
`chaveMatriz` (`tools/comum/linha-base.js`) já usa para casar a linha de base com a MATRIZ,
reaproveitada aqui (este módulo é Node-only, não entra no bundle do navegador — o `require`
é seguro, mesmo padrão que já importa `tipologias-avancos.js`). Só as 2 séries que a Tabela
semanal precisa entram nesse agregado (`sondagemRealizada`, `pendentes`) — não os 5, YAGNI.

```js
porRegistro: {
  'SUP-0001-24||ST': { sondagemRealizada: [12 meses], pendentes: [12 meses] },
  ...
}
```

**No cliente**, uma combinação (SUP, tipologia) ausente de `porRegistro` significa
genuinamente **zero furos** para aquele par — não "sem dado reportado" (que seria `null` no
resto do projeto). A soma sobre os registros filtrados trata ausência como 0, nunca como
null: `realizadoMesVigente` só devolve `null` quando `indices` está vazio (nenhum registro
selecionado), espelhando a mesma regra que `previstoMesVigente` já segue.

`realizadoMesVigente(registros, indices, vigenteIdx)` soma, para cada `i` em `indices`,
`demandas.porRegistro[chave(registro.sup, registro.tipologia)].sondagemRealizada[vigenteIdx]`
(ou 0 se a chave não existir) — mesmo padrão de soma-através-de-registros que
`previstoMesVigente` já usa, só que a fonte é `demandas`, não `registro.previsto`.

**Divisão em semanas**: mesmo tratamento que o Previsto já recebe —
`dividirEmSemanas(realizadoMesVigente(...), 'volume')`, 4 fatias nominais iguais. Isso já
existe e não muda; só passa a receber um valor real em vez de `null`.

## Semana atual e Tendência

**Semana atual** é um conceito novo: qual das 4 fatias nominais do mês "hoje" cai dentro.
Estende a MESMA filosofia que já rege S1..S4 ("fatias nominais, não semanas ISO, nenhum
cálculo depende de datas" — spec original) para o calendário: divide os *dias do mês* em 4
partes iguais, do mesmo jeito que `dividirEmSemanas` já divide o *valor* em 4 partes iguais.

Nova função em `tools/semanal/compute-semanal.js` (mesmo arquivo de `dividirEmSemanas`/
`fecharMes`, mesmo motivo — é a mesma lógica de fatiamento nominal, agora aplicada ao
calendário):

```js
// diaDoMes: 1-31. diasNoMes: total de dias do mês vigente (28-31). Devolve
// 1-4 -- qual fatia nominal do mês "hoje" cai dentro, com a MESMA divisão em
// 4 partes iguais que dividirEmSemanas já aplica ao valor mensal (não
// semanas ISO -- ver o comentário no topo do arquivo).
function semanaAtual(diaDoMes, diasNoMes) {
  var semana = Math.ceil(diaDoMes / (diasNoMes / SEMANAS));
  return Math.min(SEMANAS, Math.max(1, semana));
}
```

`diaDoMes`/`diasNoMes` vêm de `new Date()` **no cliente**, no momento em que a página
recalcula (não em build) — quem vê a página numa data diferente da build precisa ver a
semana atual correta. `renderAbaSemanal` continua uma função pura e testável em Node: quem
chama (o script de cliente, ou um teste) calcula `diaDoMes`/`diasNoMes` e passa como
parâmetro — a função nunca chama `new Date()` internamente.

**Tendência** (só dimensão Volume): semanas ≤ semana atual usam o Realizado nominal daquela
semana (o que já aconteceu); semanas > semana atual distribuem igualmente o que falta pra
bater o Previsto do mês:

```
semanasRestantes = 4 - semanaAtual
saldoRestante = previstoMesVigente - (realizadoMesVigente/4 * semanaAtual)
tendenciaFutura = semanasRestantes > 0 ? saldoRestante / semanasRestantes : 0

tendencia[s] = s <= semanaAtual
  ? realizadoNominal[s]          // já aconteceu
  : tendenciaFutura              // distribui o saldo pelas semanas que faltam
```

Por construção, a soma de `tendencia` bate exatamente com `previstoMesVigente` quando há
semanas restantes (a "tendência" é: mantido o resto do plano, o mês fecha como planejado) —
mesma leitura que "tendência" já tem no resto do projeto (Realizado + Previsto do que falta).
Se `previstoMesVigente` ou `realizadoMesVigente` for `null` (sem registro selecionado),
Tendência também fica `null`/sem-dado nas 4 semanas, como as outras séries já fazem.

## Linha Demandas Pendentes

Uma linha nova, só no bloco **Volume**, logo abaixo de Tendência — não se repete nos blocos
de Equipes/Financeiro (Pendentes é estoque de furos, não existe nessas unidades).

**Fonte**: mesmo `porRegistro`, série `pendentes[vigenteIdx]`, somada sobre os registros
filtrados (mesma regra de ausência-vira-zero do Realizado).

**Não se divide em 4 semanas.** Pendentes é estoque (saldo "agora"), não fluxo — dividir por
4 produziria um número sem significado, a mesma armadilha que `dividirEmSemanas` já evita
para Equipes e que a aba Demandas já evita no acumulado. As colunas S1-S4 desta linha ficam
vazias (`sem-dado`, mesmo tratamento visual das colunas sem dado hoje); só a coluna de
fechamento mostra o saldo — o número puro, mesma célula (`celula-total-linha`) que as outras
linhas já usam, sem texto extra dentro dela (`renderLinhaSerie` só formata números, nunca
rótulo). O que diferencia esta linha de um "Total" comum é o próprio rótulo da linha,
**"Demandas Pendentes"** — já deixa claro que é saldo, sem precisar de uma segunda etiqueta
dentro da célula. O cabeçalho da coluna (`renderCabecalho`, controlado por
`rotuloColunaFechamento`) continua "Total" (dimensão Volume), sem mudança — ele descreve as
linhas de fluxo (Previsto/Realizado/Tendência) da tabela, que continuam maioria.

## Balanço de massa — coluna Tomador

`compute-balanco.js`, `calcularLinhas`: cada linha empurrada para o array de saída ganha
`tomador: registro.tomador` (o registro já está em escopo, `tomador` já existe em todo
registro da MATRIZ — nenhuma mudança de fonte de dados, só passar o campo adiante).

`render-aba-balanco.js`, `renderGraficoTipologia`: o rótulo de cada linha passa de só `SUP`
para `SUP — Tomador`, mesmo formato composto que o filtro de SUP da barra compartilhada já
usa (`opcoesFiltro`, `rotuloComposto`, `tools/comum/render-shell.js`) — SUP em destaque
(cor de texto primária), Tomador em cor secundária, na mesma linha. "Facilita a leitura
quando o filtro estiver sem SUP específico selecionado" (dono do projeto) — com muitos SUPs
visíveis de uma vez, o tomador ajuda a identificar rápido de quem é cada linha sem precisar
abrir o filtro.

## Balanço de massa — ajuste visual

Dois ajustes em `render-aba-balanco.js`, sem mudar a lógica de cálculo:

- **Fonte do SUP menor**: `font-size` do texto da linha (hoje 12) cai para 11, dando espaço
  pro Tomador na mesma linha sem espremer.
- **Divisória entre linhas**: uma linha horizontal fina (mesma cor de `--gridline`/
  `COR_EIXO`, já usada no eixo central do gráfico) no topo de cada linha de SUP (exceto a
  primeira), pra separar visualmente um SUP do outro quando há muitas linhas na tela.

## Testes

- `compute-demandas.js`: `porRegistro` bate com a soma manual de furos por (sup, tipologia,
  série, mês) numa fixture sintética; par (sup, tipologia) sem nenhum furo fica ausente do
  mapa (não aparece com zeros) — quem lê trata ausência como zero, não o agregado.
- `compute-semanal.js`: `semanaAtual` cobre os 4 quadrantes de um mês de 28/30/31 dias,
  incluindo os dias de fronteira entre uma semana nominal e a próxima.
- `render-aba-semanal.js`: `renderAbaSemanal` recebe `demandas`/`diaDoMes`/`diasNoMes` como
  parâmetros; Realizado/Tendência aparecem só no bloco Volume; a linha Demandas Pendentes
  aparece só nesse bloco, com as 4 semanas vazias e só a célula de fechamento preenchida; o
  invariante já existente (soma S1..S4 do Previsto bate com o mês vigente) continua valendo
  — e ganha um par: a soma de Tendência também bate com o Previsto quando há semana(s)
  futura(s), e com o Realizado quando a semana atual é a última.
- `compute-balanco.js`/`render-aba-balanco.js`: `tomador` chega em cada linha; o rótulo
  composto aparece no SVG; ajuste de fonte/divisória verificado pelo texto do SVG gerado
  (tamanho de fonte, presença da linha divisória entre a 1ª e a 2ª linha de um gráfico com 2+
  SUPs).
- Testes de wire-up existentes (`test/semanal-render-semanal-wireup.test.js`,
  `test/semanal-render-aba-balanco-wireup.test.js`) precisam de `demandas` com
  `porRegistro` preenchido para exercitar os casos novos — os testes que já passam
  `DEMANDAS_VAZIAS`/`{tipologias:[], totais:{}}` ganham `porRegistro: {}` (ausência = zero,
  já é o comportamento correto pra esse caso).

## Fora de escopo

- Realizado/Tendência nas dimensões Equipes e Financeiro — sem fonte de dados disponível.
- Qualquer mudança na definição de S1..S4 como fatias nominais (a "semana atual" estende a
  mesma lógica, não a substitui).
- Truncamento/quebra de linha para nomes de Tomador muito longos no SVG do Balanço — aceito
  como limitação conhecida; a maioria dos tomadores cabe na largura disponível (900px de SVG,
  ~450px de área útil antes do eixo central).

## Riscos

**`porRegistro` cresce o payload cifrado.** 36 SUPs × ~10 tipologias × 2 séries × 12 meses é
pequeno (algumas centenas de números), sem risco de tamanho.

**Chave `sup||tipologia` do Avanço Sond pode não bater 1:1 com a MATRIZ.** Já documentado no
CLAUDE.md (13 SUPs no Avanços que a MATRIZ não tem, 11 SUPs da MATRIZ sem furo no Avanços) —
esses casos já viram zero silencioso, correto por definição (SUP sem furo = zero furos), não
um erro a tratar.
