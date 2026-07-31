# Calendário ISO de semanas reais na Tabela Semanal — Design

## Atualização 2026-08-01: corte sempre dentro do mês (substitui a regra da maioria)

A regra da maioria abaixo (ISO 8601 puro) tinha um efeito colateral inaceitável pra quem
acompanha o produzido MENSAL: uma semana cujo início cai no fim de um mês, mas cuja
maioria dos 7 dias cai no mês seguinte, contava INTEIRA no mês seguinte -- ex.: 29 e
30/06 (2 dias) entravam no Realizado de julho, porque a semana S27 (29/06-05/07) tinha
maioria de dias em julho (5 contra 2). Achado do dono do projeto em 2026-08-01, comparando
o Realizado de ST no acompanhamento semanal com uma contagem direta na planilha (2826 no
dashboard contra 2777 na planilha para o estoque de ST -- ver o commit de mesma data que
corrige o filtro de furos "deslocamento", causa principal dessa diferença específica; a
regra da maioria era um problema SEPARADO, de fronteira de mês, que o dono pediu pra
corrigir também).

**Nova regra**: cada semana é cortada SEMPRE dentro do mês que a contém. A 1ª e a última
semana de um mês ficam curtas (1 a 7 dias) sempre que o mês não começa numa segunda ou não
termina num domingo; as do meio continuam cheias (segunda a domingo, 7 dias). Nenhum mês
de 2026 tem exatamente 4 semanas com essa regra -- a contagem real varia de 5 a 6 (contra
4 ou 5 da regra da maioria). Exemplo de julho/2026 (mês começa numa quarta):

| Semana | Intervalo |
|---|---|
| S1 | 01/07 a 05/07 |
| S2 | 06/07 a 12/07 |
| S3 | 13/07 a 19/07 |
| S4 | 20/07 a 26/07 |
| S5 | 27/07 a 31/07 |

Implementação em `semanasDoMes` (`tools/semanal/compute-semanal.js`): anda dia a dia
desde o dia 1 do mês; cada semana vai até o primeiro domingo que encontrar, ou até o fim
do mês, o que vier primeiro. `mesDaSemana` (a função de regra da maioria) foi removida --
não tem mais consumidor.

**Efeito colateral bom**: como as semanas de um mês agora cobrem TODOS os seus dias sem
lacuna, a seção "Dias de fronteira" abaixo (e o `-1` que `indiceSemanaAtual` podia devolver
no início/fim do mês) deixa de ocorrer em uso real -- só é alcançável se um chamador passar
`hoje`/`vigenteIdx` inconsistentes entre si, o que não acontece no fluxo real (os dois vêm
do mesmo relógio, ver `render-semanal.js`). O código em `render-aba-semanal.js` continua
defensivo mesmo assim (não foi simplificado), mas o cenário descrito na seção "Caso de
fronteira" abaixo é HISTÓRICO -- documentado como estava a regra ANTERIOR, não o
comportamento atual.

**Cabeçalho ganha o intervalo de datas**: cada coluna "Sn" passa a mostrar o intervalo ao
lado ("S1 (01/07 a 05/07)") -- pedido do dono do projeto na mesma data, pra tirar a
ambiguidade de qual período cada coluna representa. Implementado em
`formatarIntervaloSemana`/`renderCabecalho` (`tools/semanal/render-aba-semanal.js`). Sem
mês vigente válido (vigenteIdx fora de [0,11]) não há semana real pra descrever -- o
cabeçalho cai no fallback "Sn" puro, sem intervalo.

O resto deste documento (a partir daqui) descreve o design ORIGINAL (regra da maioria),
mantido como registro histórico da motivação e do restante do desenho (fonte de dados,
Realizado/Tendência/Pendentes por semana, renderização) -- tudo isso continua válido sem
mudança; só `semanasDoMes` e o cabeçalho mudaram.

## Contexto e motivação

A Tabela Semanal (aba 1 do Planejamento Semanal) divide hoje o mês vigente em 4 fatias
nominais iguais (`SEMANAS = 4` em `tools/semanal/compute-semanal.js`), tanto para o
Previsto quanto para o Realizado/Tendência recém-adicionados. Isso não reflete a
realidade: 2026 tem 53 semanas ISO, e cada mês do calendário contém 4 ou 5 delas —
dividir sempre por 4 distorce tanto o Previsto quanto (mais visivelmente) o Realizado,
que hoje é só `realizadoMes / 4` repetido nas 4 células, sem nenhuma relação com que
furos realmente terminaram em qual semana.

Este design substitui a fatia nominal por semanas de calendário reais (segunda a
domingo, ISO 8601), com Previsto e Realizado corretos por semana, escalando para
qualquer mês de 2026 — não só julho.

## Calendário de semanas (regra da maioria)

Semanas ISO 8601 (segunda a domingo). Uma semana pertence ao mês que contém a maioria
dos seus 7 dias — como 7 é ímpar, nunca há empate. Calculado para 2026:

| Mês | Semanas | Qtd |
|---|---|---|
| Janeiro | S1–S5 | 5 |
| Fevereiro | S6–S9 | 4 |
| Março | S10–S13 | 4 |
| Abril | S14–S18 | 5 |
| Maio | S19–S22 | 4 |
| Junho | S23–S26 | 4 |
| Julho | S27–S31 | 5 |
| Agosto | S32–S36 | 4 |
| Setembro | S36–S39 | 4 |
| Outubro | S40–S44 | 5 |
| Novembro | S45–S48 | 4 |
| Dezembro | S49–S53 | 5 |

Total: 53 semanas, batendo com o ano ISO de 2026 (2026-01-01 é quinta-feira).

Função pura, em `tools/semanal/compute-semanal.js` (roda tanto no build quanto no
navegador, sem I/O): `semanasDoMes(ano, mesIndex)` devolve a lista de semanas do mês
(cada uma com início/fim em dia-desde-época, ver abaixo), na ordem do calendário. O
tamanho da lista (4 ou 5) é o novo `N` que substitui a constante fixa `SEMANAS = 4` em
todo o resto do arquivo.

Rótulos das colunas continuam `S1`..`SN` (sequencial dentro do mês, resetando a cada
mês) — não os números ISO absolutos (S27, S28...). Mantém a convenção visual atual; os
números ISO não aparecem pra quem usa a página.

## Mês vigente — sem mudança de regra, só de efeito

`vigenteIdx` continua vindo de `calcularVigenteIdx` (dia civil de hoje), exatamente como
hoje. O que muda é que agora ele também determina **quantas semanas (N) mostrar** e
**quais são elas**, via `semanasDoMes`.

**Caso de fronteira** (ex.: sábado 01/08 e domingo 02/08 — a semana ISO que cobre esses
2 dias, S31, pertence a julho pela regra da maioria): a página já mostra agosto (mês
civil de hoje), mas nenhuma das semanas *próprias* de agosto (S32–S36) começou ainda — a
primeira só começa na segunda 03/08. Nesses 2 dias específicos, todas as N semanas de
agosto aparecem como semana futura (ver abaixo). É um efeito colateral aceito da escolha
de manter "mês vigente = dia civil de hoje", confirmado com o dono do projeto.

## Fonte de dados — substituindo `porRegistro` mensal por lista de eventos

`porRegistro` (introduzido na tarefa anterior, mensal, 12 posições por série) só tem um
consumidor: `demandasMesVigente` em `render-aba-semanal.js`. Ele é **substituído**, não
estendido — nada mais depende do formato mensal (a aba Demandas usa
`demandas.tipologias`/`totais`, estrutura separada, intocada).

Problema com granularidade fixa (mensal ou semanal): a página não é reconstruída todo
dia. "Quanto foi realizado até hoje" precisa de precisão de **dia**, não de semana ou
mês — senão a semana em curso responde sempre a mesma coisa, tanto na segunda quanto na
sexta.

Solução: por `(sup, tipologia)`, guardar as datas dos eventos em si (em dias desde a
época Unix, um inteiro pequeno), não um valor pré-somado por período:

```js
porRegistroEventos[chaveMatriz(sup, tipologia)] = {
  chegada: [18932, 18935, ...],            // dia de cada furo cuja OS chegou (qualquer status)
  sondagemRealizada: [18940, 18941, ...],  // dia de término de sondagem, SÓ furos CONCLUIDO/EXECUTADO (fluxo Realizado)
  saidaEstoque: [18940, 18952, ...],       // por furo, o MENOR entre término (qualquer status) e cancelamento -- só entra se pelo menos um dos dois existir
};
```

`saidaEstoque` não é "término" nem "cancelamento" — é o menor dos dois, calculado **por
furo**, ainda no Node (onde a ligação furo-a-furo entre os dois campos existe). A
planilha real tem 16 furos CANCELADO com data de término de sondagem preenchida além da
de cancelamento; o estoque de hoje já trata isso como "sai na primeira das duas datas que
chegar" (`!terminou && !cancelou`, um OU, nunca as duas subtraídas). Guardar `término` e
`cancelamento` como listas separadas e contar cada uma independente subtrairia essas 16
linhas DUAS vezes do saldo — errado. Calculando o mínimo por furo antes de achatar em
lista, a conta de saldo vira uma soma-e-subtração simples (`chegada` menos `saidaEstoque`
até a data) sem perder essa regra.

`sondagemRealizada` continua separado (não vira `min` com nada) porque tem um critério
diferente do estoque: só CONCLUIDO/EXECUTADO contam pro fluxo Realizado, enquanto o
estoque considera QUALQUER status pra decidir se o furo já saiu.

Cada array tem um elemento por furo que contribui aquele evento (não por mês, não por
semana) — o tamanho passa a ser proporcional à quantidade real de furos daquela
combinação, não à granularidade do calendário. Isso tende a ficar **mais leve** que o
formato mensal atual (12 números fixos por série mesmo pra combinações com poucos furos),
não mais pesado.

Com a lista de eventos, qualquer recorte por data — semana fechada, semana em curso até
hoje, ou até um dia arbitrário — vira uma contagem simples (`filter` + `length`) sobre os
arrays, sem pré-computar nada por período. Funciona igual em Node (build) e no navegador
(o helper de contagem é puro e cabe no bundle, ES5, sem I/O).

`compute-demandas.js` monta `porRegistroEventos` no mesmo laço que já percorre os furos
(nenhum I/O extra). `render-aba-semanal.js` ganha os helpers de contagem por intervalo.

## Previsto por semana

`previstoMes / N` (N = `semanasDoMes(...).length`, 4 ou 5) — mesma lógica de hoje, só com
o divisor certo. Vale para Volume e Financeiro (fluxos). Equipes continua repetindo o
mesmo valor (foto) em cada uma das N semanas — sem mudança de semântica, só de contagem.

## Realizado por semana (Volume) — a mudança principal

Para cada semana do mês vigente (`inicio`/`fim` em epoch-day):

- **Semana fechada** (fim < hoje): soma de `sondagemRealizada` no intervalo
  `[inicio, fim]` (inclusive), somado através dos registros selecionados (`indices`) —
  evento real, não fração nominal.
- **Semana em curso** (hoje ∈ `[inicio, fim]`): soma de `sondagemRealizada` no intervalo
  `[inicio, hoje]` — só o que já aconteceu.
- **Semana futura** (inicio > hoje): 0 — nada aconteceu ainda. Reaproveita a mesma
  convenção "ausência = zero" já estabelecida para furos (Avanço Sond é listagem
  completa, e neste caso o motivo é temporal, não de combinação ausente).
- **Nenhuma semana em curso** (dias de fronteira, ex. 01–02/08): todas as N semanas
  contam como futuras (0), já que nenhuma delas começou.

## Tendência por semana (Volume)

Mesma forma de hoje, alimentada pelos números reais em vez de nominais:

- Semanas fechadas ou em curso: usa o valor de Realizado (já é fato, não precisa
  projetar).
- Semanas futuras: dividem igualmente o que falta do Previsto do mês
  (`previstoMes - somaRealizadoAteAgora`) pelas semanas futuras restantes — com a mesma
  trava já corrigida na tarefa anterior (se o saldo restante for ≤ 0, porque o Realizado
  já passou o Previsto, as semanas futuras continuam no ritmo já realizado em vez de
  projetar um valor negativo).
- Se nenhuma semana começou ainda (dias de fronteira): `somaRealizadoAteAgora = 0`, todas
  as N semanas de Tendência mostram `previstoMes / N` igualmente.

## Demandas Pendentes por semana (Volume)

Ganha quebra por semana, deixando de ser só a célula de fechamento:

- **Semana fechada**: saldo de furos em aberto medido no **domingo** daquela semana —
  contagem de `chegada <= fim` menos contagem de `saidaEstoque <= fim`. Serve pra ver se
  a demanda está diminuindo ou aumentando semana a semana.
- **Semana em curso**: mesmo cálculo, mas medido **hoje** em vez do domingo da semana
  (a semana ainda não fechou).
- **Semana futura**: sem-dado (célula vazia) — não faz sentido projetar estoque futuro,
  ao contrário de Realizado (onde 0 é uma afirmação válida: "nada aconteceu ainda").
- **Fechamento (coluna Total)**: sempre o saldo de **hoje**, calculado direto e
  independente da quebra semanal — mesmo comportamento de antes da mudança, garante que
  sempre há um valor ali (inclusive nos dias de fronteira, quando nenhuma semana própria
  do mês começou).

## Renderização

`renderCabecalho`/`renderLinhaSerie` passam a iterar sobre `N` (4 ou 5) em vez da
constante fixa `SEMANAS`. Isso vale pros três blocos de dimensão (Volume, Equipes,
Financeiro) — todos ganham a largura certa de colunas pro mês vigente.

## Fora de escopo

- Aba Demandas (3ª aba, dados mensais de `demandas.tipologias`/`totais`) — não muda.
- Balanço de Massa (2ª aba) — não muda.
- Exibir o número ISO da semana (S27, S28...) ou o intervalo de datas no cabeçalho — fica
  como está (S1..SN sequencial). Pode ser um ajuste futuro, não pedido agora.

## Testes

Este design substitui a lógica de quarteamento nominal introduzida na tarefa anterior —
grande parte da suíte de `compute-semanal.js`, `render-aba-semanal.js`,
`render-semanal.js` (wiring) e `test/semanal-build-dashboard.test.js` precisa ser
reescrita, não só estendida. O plano de implementação detalha os testes por tarefa.

## Riscos

- **Payload**: a lista de eventos por `(sup, tipologia)` deve ficar mais leve que o
  formato mensal atual (tamanho proporcional a furos reais, não a 12 posições fixas) —
  mas vale conferir o tamanho do HTML gerado depois de implementado, como já é hábito
  neste projeto.
- **Dias de fronteira**: todo início de mês em que a 1ª semana própria não começa na
  virada do mês (a maioria dos meses, dado que só 2 dos 12 têm fronteira exata em 2026 —
  maio/junho) terá de 1 a poucos dias em que a página já mostra o novo mês mas nenhuma
  semana própria dele começou ainda. Comportamento aceito e decidido acima, mas vale
  testar mais de um caso além de julho/agosto pra garantir que a regra generaliza.
