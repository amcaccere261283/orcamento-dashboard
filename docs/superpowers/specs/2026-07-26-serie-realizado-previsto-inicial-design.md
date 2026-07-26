# Gráfico ORÇAMENTO — 5ª série "Realizado + Previsto Inicial" — Design

## Contexto

O Gráfico (`docs/superpowers/specs/2026-07-21-grafico-orcamento-design.md`) hoje mostra 4 séries: Previsto Inicial, Previsto, Realizado, Tendência. O usuário quer uma 5ª referência: **Realizado até o último mês reportado, seguido de Previsto Inicial (a linha de base original, nunca revisada) pros meses restantes** — "e se o resto do ano seguisse o orçamento original, em vez do Previsto atualizado?". Conferido com o build real (financeiro, sem filtro): Realizado Jan-Jun + Previsto Inicial Jul-Dez fecha em **R$ 103.930.753** (~104MM), batendo com a expectativa do usuário.

Confirmado com o usuário: essa série é **só do Gráfico** (Mensal + Acumulado), nunca da Tabela — não faz sentido como uma 5ª linha por registro ali.

## Nome e identidade visual

- Rótulo: **"Realizado + Previsto Inicial"**.
- Chave interna: `realizadoPrevistoInicial`.
- Cor: roxo `#a78bfa` (5ª cor categórica, distinta das 4 já usadas: cinza/azul/verde/âmbar).
- Traço: dash-dot `6,3,1,3` (distinto dos 4 já usados: `2,4` / sólido / `1,5` / `9,5`).
- Desmarcada por padrão no filtro de série (mesma convenção do Previsto Inicial hoje).

## Onde entra no código

`ORDEM_SERIES` (que gera as 4 linhas por registro da Tabela via `renderBlocosDimensao`) **não muda** — a Tabela continua igual. Uma nova constante `ORDEM_SERIES_GRAFICO = ORDEM_SERIES.concat(['realizadoPrevistoInicial'])` é usada só dentro de `construirPainelGraficoHtml`, no lugar de `ORDEM_SERIES`, pra decidir quais séries desenhar.

O filtro de série (`filtro-serie`, dropdown compartilhado Tabela+Gráfico) ganha uma 5ª `opcaoFixa` (`{ valor: 'realizadoPrevistoInicial', rotulo: 'Realizado + Previsto Inicial' }`). Como nenhuma `<tr>` da Tabela tem `data-serie="realizadoPrevistoInicial"`, marcar essa opção não tem efeito visível na Tabela — só filtra o Gráfico. Reaproveita a UI existente, sem controle novo (trade-off aceito pelo usuário).

`SERIE_LABELS`, `SERIE_COR`, `SERIE_TRACEJADO` ganham a entrada `realizadoPrevistoInicial` (label/cor/traço acima).

## Cálculo

Reaproveita a mesma mecânica já usada pela Tendência (`ultimoIndiceComDado` sobre o Realizado já limpo de artefatos de zero via `removerZerosFinaisNaoReportados`, ver `2026-07-26` fix anterior) — **mesmo corte dinâmico**, não um mês fixo:

- **Mensal**: `null` em todo mês `<= ultimoMesRealizado` (mês com Realizado nunca mostra essa série junto — mesma regra já aplicada à Tendência: "um mês com Realizado nunca mostra outra série de projeção"). Em todo mês `> ultimoMesRealizado`, usa o valor de **Previsto Inicial** daquele mês (não Previsto atual, não a linha T da MATRIZ).
- **Acumulado**: a função `calcularAcumuladoTendencia` é generalizada (renomeada `calcularAcumuladoAposRealizado`, mesma assinatura `(mensalFutura, acumuladoRealizado, ultimoMesRealizado)`) e reaproveitada pra ambas as séries — Tendência chama com a própria mensal (T da MATRIZ), a nova série chama com o mensal já mascarado de Previsto Inicial (null até `ultimoMesRealizado`, valor de Previsto Inicial dali em diante). A soma interna herda `acumuladoRealizado[ultimoMesRealizado]` e soma só a contribuição própria dali pra frente; o mês de conexão em si fica `null` (mesmo comportamento já corrigido pra Tendência — só o 1º mês futuro em diante fica visível).
- **Casos extremos**: sem nenhum Realizado no recorte (`ultimoMesRealizado === -1`) → acumula Previsto Inicial sozinho desde Jan (fallback já existente na função reaproveitada). Ano inteiro já com Realizado (`ultimoMesRealizado === 11`) → série inteira `null` (nada a substituir).

Como Previsto Inicial nunca tem mês `null` (preenchido com zero quando não há match com a linha de base, ver `anexarPrevistoInicial`), a série nunca tem buracos inesperados na parte futura.

## Dimensões

Mesmo tratamento das 4 séries já existentes: existe pras 5 dimensões (Equipes, Volume, Financeiro, Produtividade, Ticket Médio), sem caso especial só pra Financeiro. Pra Produtividade/Ticket Médio (razão, só linha mensal, sem painel Acumulado — regra já existente), a série usa a mesma máscara (null até o corte, razão de Previsto Inicial dali em diante).

## Testes

- `calcularAcumuladoAposRealizado` (renomeada): mesmos testes que já existem pra `calcularAcumuladoTendencia`, sem mudança de comportamento pra quem já chama.
- Novo teste de `construirPainelGraficoHtml` com dados reais (Realizado Jan-Jun + Previsto Inicial Jul-Dez) fechando em ~104MM no painel Acumulado — mesmo estilo do teste real já existente pro bug do zero-artefato.
- Teste do mês de conexão: mês com Realizado não desenha a nova série (Mensal); Acumulado só fica visível a partir do 1º mês futuro.
- Fallback sem Realizado (acumula Previsto Inicial sozinho desde Jan) e ano inteiro realizado (série vazia).
