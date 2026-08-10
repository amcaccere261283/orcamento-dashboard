# Tabela Semanal — regras linha a linha (2026-08-10)

Especificação fechada com o dono do projeto para **a Tabela Semanal**, linha a
linha. Escopo: só essa tabela. Gráficos, Balanço, Demandas, Alertas e
Consolidado ficam para depois.

Tudo aqui foi medido contra dado real em 2026-08-10 — os números estão no
texto para que ninguém precise remedi-los para decidir.

---

## EQUIPES

### Previsto (azul) — CORRETO, não mexer

Vem de `registro.previsto.equipes[mês]` da MATRIZ. Agosto/2026 = 86.

### Realizado (verde) — ERRADO, reescrever

**Regra:** a quantidade de equipes vem do **Link 6** (roster, aba "(EQ)"). O
**Link 7** diz quem produziu e onde. Quem estava ativo mas não produziu naquele
dia é alocado no **último contrato onde produziu**.

Três decisões do dono do projeto (2026-08-10):

1. **"Ativa" = tudo menos férias/baixada/folga** — o estado `fora` de
   `classificar-dia-equipe.js`. Inclui, portanto, o balde `naoEquipe`
   (contratação, admissão, encarregado, auxiliar), que a definição anterior
   (de 2026-08-03, `mobilizada + campoSemFuro`) descartava.

   Medido em agosto/2026, média por dia:

   | definição | média (1–8/08) | só dias úteis |
   |---|---|---|
   | mobilizada + campoSemFuro (anterior) | 66,6 | 69,0 |
   | **tudo menos `fora`** (esta) | **76,8** | **79,4** |
   | todas as linhas do roster | 84,8 | 87,0 |

2. **Domingo sai da conta; sábado conta.** Semana cheia = **6 dias**
   (segunda a sábado), e a média divide por 6. **Exceção:** quando a semana
   tiver *só* domingo (acontece no recorte de mês, que corta as semanas
   dentro do mês), esse domingo é contado sozinho — senão a semana ficaria
   sem denominador.

   Medido na semana 03–09/08 (dado até o dia 8): seg..sáb ÷ 6 = **77,3**;
   seg..sex ÷ 5 = 79,4; seg..dom ÷ 7 = 66,3 (o que está errado hoje).

3. **Equipe que nunca produziu fica FORA da conta.** A busca do "último
   contrato" olha no máximo **45 dias** para trás. Sem produção nessa janela,
   a equipe não entra — não se inventa alocação. Medido: 5 a 10 equipes por
   dia caem nesse caso.

**O filtro por SUP/tipologia tem que funcionar sobre esse número** — ou seja, a
alocação é por par (SUP, tipologia), não um total da empresa.

#### O bloqueio estrutural (resolver primeiro)

`dist/equipes-online.csv` grava hoje `SUP,Tipo,DiaEpoch,Fracao` — **já
agregado, sem o ID da equipe**. Não dá para fazer carry-forward por equipe a
partir dele.

**Trocar o formato para a produção CRUA por equipe:**

```
IdEquipe,SUP,Tipo,DiaEpoch
```

uma linha por (equipe, dia, contrato). A fração e a alocação passam a ser
calculadas no **build**, cruzando com o roster — não mais no fetcher.

Isso atinge `atualizar-equipes-online.js`, `build-dashboard.js` **e**
`render-semanal.js` (caminho do refresh). Os três têm que mudar juntos: meia
implementação deixa build e refresh desenhando números diferentes na mesma
tela, que é exatamente o defeito que a regra 07 de 2026-08-10 proíbe.

#### O que já está verificado e destrava isso

**O join Link 6 ↔ Link 7 funciona por ID: 70 de 71 `Nº Equipe` de agosto
existem no roster (99%).** A tentativa abandonada em 2026-08-09 casava por
NOME e cobria ~20% — foi por isso que `compute-equipes-fracao.js` ficou órfão.
Com ID o algoritmo é viável. (A coluna do Link 7 chamava-se `ID Sondador` até
2026-08-10 e hoje é `Nº Equipe`; `ROTULOS_ID_EQUIPE` aceita as duas.)

Protótipo rodado em 2026-08-10 (roster + Link 7 de julho/agosto, carry-forward
sem limite de 45 dias, definição de ativa anterior): média alocada 58,0 sobre
32 pares (SUP, tipologia).

### Tendência (amarelo) — ERRADO

Vem da planilha (MATRIZ, linha `BASE=T`) — isso está certo e não muda. O que
falta: **o valor tem que sumir nas semanas já encerradas.** Hoje ele se repete
em todas as semanas do mês, inclusive nas fechadas.

---

## VOLUME

### Previsto — CORRETO

### Realizado — ERRADO

Conta **todos** os ensaios do extrato de lab realizado (Link 4). Do extrato de
sondagens (Link 1), **retira** as linhas em que:

- `Deslocamento` = `"Sim"`, **ou**
- `Total (m)` = `0,01`, **ou**
- `Status Atual` = `"Cancelado"`

> **A confirmar:** li os três como critérios INDEPENDENTES (exclui se qualquer
> um bater). Se for conjunção, muda muito o volume excluído — perguntar antes
> de implementar.

`Deslocamento` já está implementado (2026-08-10, commit `ceb3720`): a coluna
própria do Link 1 substituiu um regex sobre `Observações de Campo`, que
derrubava 4.942 furos legítimos e deixava passar 157.

**Falta:** `mapear-producao-total.js` **descarta** hoje a coluna `Total (m)` —
ela precisa entrar em `HEADER_SAIDA` e ser lida por `parse-avancos.js`. O
`Status Atual` já é carregado.

### Tendência — CORRETA por enquanto

### Demandas — ERRADA

O estoque de demanda numa data D é montado de cinco fontes:

**Sondagem**
- **Link 2** — sondagens pendentes AGORA (snapshot).
- **Link 3** — só consulta, para resolver as sondagens do Link 2 (é dele que
  saem `Contrato` e `OS desde`, via join por OS).
- **Link 1** — o histórico: uma sondagem executada esteve pendente **de
  `Criação da OS` até `Executado Dia`**.

**Laboratório**
- **Link 5** — demanda de lab pendente agora.
- **Link 4** — o histórico: o ensaio esteve pendente **depois da `Data
  Programada` até o `Ensaiado Dia`**.

Regra de estoque já fechada em 2026-08-10 e mantida: na data D conta quem tem
pendência ≤ D e execução > D, com **D = o primeiro dia do período**.

---

## FINANCEIRO

### Previsto — CORRETO

### Realizado — ERRADO nos meses fechados

- **Mês vigente:** como está hoje (eventos do Avanço Sond × ticket médio).
  Correto.
- **Meses anteriores:** usar o valor da **MATRIZ** e repartir
  **proporcionalmente** entre as semanas do mês.

Exemplo dado pelo dono do projeto: em julho a página mostra 9.832 e a MATRIZ
tem **9.408** — o que deve aparecer é o 9.408 repartido entre as semanas.

`dividirEmSemanas` (`compute-semanal.js`) já faz exatamente essa repartição
proporcional por dias — é trocar a fonte quando `mês < vigente`, não escrever
lógica nova.

### Tendência — CORRETA

---

## Ordem sugerida de execução

Os três primeiros são pequenos e independentes; Equipes é um bloco só, por
causa da troca de formato do CSV.

1. **Volume Realizado** — carregar `Total (m)`, aplicar as 3 exclusões
   (confirmar antes se são independentes).
2. **Equipes Tendência** — sumir nas semanas encerradas.
3. **Financeiro Realizado** — meses fechados da MATRIZ via `dividirEmSemanas`.
4. **Equipes Realizado** — troca de formato do CSV + módulo de alocação +
   fetcher + build + refresh, juntos.
5. **Volume Demandas** — revisar contra as 5 fontes acima.
