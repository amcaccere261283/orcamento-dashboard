# Tendência semanal por ramo (R=P / R>P / R<P) e dois alertas novos — design

Data: 2026-08-04. Página: Planejamento Semanal (`docs/planejamento-semanal.html`).
Escopo: só esta página — o dashboard de orçamento não é tocado.

## O pedido

Três coisas, na ordem em que o dono do projeto pediu:

1. Todos os valores financeiros sem casas decimais.
2. Recalcular a Tendência:
   - 2.1 sempre nos períodos futuros, nunca sobre o realizado;
   - 2.2 por semana: `R = P` mantém o `P` na `T`; `R > P` mantém a mesma média
     acumulada das semanas passadas do mês (e avalia se o SUP tem saldo de
     demandas) → alerta de avaliar equipe e demanda; `R < P` compensa nas semanas
     seguintes o saldo não realizado (e avalia se a produtividade prevista das
     equipes é coerente para atingir a produção) → alerta de equipes com pouco
     recurso ou improdutividade.

## Ponto de partida: o que já existe

`calcularTendenciaSemanal` (`tools/semanal/render-aba-semanal.js`) tem **dois**
ramos, não três:

- `saldoRestante > 0` (equivale a `R < P`): reparte o saldo que falta pelos dias
  restantes do mês, proporcionalmente aos dias de cada semana;
- `saldoRestante <= 0` (equivale a `R >= P`): projeta os dias restantes no ritmo
  médio por dia já realizado.

Ou seja: o ramo `R < P` do pedido já está implementado e não muda de fórmula; o
ramo `R > P` já projeta pelo ritmo, mas o ritmo é calculado sobre uma janela
diferente da que o pedido descreve (ver abaixo); e `R = P` cai hoje no ramo do
ritmo, não em "mantém o P".

Nenhum dos dois alertas existe. A aba Alertas de hoje é um semáforo de desvio
(`Realizado ÷ Previsto` por período), não uma lista de diagnóstico.

## Decisão 1 — casas decimais

Na página semanal o financeiro só aparece com casas decimais em dois pontos:

- `renderLinhaSerie('Realizado', ...)` e `renderLinhaSerie('Tendência', ...)` em
  `renderAbaSemanal` — chamadas sem o parâmetro `casasDecimais`, que cai no padrão
  2 do formatador;
- a coluna "Ticket médio previsto (R$/furo)" do Consolidado (`colunasExtras`,
  `casas: 2`).

Os dois passam a **0 casas quando a dimensão é `financeiro`**. Balanço de massa,
Gráficos e a tabela do semáforo já formatam financeiro como inteiro — nada a
fazer neles.

Ficam **fora** desta mudança, de propósito:

- **Equipes**, que continua com 2 casas: é média ponderada (foto), "2,5 equipes"
  é um número real e arredondá-lo faria a Tabela discordar do Balanço de massa
  sobre o mesmo número — a mesma razão que já tirou Equipes do arredondamento
  inteiro do Previsto em 2026-08-03;
- **Volume**, que não é valor financeiro. A Tendência de Volume é projeção
  fracionária e as casas decimais ali são informação real.

## Decisão 2 — a regra 2.1, "nunca sobre o realizado"

Duas consequências, uma já valendo hoje e outra nova:

- **Semana já encerrada** (`fim < hoje`) dentro do mês corrente: célula de
  Tendência sem dado. Já é o comportamento atual (supressão por coluna em
  `calcularSeriesSemanaisDimensao`) e não muda.
- **Mês inteiramente no passado** (a última semana do mês tem `fim < hoje`):
  a linha Tendência fica sem dado por completo — células **e** coluna Total — e a
  curva de Tendência não é desenhada nos Gráficos. Hoje o Total ainda mostra um
  número, e esse número é, por construção, exatamente igual ao Total do Realizado:
  é a duplicação que o pedido manda eliminar.

**O Total no mês corrente continua sendo o fechamento projetado** (realizado até
agora + projeção do que falta), não a soma só das semanas futuras. É esse valor
que casa com o ponto final da curva Acumulada da aba Gráficos — invariante que o
`CLAUDE.md` do projeto registra explicitamente ("o ponto final da curva continua
igual ao Fechamento da Tabela Semanal") e que esta mudança não pode quebrar.

**Mês inteiramente no futuro**: nenhuma semana encerrada, `R_ac = 0`,
`P_ac = 0`. Cai no ramo `R = P` (ver abaixo) e a Tendência reproduz o Previsto do
mês. É o mesmo resultado que a implementação de hoje produz por outro caminho, e
é o resultado certo: sem passado, a melhor projeção é o plano.

## Decisão 3 — a regra 2.2, os três ramos

### A comparação que escolhe o ramo

- `R_ac` = soma do Realizado nas semanas **totalmente encerradas** do mês
  (`fim < hoje`);
- `P_ac` = soma do Previsto **das mesmas semanas**.

A **semana em curso fica fora da comparação**. Meia semana de Realizado contra um
Previsto de semana inteira acusaria `R < P` toda segunda-feira, e o mês inteiro
seria projetado a partir de um déficit que não existe. É o mesmo erro que já foi
corrigido duas vezes neste projeto (o degrau da semana nova em 2026-08-03; a
janela de equipes mobilizadas que precisava parar em hoje).

Ramo `R = P` quando `|R_ac − P_ac| <= 0,01 × P_ac`. Igualdade exata em ponto
flutuante não acontece — sem tolerância, o ramo "mantém o P" seria código morto.
Com `P_ac = 0` (nenhuma semana encerrada, ou plano zerado), `R_ac = 0` também cai
em `R = P`; `R_ac > 0` com `P_ac = 0` cai em `R > P`.

### O que cada ramo projeta

Notação: `fechadas` = semanas com `fim < hoje`; `vigente` = a semana que contém
hoje; `diasRestantesVigente` = dias da vigente que ainda não passaram;
`diasRestantesMes` = `diasRestantesVigente` + dias das semanas futuras.

| Ramo | Semana em curso | Semanas futuras |
|---|---|---|
| `R ≈ P` | `max(P[vigente], realizado parcial da vigente)` | `P[semana]` |
| `R > P` | `realizado parcial + ritmo × diasRestantesVigente` | `ritmo × dias da semana` |
| `R < P` | `realizado parcial + saldo × diasRestantesVigente ÷ diasRestantesMes` | `saldo × dias da semana ÷ diasRestantesMes` |

com `ritmo = R_ac ÷ dias das semanas encerradas` e
`saldo = P do mês inteiro − R_ac − realizado parcial da vigente`.

Três coisas que essa tabela decide e merecem estar escritas:

- **A semana em curso nunca projeta abaixo do que já é fato.** Nos ramos `R > P` e
  `R < P` isso vem de graça (a projeção soma o realizado parcial); no ramo
  `R ≈ P` precisa do `max`, senão uma semana que já superou seu próprio Previsto
  mostraria uma Tendência menor que o Realizado da mesma coluna.
- **`P[semana]` no ramo `R ≈ P` é a fatia inteira** (`dividirEmSemanasInteiras`,
  a mesma que a linha Previsto exibe), não a fracionária. "Mantém o P na T" é um
  pedido sobre o que se vê na tela: as duas linhas têm que mostrar o mesmo número.
  Nos outros dois ramos a Tendência continua fracionária — é projeção, não meta,
  e arredondá-la não faria sentido (decisão já registrada em 2026-08-03).
- **O ramo `R < P` compensa contra o Previsto do MÊS**, não contra o previsto das
  semanas que faltam. É isso que "compensar nas semanas seguintes o saldo não
  realizado" quer dizer: o mês ainda fecha no plano.

### Casos de borda que a fórmula precisa tratar

- **`saldo <= 0` dentro do ramo `R < P`**: acontece quando o Realizado parcial da
  semana em curso já cobriu sozinho o que faltava do mês. As semanas futuras
  seguem o `ritmo` (o tratamento do ramo `R > P`), nunca uma projeção negativa.
  É o mesmo guarda que a implementação de hoje já tem (`saldoRestante > 0`).
- **`diasRestantesMes = 0`** (hoje é o último dia do mês): não há futuro a
  projetar. A semana em curso fica no Realizado parcial e não há semana futura.
  Sem esse guarda, as três fórmulas dividem por zero.
- **`P_ac = 0` com `R_ac > 0`**: cai no ramo `R > P`, e o `ritmo` é finito porque
  ter Realizado em semana encerrada implica ter dias encerrados. Não há divisão
  por zero possível aqui.

### O que muda em relação a hoje

Só o ramo `R > P` muda de número, e por um motivo: hoje o ritmo é
`realizadoAteAgora ÷ diasElapsados`, onde `realizadoAteAgora` inclui a semana em
curso e `diasElapsados` inclui os dias já passados dela. Passa a ser
`R_ac ÷ dias das semanas encerradas` — "a mesma média acumulada nas semanas
passadas do mês", literalmente o que o pedido diz. O ramo `R < P` mantém a
fórmula atual, com a diferença de que `saldo` agora desconta explicitamente o
realizado parcial da vigente (hoje isso acontece implicitamente pelo mesmo
`realizadoAteAgora`; o resultado numérico é o mesmo, a expressão fica legível).

## Decisão 4 — arquitetura

Módulo novo: **`tools/semanal/compute-tendencia-semanal.js`**, puro (sem HTML,
sem DOM), testável no Node. Interface:

```
calcularTendenciaSemanal({
  previstoMes,        // número ou null
  semanasPrevisto,    // fatias inteiras, o que a linha Previsto mostra
  semanasRealizado,   // por semana; 0 (não null) nas futuras
  semanas,            // {inicio, fim} em diaEpoch
  hojeEpoch,
}) -> {
  semanas: [...],     // a projeção, uma por semana (a versão COMPLETA)
  ramo: 'igual' | 'acima' | 'abaixo',
  diagnostico: {
    realizadoAcumulado, previstoAcumulado, semanasFechadas,
    saldo, ritmoPorDia, diasRestantesMes,
    previstoRestante, tendenciaRestante,
  },
}
```

O `diagnostico` é o ponto do desenho: **o mesmo cálculo que projeta a linha
decide o ramo e devolve os números que justificam o alerta.** Sem ele, a aba
Alertas teria que reimplementar a comparação `R_ac` × `P_ac` e as duas
implementações poderiam divergir sem nada quebrar — a Tabela projetando por um
ramo enquanto o alerta acusa outro. É o mesmo motivo pelo qual
`calcularSeriesSemanaisDimensao` já é fonte única para Tabela, Gráficos, Alertas
e Consolidado.

`calcularSeriesSemanaisDimensao` passa a chamar esse módulo e a repassar `ramo` e
`diagnostico` no objeto que já devolve. `semanasTendenciaCompleta` (consumida
pelo Acumulado dos Gráficos e pelo numerador do semáforo) continua com o
Realizado nas semanas encerradas; `semanasTendencia` (exibição) continua
suprimindo essas colunas. No mês totalmente passado as duas ficam todas nulas e
`fechamentoTendencia` vira `null`.

A função homônima que existe hoje em `render-aba-semanal.js` é removida de lá
(hoje ela é exportada e há teste apontando para ela — o teste migra junto).

**Contrato do bundle**: `compute-tendencia-semanal.js` consome
`compute-semanal.js` (`diasNaSemana`) e é consumido por `render-aba-semanal.js`.
Na lista ordenada de `render-semanal.js` ele entra **depois** de
`compute-semanal.js` e **antes** de `render-aba-semanal.js`. Não há resolvedor de
dependências: a ordem da lista é o contrato.

Duas funções que hoje são privadas dos seus módulos precisam ser exportadas para
o módulo de alertas (nenhuma muda de corpo):

- `pendentesNaData` (`render-aba-semanal.js`) — saldo de furos em aberto numa data;
- `produtividadeEsperada` (`render-aba-consolidado.js`) — furos por equipe-dia,
  com a regra de dois ramos (premissa da planilha para um registro só, razão
  recalculada para agregado).

## Decisão 5 — os dois alertas

Módulo novo **`tools/semanal/compute-alertas-tendencia.js`**, puro, e um bloco
novo de render na aba Alertas, **abaixo** da tabela do semáforo. Uma linha por
grupo, seguindo o controle "Agrupar por" da própria aba (padrão SUP) e os filtros
da barra compartilhada.

**Só na dimensão Volume.** As duas perguntas são físicas — furos em carteira e
furos por equipe-dia. Em R$ não existe estoque de demanda, e em Equipes não
existe Realizado semanal (a página não mede equipes por semana em lugar nenhum).
Com outra dimensão selecionada o bloco mostra uma nota explicando, não uma tabela
vazia.

### Alerta A — "Avaliar equipe e demanda" (ramo `R > P`)

Pergunta: o ritmo acima do plano tem demanda que o sustente?

- `excedenteProjetado` = `diagnostico.tendenciaRestante − diagnostico.previstoRestante`
  (quanto a projeção do que falta do mês passa do plano do que falta);
- `saldoDemandas` = `pendentesNaData(grupo, hoje)` — furos que chegaram e ainda
  não saíram do estoque;
- **dispara quando `saldoDemandas < excedenteProjetado`**: o SUP está produzindo
  acima do plano, mas não tem carteira aberta para manter o ritmo.

### Alerta B — "Equipes com pouco recurso ou improdutividade" (ramo `R < P`)

Pergunta: as equipes previstas, na produtividade prevista, dão conta do saldo?

- `saldo` = o mesmo `diagnostico.saldo` (o que ainda falta produzir no mês);
- `diasPremissaRestantes` = `DIAS_PREMISSA_MES[mes] × diasRestantesMes ÷ dias do mês`
  — a premissa de dias úteis do projeto (30, ou 15 em Jan/Dez) recortada na fração
  do mês que ainda falta. Usar dias de calendário aqui faria esta conta discordar
  da coluna "Produtividade média esperada" do Consolidado, que é a referência com
  que ela é comparada;
- `produtividadeExigida` = `saldo ÷ (equipes previstas × diasPremissaRestantes)`;
- **dispara quando `produtividadeExigida > produtividadeEsperada`**: para zerar o
  saldo, cada equipe-dia teria que produzir mais do que a premissa diz que produz.

### Regras comuns aos dois

- **Só disparam quando a verificação falha.** Um alerta por SUP em todo mês com
  desvio viraria ruído — a aba do semáforo já existe para mostrar desvio. O
  alerta responde a pergunta que o pedido faz ("se tem saldo", "se está coerente"),
  e só aparece quando a resposta é não.
- Ramo `R ≈ P`: nenhum alerta. Nada a avaliar.
- Insumo ausente (sem demandas carregadas, sem equipes previstas, sem premissa de
  produtividade) → a linha aparece como **"Sem dado"**, nunca como alerta e nunca
  como "tudo certo". É a mesma convenção do resto da página: ausência não vira
  zero.
- **Mês totalmente passado ou totalmente futuro → nenhum alerta.** No passado não
  há futuro a projetar; no futuro não há passado a julgar.
- Colunas: Grupo · Tomador · Alerta · Realizado acum. · Previsto acum. ·
  Evidência · Status. "Evidência" é o par de números que justifica o disparo
  (`saldo de demandas 12 · excedente projetado 34`, ou
  `produtividade exigida 1,8 · esperada 1,2`) — sem ele o alerta é uma acusação
  sem prova.
- Financeiro nas colunas numéricas: 0 casas, pela Decisão 1. Produtividade
  continua com 2 casas (é razão, não valor).

## Testes

Unitários, em `test/`, com fixtures sintéticas (nenhum teste novo depende das
planilhas em `G:`):

- `semanal-tendencia-ramos.test.js`: um caso por ramo, com os números conferidos
  à mão; a semana em curso nunca abaixo do Realizado; mês totalmente passado →
  tudo nulo, inclusive o fechamento; mês totalmente futuro → Tendência igual ao
  Previsto; `P_ac = 0` nos dois sentidos; a tolerância de 1% pegando e não
  pegando; e os três casos de borda (saldo negativo, último dia do mês, ritmo com
  denominador zero).
- `semanal-alertas-tendencia.test.js`: disparo e não-disparo de cada alerta;
  "Sem dado" para cada insumo ausente; nenhum alerta no ramo `igual` e nos meses
  fechado/futuro.
- Regressão: o Total da Tendência no mês corrente continua igual ao ponto final
  da curva Acumulada dos Gráficos (o invariante do `CLAUDE.md`).
- `orcamento-html-inalterado.test.js` tem que continuar passando — o dashboard de
  orçamento não é tocado por nada aqui.

## Fora de escopo

- O dashboard de orçamento, em qualquer aspecto.
- As casas decimais de Volume e de Equipes.
- A aba Gerencial (pendência adiada pelo dono do projeto).
- Qualquer mudança na fórmula do semáforo da aba Alertas — o bloco novo é
  adicional, o existente não muda.
