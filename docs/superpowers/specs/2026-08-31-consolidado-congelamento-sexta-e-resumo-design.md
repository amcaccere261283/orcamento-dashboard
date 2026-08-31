# Consolidado: congelamento real às sextas 22h + resumo estilo relatório Excel — design

Data: 2026-08-31. Página: Planejamento Semanal, aba Consolidado.

## O pedido

1. Congelar a Tendência sempre às **sextas-feiras às 22h**, valendo para a **semana
   seguinte** (a que começa na segunda seguinte). Esse valor **nunca muda depois** disso,
   nem com lançamento retroativo — diferente do congelamento de hoje, que é recálculo.
2. A tela do Consolidado passa a mostrar um **resumo** igual à aba "Volume" do relatório
   Excel que o botão "Gerar relatório Excel" já produz (`compute-relatorio-semanal.js`):
   por SUP × Tipologia, **Previsto até a data / Realizado / Desvio até a data / Semana
   total**. Substitui a tabela atual da aba.
3. De forma análoga, manter **Tendência congelada + Realizado** para **Produtividade
   média** e para **Equipe** — dois blocos novos ao lado de Volume/Financeiro.

Confirmado com o dono do projeto: (1) é persistência real via job agendado, não recálculo
com âncora trocada; (3) substitui a tabela existente, não fica ao lado.

## Por que o mecanismo de hoje não serve

`render-aba-consolidado.js` (ver comentário no topo do arquivo) já "congela" a Tendência
— mas por **recálculo**: chama `calcularSeriesSemanaisDimensao` de novo com
`hojeEpoch = semanas[k].inicio` (o 1º dia da semana). O spec de 2026-08-04 que criou isso
descartou persistência explicitamente porque, na época, **este repositório não tinha
nenhum workflow agendado**. Isso mudou: hoje há 3 máquinas (Américo/Kairo/Patrick) rodando
`tools/semanal/atualizar-diario-escalonado.js` todo dia às 8h via Task Scheduler local,
cada uma verificando por `git fetch`/heartbeat se alguém já rodou, e publicando
(`git push origin HEAD:master`) quando termina. É a mesma infraestrutura que este pedido
vai reusar.

## Decisão 1 — snapshot real, não recálculo

Novo arquivo persistido, **`docs/tendencia-congelada-semanal.json`**, no mesmo padrão de
"histórico versionado" que o dashboard da Matriz já usa (`historico.json`). Formato:

```json
{
  "2026-09-07": {
    "geradoEm": "2026-09-04T22:00:00-03:00",
    "porRegistro": {
      "SUP-7133-24|SP": { "volume": { "tendencia": 12.3 }, "financeiro": { "tendencia": 45000 },
                           "produtividadeMedia": { "tendencia": 1.8 }, "equipe": { "tendencia": 2 } }
    }
  }
}
```

Chave de topo: **dia-epoch em `YYYY-MM-DD` do início da semana congelada** (a segunda da
semana seguinte à sexta em que o job rodou), UTC-3. Chave de `porRegistro`:
`chaveMatriz` (`sup + '|' + tipologia`, mesma convenção de `chaveDemandas`/`compute-
demandas.js`) — **por registro cru, nunca pré-agregado**: os totais por tipologia/SUP/geral
que a tela mostra são somados a partir daqui, exatamente como `blocosPorSup`/
`tipologiasPresentes` já fazem hoje — persistir só o nível fino evita ter que gravar (e
manter consistente) N agregações diferentes.

**Novo script `tools/semanal/congelar-tendencia-semanal.js`**, mesmo padrão de corrida
segura que `atualizar-diario-escalonado.js` já resolve (git fetch, heartbeat próprio —
`heartbeat-congelamento-semanal.csv` —, checagem antes e depois do trabalho, stash de
mudanças alheias). Calcula, para a semana que começa na segunda seguinte à sexta corrente:

- `volume`/`financeiro`: `calcularSeriesSemanaisDimensao(..., hojeEpoch = agora)`, lendo
  `semanasTendenciaCompleta[indice da semana alvo]` — a semana alvo ainda não começou às
  22h de sexta, então esse valor É a projeção viva no momento do congelamento (mesmo
  ramo/fórmula de `compute-tendencia-semanal.js`, sem nada novo a inventar).
- `equipe`: mesmo mecanismo com `dimensao = 'equipes'` — a Tendência de Equipes já existe
  (linha `BASE=T` da MATRIZ, ver seção "Tendência de Equipes" no `CLAUDE.md` do projeto) e
  não muda por ramo (é premissa fixa do mês), então congelar aqui é principalmente sobre
  Volume/Financeiro, mas entra pela mesma função por uniformidade.
- `produtividadeMedia`: **não tem série própria hoje.** Calculada como
  `tendencia.volume / tendencia.equipe` quando os dois existirem (mesma relação que
  `produtividadeEsperada` já usa entre volume e equipes previstos) — se `equipe` for 0/nulo,
  fica `null` (sem dado), nunca divisão por zero.

**Agendamento:** Task Scheduler nas 3 máquinas, sexta-feira ~22h (documentar em
`docs/setup-atualizacao-escalonada.md`, seção nova). Não precisa de Chrome — os dados que
alimentam `calcularSeriesSemanaisDimensao` já estão no `dist/*.csv`/build corrente, então
o job só lê o que já foi publicado no build de hoje, sem buscar nada online.

**O que acontece se o job falhar nas 3 máquinas numa sexta:** a semana seguinte simplesmente
não ganha entrada em `tendencia-congelada-semanal.json`. O Consolidado cai no fallback da
Decisão 2 para aquela semana específica — nunca quebra a tela, só deixa de cumprir "nunca
muda" para essa semana isolada. Fica registrado como pendência conhecida, não corrigido
neste trabalho (mecanismo de alerta como o `alertar-atualizacao-diaria.yml` já existente
poderia ser estendido depois, fora de escopo aqui).

## Decisão 2 — como o Consolidado lê o congelado

`render-aba-consolidado.js` passa a receber um `congeladoSemanal` opcional (o JSON acima,
ou a fatia da semana em tela). Para a semana selecionada:

- **Existe entrada no snapshot** → usa ela, ponto final, **mesmo que a semana já tenha
  lançamento retroativo depois**. É o "nunca muda" pedido.
- **Não existe** (semana futura demais, ainda sem sexta 22h passada; ou semana antiga, de
  antes deste recurso existir; ou falha do job) → cai no comportamento de HOJE
  (recálculo com `hojeEpoch = início da semana`), com uma marca visível na tela (ex.: rótulo
  "recalculada" em vez de "congelada") avisando que esse número específico ainda pode mudar.
  Semana futura sem sexta 22h ainda passada (mais de uma semana à frente) continua
  "projeção viva", como hoje.

## Decisão 3 — a tela vira o resumo do relatório Excel

A tabela atual do Consolidado sai. No lugar, a mesma estrutura de
`compute-relatorio-semanal.js` (`montarLinhasDimensao`/`janelasDoGrupo`), mas usando as
**3 janelas já existentes lá — Semana anterior / Acumulado do mês até a data / Semana
vigente — trocadas pela ÚNICA semana que o seletor da aba tem selecionado** (a aba
Consolidado não tem os 3 recortes do relatório, tem 1 semana por vez): colunas **Previsto
até a data, Realizado, Desvio até a data, Semana total** — mesmos nomes/cálculo do
`.xlsx`, para a tela e o relatório nunca divergirem na leitura.

`compute-relatorio-semanal.js` é reaproveitado por importação (`serieDaSemana` já separa
"a semana X" de "hoje" e já teria de aceitar Tendência vinda de fora — ver abaixo), não
duplicado. `janelasDoGrupo`/`montarLinhasDimensao` continuam servindo só ao `.xlsx`
(3 janelas fixas); o Consolidado ganha um caminho próprio, **`linhaResumoSemana`**, que
chama `serieDaSemana` para a única semana escolhida.

**"Previsto até a data" e "Semana total"** replicam a mesma dupla que o `.xlsx` já mostra:
Previsto acumulado até hoje dentro da semana (fração dela) vs. Previsto da semana inteira.
"Desvio até a data" = Realizado ÷ Previsto até a data − 1 (mesma fórmula do `.xlsx`,
`desvioDaJanela`, adaptada: aqui é sempre a semana escolhida, nunca "semana vigente"
especificamente — quando a semana escolhida ainda não terminou, o numerador é a Tendência
CONGELADA/recalculada, não o Realizado parcial puro, pela mesma razão que
`desvioDaJanela` já documenta: comparar Previsto inteiro contra Realizado parcial acusa
desvio falso).

**Dois blocos novos, mesma forma de tabela**, abaixo do de Volume/Financeiro:
**Produtividade média** e **Equipe**, cada um com as mesmas 4 colunas, usando a Tendência
do snapshot (Decisão 1/2) no lugar do Previsto-projetado e o Realizado correspondente
(Realizado de Equipes já existe — `demandas.equipesPorDia`; Realizado de Produtividade
média = Realizado Volume ÷ Realizado Equipes da mesma janela, `null` se equipe for 0).
Não têm "Previsto" (não são premissas de planilha, são projeção/medição), então a coluna
correspondente mostra a Tendência congelada rotulada como tal — mesma solução visual que
`renderCabecalho` já usa hoje para nomear explicitamente "congelada" vs. "recalculada" vs.
"projeção viva".

**As colunas de premissa (Equipes previstas / Produtividade média esperada / Ticket
médio previsto) SAEM** — ficam substituídas pelos blocos de Tendência+Realizado acima, que
carregam informação equivalente (e mais: têm o Realizado ao lado). A nota de rodapé da aba
é reescrita de acordo (não faz mais sentido falar em premissas do mês que não existem
mais na tela).

## Fora de escopo

- Alertas/mecanismo de e-mail se o congelamento de sexta falhar nas 3 máquinas (ver
  Decisão 1, "o que acontece se o job falhar").
- Qualquer mudança em Semanal/Alertas/Balanço/Demandas — só Consolidado.
- Congelar dimensões que a barra não expõe hoje (a aba continua coagindo `equipes`→`volume`
  pra exibição de linhas, ver `dimensaoDaTabela` — o bloco "Equipe" novo é a EXCEÇÃO
  deliberada: ele mostra equipe mesmo com a barra em Volume/Financeiro, porque é um bloco
  fixo da tela, não a dimensão principal da tabela).

## Testes

- Snapshot: `congelar-tendencia-semanal.js` grava a entrada certa para a semana seguinte;
  rodar duas vezes no mesmo dia não duplica (mesma semana-alvo, sobrescreve); heartbeat
  evita corrida entre as 3 máquinas (mesmo padrão de teste que
  `atualizar-diario-escalonado.js` já tem).
- Consolidado: com snapshot presente, o valor exibido bate com o snapshot e NÃO muda
  quando o Realizado do período muda por baixo (prova por mutação: mudar o registro e
  confirmar que só quem não tem snapshot muda). Sem snapshot, cai no recálculo de hoje e
  mostra o rótulo "recalculada".
- Resumo: as 4 colunas (Previsto até a data/Realizado/Desvio/Semana total) batem com o
  que `compute-relatorio-semanal.js` calcularia para a mesma semana isolada.
- Produtividade média/Equipe: Realizado = Volume Realizado ÷ Equipe Realizado da mesma
  janela; `null` quando Equipe é 0/sem dado, nunca `Infinity`/`NaN`.
