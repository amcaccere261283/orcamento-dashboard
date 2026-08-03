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

## O que falta implementar

1. Ler as abas EQ mensais no build (HTTP; o build hoje só lê `.xlsx` do `G:`).
2. Apropriação (OS → SUP; última OS; bucket "não apropriadas").
3. Mapa de tipologia com as regras acima + cruzamento por sondador.
4. Trocar a fonte de `equipesPorDia` em `compute-balanco.js` (o consumo já
   existe e não muda).
5. **Live-refresh**: precisa da aba EQ publicada como CSV (mesmo setup de Apps
   Script do Avanço Sond). Sem isso, equipes congelam no dado do build.

Até isso ficar pronto, a barra segue mostrando **mobilizadas** — correto, só
mais restrito que o alvo.
