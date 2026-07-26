# Gráfico ORÇAMENTO — Fechar o hiato entre Realizado e a série futura — Design

## Contexto

Depois da mudança "um mês com Realizado nunca mostra a série futura junto" (Tendência, e agora Realizado + Previsto Inicial), o painel **Acumulado** ficou com um hiato visual entre o último mês de Realizado (ex.: junho) e o primeiro mês da série futura (ex.: julho) — cada série desenha sua própria `<polyline>` cortada nos seus próprios `null`, e como a série futura só passa a ter valor a partir de julho, não existe nenhum segmento ligando os dois pontos. O usuário reportou o mesmo problema no painel Mensal em linha das dimensões de razão (Produtividade/Ticket Médio), que usa a mesma função de desenho.

Confirmado com o usuário: a bolinha/marcador de junho continua sendo só a do Realizado (verde) — não duplica um segundo marcador colorido da série futura em cima. Só a **linha** entre junho e julho passa a ser traçada, na cor/tracejado da série futura.

## Escopo

- **Painel Acumulado** (Equipes/Volume/Financeiro): fecha o hiato pras séries Tendência e Realizado + Previsto Inicial.
- **Painel Mensal em linha** (Produtividade/Ticket Médio, razão): mesmo fechamento, mesmas duas séries.
- **Painel Mensal em barra** (Equipes/Volume/Financeiro, soma): **sem mudança** — já não mostra barra da série futura no mês do Realizado (comportamento correto, decidido antes), e barra não tem conceito de "hiato" entre colunas discretas.

## Mecanismo

**Matemática (volta ao que era antes de hoje):** `calcularAcumuladoAposRealizado(mensalFutura, acumuladoRealizado, ultimoMesRealizado)` volta a preencher `resultado[ultimoMesRealizado] = acumuladoRealizado[ultimoMesRealizado]` (em vez do `null` atual) — o ponto de conexão passa a ter, de novo, um valor real na série futura, matematicamente idêntico ao acumulado real do Realizado naquele mês.

**Desenho (novo):** `construirLinhasSvg` passa a receber, por série, um índice de conexão opcional (`indiceConector`). No mês igual a esse índice, o ponto:
- **entra** no trecho da `<polyline>` (fecha o hiato, traçado na cor/tracejado da série futura, já que é o mesmo `<polyline>` que segue pros meses seguintes);
- **não** desenha `<circle class="grafico-marcador">`, **não** desenha `<circle class="grafico-hit">` (hover), **não** empurra rótulo em `rotulos` — o Realizado já desenhou os três ali, no mesmo `x,y` exato (mesmo mês, mesmo valor).

Fora do mês de conexão, nada muda: pontos normais continuam desenhando marcador + hover + rótulo do jeito que já fazem hoje.

## Onde o índice de conexão vem

`indiceConector` só existe pras séries que têm o conceito de "parte de onde o Realizado parou" — Tendência (`total`) e Realizado + Previsto Inicial (`realizadoPrevistoInicial`). Pras outras (`previstoInicial`, `previsto`, `realizado`), é `null`/ausente — nunca suprime nada.

Pro painel **Acumulado**, o valor de conexão já existe (é `acumuladoRealizado[ultimoMesRealizado]`, reintroduzido pela reversão da matemática acima) — só falta passar `ultimoMesRealizado` como `indiceConector` pra essas duas séries.

Pro painel **Mensal em linha** (razão), a MATRIZ nunca tem um valor de Tendência/Previsto Inicial próprio EXATAMENTE no mês de conexão (mesma regra "se tem R não tem T" já documentada) — então `construirPainelGraficoHtml` passa a injetar explicitamente, só quando `ehRazao`, o valor de Realizado do próprio mês de conexão (`mensalRealizado[ultimoMesRealizado]`) na posição `ultimoMesRealizado` do `mensal` de `total` e de `realizadoPrevistoInicial` — só pra alimentar a linha; o painel Mensal em BARRA (soma) nunca recebe esse patch, continua null ali (sem barra), exatamente como está hoje.

## Testes

- `calcularAcumuladoAposRealizado`: os 2 testes existentes (que hoje esperam `null` no mês de conexão) voltam a esperar o valor herdado do Realizado ali — mesma asserção que existia antes da mudança de hoje.
- `construirLinhasSvg`: novo teste unitário confirmando que, com `indiceConector` setado, o mês de conexão entra na `<polyline>` (o `points=` inclui as coordenadas desse mês) mas não gera `<circle class="grafico-marcador">` nem `<circle class="grafico-hit">` nem rótulo ali — e que os pontos normais (fora do índice de conexão) continuam gerando os três normalmente.
- `construirPainelGraficoHtml`: teste de regressão confirmando visualmente (via contagem de elementos no HTML) que o painel Acumulado não tem mais hiato — a `<polyline>` da série futura inclui o ponto de junho — e que o painel Mensal em BARRA continua sem nenhuma barra da série futura em junho (guarda contra regressão do comportamento já corrigido).
