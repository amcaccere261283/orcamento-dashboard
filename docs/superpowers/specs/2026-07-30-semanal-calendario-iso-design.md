# Calendário ISO de semanas reais na Tabela Semanal — Design

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
  chegada: [18932, 18935, ...],       // dia (epoch-day) de cada furo cuja OS chegou
  termino: [18940, 18941, ...],       // dia de cada furo cuja sondagem terminou (status CONCLUIDO/EXECUTADO)
  cancelamento: [18950, ...],         // dia de cada furo cancelado com data legível
};
```

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

- **Semana fechada** (fim < hoje): soma de `termino` no intervalo `[inicio, fim]`
  (inclusive), somado através dos registros selecionados (`indices`) — evento real, não
  fração nominal.
- **Semana em curso** (hoje ∈ `[inicio, fim]`): soma de `termino` no intervalo
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

- **Semana fechada**: saldo de furos em aberto medido no **domingo** daquela semana
  (23:59) — `chegada <= fim` e não (`termino <= fim`) e não (`cancelamento <= fim`).
  Serve pra ver se a demanda está diminuindo ou aumentando semana a semana.
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
