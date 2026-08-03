# Δ equipes ATIVAS no Balanço de massa — desenho

Data: 2026-08-03. Decisões do dono do projeto marcadas como **[decisão]**.

## O problema

A barra Δ equipes comparava o Previsto da MATRIZ contra a coluna Realizado de
equipes da mesma MATRIZ. Essa coluna é inservível nos dois sentidos:

- **0 no mês corrente** — 349 dos 350 registros em agosto/2026. Como 0 é lido
  como medição real, o Balanço desenhava déficit igual ao previsto inteiro em
  todo SUP.
- **vazia no mês fechado** — 350 de 350 em julho/2026.

Primeira correção (já publicada, commit `2a92907`): trocar a fonte para as
equipes **mobilizadas** medidas no Avanço Sond. Funciona, mas mede menos do que
o Previsto pede — ver abaixo.

## A métrica

**[decisão]** A barra deve comparar **equipes ATIVAS** contra o Previsto, sendo
ativa a equipe que está em campo — produzindo ou não — e **excluindo férias e
baixada**. "As que não estão em campo não são ativas, então desconsiderar."

Medido em equipe-dia (julho/2026):

| | equipe-dia |
|---|---|
| Avanço Sond — com furo em execução (o que está no ar) | 1.637 |
| Matriz — mobilizada (OS ou OK) | 1.499 |
| Matriz — em campo sem furo | 346 |
| **Matriz — ATIVAS (o alvo)** | **1.845** |
| Matriz — fora (férias, baixada, folga, falta) | 778 |
| Matriz — não é equipe (contratação, auxiliar, encarregado) | 950 |

Agosto: 1.982 ativas.

**A unidade é "equipe equivalente"** = equipe-dia ÷ dias do período. Contar
pessoas distintas por (SUP, tipologia) infla: em julho, 95 sondadores viravam
185 "equipes", porque o mesmo atende vários contratos e é contado inteiro em
cada um. Ver `compute-equipes-mobilizadas.js`.

**A janela para sempre em hoje.** Sem isso a média do mês corrente é dividida
pelos dias que ainda não aconteceram (em 03/08, agosto dava 3,5 contra 52,8 de
julho).

## As fontes

| Dado | Onde | Chave |
|---|---|---|
| Estado diário da equipe | Planilha de equipes `1Mgj87eSKMO4Gh2aHQWChNl5YCH2vatMDC2fCNuxB8TU`, aba `2026 - <MÊS> (EQ)`, uma coluna por dia | ID da equipe (col. A) |
| Tipologia da equipe | mesma aba, **coluna D "Serviços"** | — |
| Líder/sondador da equipe | mesma aba, coluna B | nome |
| OS → SUP | Avanço Sond, colunas H (OS) e A (Contrato) | **1.960 de 1.960 unívocas** |
| Furos por sondador | Avanço Sond, coluna Y (Sondador) | nome |

## Classificação do dia — feito (`classificar-dia-equipe.js`)

Quatro estados. **Lógica por exceção**: só ausência e não-equipe são
enumeradas; o default é "em campo". Medido: enumerar as formas de dizer
"trabalhando" é cauda infinita (tomador, trecho, colega, lugar — 572 equipe-dia
escapavam), enquanto ausência é finita e repetida.

## Apropriação ao SUP

A OS na célula do dia dá o SUP (1.960/1.960 unívocas). Nos dias sem OS
(mobilização, chuva, veículo quebrado): **última OS conhecida da equipe**. Sem
nenhuma OS no mês, a equipe entra em "não apropriadas" — visível, nunca
rateada em silêncio.

Descartados, com medição:
- **por nome de tomador**: só 4 dos 20 tomadores da EQ casam com os do Avanços
  (`Sorocabana` × `CCR Rota Sorocabana`), e mesmo casando, 36 dos 146 pares
  (tomador, tipologia) são ambíguos — o CCR RioSP tem 3 SUPs em toda tipologia.
- **por trecho de rodovia**: `RioSP (BR-116)` resolve, `RioSP (BR-101)` fica
  ambíguo entre SUP-6498-23 e SUP-6830-23.

## Tipologia — 13 equipes multi

A coluna D traz valor múltiplo em 13 das 117 equipes. **O sufixo `(pi)`/`(st)`
que a operação deveria preencher NÃO está lá** — varrida a linha inteira das 6
equipes `ST | PI | BL` em julho e agosto, nenhuma célula tem `(PI)`, `(ST)` ou
`(BL)`.

Regras **[decisão]**:

| Valor em "Serviços" | Equipes | Tipologia |
|---|---|---|
| `CPTu \| VT \| SH` | 175, 257, 297, 434, 564, 575 | **Especiais** |
| `SP/SM` | 626 | **SP** |
| `ST \| PI \| BL` | 353, 389, 595, 620, 621, 629 | cruzar por sondador |

**[decisão]** SEG.A e SEG.V são **segurança**, nunca Especiais.

Para as 6 de `ST | PI | BL`: cruzar o líder (col. B) com o Sondador do Avanço
Sond e usar a tipologia dos furos dele. Medido com normalização de tokens
(sem acento, sem preposições, sem Filho/Junior): **5 das 6 casam com um
sondador único**; só o ID 629 (Wanderson Silvestre) não tem correspondência.
No geral: 86 de 117 equipes casam com 1 sondador, 25 sem correspondência, 6
ambíguas.

**[decisão]** O ideal é tratar tudo por ID de equipe. O Avanço Sond não tem ID,
só o nome do sondador — o cruzamento por nome é a ponte possível hoje. Se a
operação passar a registrar o ID da equipe no Avanço Sond, ou o sufixo de
tipologia na coluna D, a ambiguidade zera.

## Sheet espelho da EQ — publicada em 2026-08-03

```
https://docs.google.com/spreadsheets/d/e/2PACX-1vQ7SaAZI8VwQaZD0nPxtOyw56b1XmKfqDTC6qSkj-1PAQr4A8ihTY4vZCOhF4PuMNIYm_-hN_CNdNrX/pub?gid=199381651&single=true&output=csv
```

Aba `EQ ESPELHO`, alimentada por `tools/semanal/apps-script-espelho-eq.gs` a
cada 30 min. **O gid é fixo para sempre**: o script resolve qual aba mensal
copiar (`AAAA - MÊS (EQ)`), então em setembro ele passa a copiar setembro sem
ninguém mexer na URL. Publicar a aba mensal direto teria o efeito oposto —
a URL continuaria servindo agosto, sem erro e sem aviso.

**O cabeçalho de dia vem diferente do export direto**: o Apps Script copia
valores, então a data chega como data e o CSV a serializa `01/08/2026`, não
`1-Aug`. `RE_COLUNA_DIA` aceita os dois. Sem isso nenhuma coluna de dia seria
reconhecida no live-refresh — e o efeito seria mudo, porque equipe sem dias é
equipe sem equipe-dia, não um erro.

Conferido no ato de publicar: espelho e export direto dão as MESMAS 117
equipes, 31 dias e a mesma lista de IDs. As 212 células (5,8%) com texto
diferente são edição real da planilha entre as duas coletas — a programação
muda ao longo do dia --, não erro de conversão.

## Mês sem dado da aba EQ — **[decisão]** fica sem dado e AVISA

A Sheet espelho só carrega o mês corrente, e as abas mensais anteriores podem
não existir ou não ser alcançáveis. Nesses meses o Δ equipes **não desenha
barra nenhuma** e a aba **mostra um aviso** dizendo que não há dado de equipes
para o período — nunca cai calado no Avanço Sond.

O motivo de não usar o Avanço Sond como reserva: ele mede outra coisa (equipes
mobilizadas com furo em execução, 1.637 equipe-dia em julho, contra 1.845
ativas). Preencher a barra com ele deixaria a série sempre cheia e misturaria
duas métricas na mesma linha, sem o usuário ter como perceber — a leitura
mudaria de significado conforme o mês escolhido. Barra vazia com aviso é
informação; barra cheia com número de outra métrica é erro silencioso.

Segue o mesmo princípio do banner `aviso-gids-fallback` do dashboard da matriz:
quando a fonte não é a esperada, a tela diz isso em vez de fingir normalidade.

## Estado

**Pronto e testado** (não ligado na página):

- `classificar-dia-equipe.js` — os 4 estados, lógica por exceção.
- `compute-equipes-ativas.js` — `parseAbaEq` (aceita os dois formatos de
  cabeçalho de dia), regras de tipologia, `casarSondador`,
  `agregarEquipesAtivas` (apropriação por OS/última OS) e `juntarPorDia`.
- Sheet espelho publicada e conferida.

Validação de ponta a ponta contra a espelho real (agosto/2026): 1.938
equipe-dia ativos, **1.599 apropriados** a um par (SUP, tipologia) = 82,5%;
332 não apropriadas, 7 sem tipologia.

**Falta:**

1. Ler a aba EQ no build. Hoje o build é SÍNCRONO e só lê `.xlsx` do `G:`;
   a EQ vem por HTTP, então `build()` precisa virar assíncrona.
2. Montar `osParaSup` e `tipologiaPorSondador` no build (o Avanço Sond já é
   lido ali; falta expor a coluna OS em `parseAvancos`, que hoje não a devolve).
3. Trocar a fonte de `equipesPorDia` em `compute-balanco.js` — o consumo já
   existe e não muda.
4. Live-refresh pela URL do espelho.
5. Aviso de mês sem dado (ver a decisão acima).

Até isso, a barra segue mostrando **mobilizadas** — correto, só mais restrito
que o alvo.
