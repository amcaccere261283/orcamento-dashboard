# Ramo `R > P` da Tendência semanal deixa de estender o ritmo — design

Data: 2026-08-17. Página: Planejamento Semanal (`docs/planejamento-semanal.html`).
Escopo: só esta página — o dashboard de orçamento não é tocado.

## O pedido

Hoje, quando um SUP fecha as semanas anteriores acima do plano (ramo `R > P` de
`calcularTendenciaSemanal`, ver
`docs/superpowers/specs/2026-08-04-semanal-tendencia-regras-e-alertas-design.md`),
a Tendência projeta a semana vigente e as futuras **estendendo o mesmo ritmo médio**
que já superou o Previsto. Isso tem dois efeitos indesejados, apontados pelo dono do
projeto em 2026-08-17:

1. **Infla a leitura da semana fechada.** O ritmo acumulado de semanas passadas
   carrega a projeção pra frente mesmo quando a semana em curso, isoladamente, não
   está entregando nada — a Tabela mostra um número saudável numa semana que na
   verdade está parada.
2. **Esconde a necessidade de mover equipe.** Uma equipe que produziu acima do
   plano e depois foi deslocada (ou parou por qualquer motivo) continua aparecendo
   com Tendência alta, porque a fórmula só olha o ritmo histórico — não o que está
   de fato acontecendo na semana vigente.

Pedido: a Tendência do ramo `R > P` passa a **mirar o Previsto de cada semana**
(igual ao ramo `R ≈ P` já faz), em vez de extrapolar o ritmo; e o excedente
projetado que hoje sustenta o Alerta A ("Avaliar equipe e demanda") sai de cena —
entra um alerta novo que detecta quando essa equipe parou de avançar na semana
vigente, para provocar a decisão de movimentá-la.

## Decisão 1 — nova fórmula do ramo `R > P`

Só a **projeção** muda; a **classificação** do ramo continua idêntica: comparação
`R_ac` (Realizado acumulado nas semanas totalmente encerradas) contra `P_ac`
(Previsto das mesmas semanas), tolerância de 1% (`escolherRamo`, inalterada).

| | Antes | Depois |
|---|---|---|
| Semana vigente | `realizado parcial + ritmo × dias restantes dela` | `max(Previsto da semana, realizado parcial)` |
| Semanas futuras | `ritmo × dias da semana` | `Previsto da semana` (fatia inteira — a mesma que a linha Previsto exibe) |

É literalmente a mesma fórmula que o ramo `R ≈ P` já usa. No código
(`calcularTendenciaSemanal`, `tools/semanal/compute-tendencia-semanal.js`), o `if
(ramo === 'igual')` passa a cobrir também `ramo === 'acima'`; o bloco de ritmo
(`base + ritmoPorDia * diasDaFatia`) fica reservado só para o ramo `R < P` no caso de
borda `saldo <= 0` — que não muda.

**Nada muda para semanas já encerradas** (`k < fechadas`): continuam mostrando o
Realizado, como sempre.

**O ramo `R < P` não é tocado.** Continua compensando o saldo não realizado nas
semanas seguintes, mirando o Previsto do MÊS inteiro — é o comportamento que o
pedido de 2026-08-04 já definiu e que este pedido não questiona.

### Consequência no `diagnostico`

- `previstoAPartirDeHoje` e `tendenciaAPartirDeHoje` existiam só para o Alerta A
  calcular quanto a projeção passava do plano dali pra frente. Com a nova fórmula,
  a projeção futura do ramo `acima` **é** o Previsto por construção — o excedente
  que esses dois campos mediam vira ~0 sempre, e o cálculo fica morto. Os dois
  campos **saem** de `diagnostico` (e o bloco de código que os produz, linhas
  120–138 do arquivo atual).
- `realizadoVigente` — hoje uma variável local dentro de `calcularTendenciaSemanal`
  — **entra** em `diagnostico`. É o dado que o alerta novo precisa (ver Decisão 2) e
  já está calculado; só passa a ser exposto.
- `ritmoPorDia`, `saldo`, `diasRestantesMes`, `realizadoAcumulado`,
  `previstoAcumulado`, `semanasFechadas`, `indiceVigente` continuam exatamente como
  estão — `ritmoPorDia` em particular vira a evidência do alerta novo (ver abaixo),
  mesmo não sendo mais usado para projetar.

## Decisão 2 — o alerta novo substitui o Alerta A

Módulo: `tools/semanal/compute-alertas-tendencia.js`. O ramo `e.ramo === 'acima'`
de `avaliarAlertaTendencia` é reescrito:

- **Tipo**: `movimentacao` (troca `demanda`). Rótulo em `ALERTA_ROTULO`:
  **"Avaliar movimentação de equipe"** (troca "Avaliar equipe e demanda").
- **Dispara quando** `diagnostico.realizadoVigente === 0` — a semana em curso já
  começou (`indiceVigente >= 0`, garantido por construção sempre que `ramo ===
  'acima'`: ver nota de borda abaixo) e não tem nenhum furo registrado nela ainda,
  mesmo com as semanas fechadas acima do plano.
- **Não dispara** com qualquer `realizadoVigente > 0`, por menor que seja — o
  alerta é "essa equipe parou", não "essa equipe está mais lenta que antes".
- **Evidência**: ritmo médio das semanas fechadas (`ritmoPorDia`) + "nenhum avanço
  registrado na semana em curso". Formato:
  `"Ritmo médio nas semanas fechadas " + formatarNumero(ritmoPorDia, 2) + " furos/dia · nenhum avanço registrado na semana em curso"`.
- **Não depende de insumo externo.** Ao contrário do Alerta A antigo (que
  precisava de `pendentesNaData` para saber o saldo de demandas), os dois números
  que decidem o alerta novo (`ramo`, `realizadoVigente`) já vêm do próprio
  `diagnostico` — não existe caminho "sem-dado" por insumo externo faltando para
  este alerta. `renderLinhaGrupo` (`render-alertas-tendencia.js`) para de calcular
  `saldoDemandas` para passar a `avaliarAlertaTendencia` (fica morto para este
  ramo; `pendentesNaData` continua existindo e sendo usado pela aba Alocação
  Equipes).

**Nota de borda, registrada por completude:** com a comparação de ramo usando
sempre semanas totalmente encerradas e o guard de "mês inteiramente no passado"
retornando `sem-dado` antes de chegar aqui, `ramo === 'acima'` só é possível com
`indiceVigente >= 0` — não existe cenário em que o ramo seja `acima` e o mês esteja
inteiramente no futuro (nesse caso `R_ac = P_ac = 0`, que cai em `igual`) ou
inteiramente no passado (retorna `sem-dado` mais cedo). O código não precisa de
guarda extra para isso, mas não custa deixar comentado — é o mesmo estilo de nota
que o resto do arquivo já usa para caminhos inalcançáveis.

**Decisão explícita, sem trava extra:** o gatilho é `realizadoVigente === 0` sem
exigir um número mínimo de dias decorridos na semana vigente — inclusive no
primeiro dia dela. É deliberado (bate com "ainda não tivemos avanço na semana", o
cenário que motivou o pedido).

> **Correção de 2026-08-17 (mesmo dia).** A versão original deste parágrafo dizia
> que o disparo era garantido POR CONSTRUÇÃO em toda segunda-feira, porque o
> Realizado parava em d−1 e o intervalo da semana vigente ficava vazio no primeiro
> dia dela. **Isso deixou de valer no mesmo dia:** o corte do Realizado passou a ser
> HOJE (ver `2026-08-17-realizado-ate-hoje-design.md`), e a segunda-feira pode ter
> avanço registrado. O disparo ainda é provável de manhã — a captura das 8h pega a
> segunda quase vazia — mas é circunstância, não garantia. A decisão de não colocar
> trava de dias mínimos foi mantida pelo dono do projeto depois dessa mudança.

## Decisão 3 — o que não muda

- Ramo `R < P` e o Alerta B ("Equipes com pouco recurso ou improdutividade"):
  intocados, fórmula e código idênticos aos de hoje.
- Ramo `R ≈ P`: intocado — a fórmula do ramo `acima` passou a ser literalmente a
  mesma, então não há nada a mudar nele.
- Regra 2.1 ("Tendência nunca sobre o Realizado"), mês inteiramente no passado
  (Tendência sem dado) e mês inteiramente no futuro (Tendência = Previsto):
  inalterados — são guardas anteriores à escolha de ramo.
- **Consolidado congelado** (`ancoraDaSemana`, recomputa `calcularSeriesSemanaisDimensao`
  com `hojeEpoch = semana.inicio`) e a **aba Alocação Equipes** (mesmo mecanismo de
  âncora): continuam funcionando sem mudança de código — herdam a fórmula nova
  automaticamente porque chamam a mesma função. O número que aparece congelado para
  uma semana que foi classificada `acima` na sua própria âncora muda (deixa de
  estender ritmo), o que é o comportamento correto e esperado, não uma regressão.
- **O invariante "Total da Tendência no mês corrente = ponto final da curva
  Acumulada dos Gráficos"** continua valendo estruturalmente — as duas leituras
  saem do mesmo array `saida`/`semanasTendenciaCompleta`. Os NÚMEROS de cenários de
  teste que hoje exercitam o ramo `acima` mudam; o invariante em si (o teste de
  regressão) não precisa mudar de forma, só de fixture.
- Dashboard de orçamento: fora de escopo, como sempre.

## Testes

- `test/semanal-compute-tendencia-semanal.test.js`: reescrever os casos de ramo
  `acima` (semana vigente e futuras passam a mirar o Previsto, nunca mais o ritmo);
  adicionar caso `realizadoVigente` exposto em `diagnostico`; remover/ajustar os
  casos que hoje prendem `previstoAPartirDeHoje`/`tendenciaAPartirDeHoje` (saem do
  diagnóstico). Manter os casos de ramo `abaixo` e `igual` como estão — não devem
  mudar de resultado.
- `test/semanal-compute-alertas-tendencia.test.js`: trocar os testes do tipo
  `demanda` por testes do tipo `movimentacao` — dispara com
  `realizadoVigente === 0`, não dispara com `realizadoVigente > 0`, evidência com o
  texto novo. Remover os casos que dependiam de `saldoDemandas`/`excedenteProjetado`
  para este ramo.
- `test/semanal-render-alertas-tendencia.test.js`: atualizar o rótulo esperado na
  tabela ("Avaliar movimentação de equipe") e a coluna Evidência; manter intactos os
  testes do Alerta B (produtividade) e a trava "mudar SÓ o número de equipes
  previstas TEM de mudar o resultado" (não é afetada por esta mudança).
- Regressão: invariante do Total da Tendência = ponto final do Acumulado continua
  passando (fixture pode precisar de ajuste numérico, não de mudança estrutural).
- `orcamento-html-inalterado.test.js` continua passando — nada aqui toca o
  dashboard de orçamento.

## Fora de escopo

- Dashboard de orçamento, em qualquer aspecto.
- Ramo `R < P` e Alerta B.
- Uma trava de "dias mínimos decorridos" para o alerta novo — decisão registrada
  acima como default sem calibração, não como pendência aberta.
- Qualquer persistência do alerta (é recalculado a cada carregamento/atualização,
  igual a todo o resto da aba Alertas).
