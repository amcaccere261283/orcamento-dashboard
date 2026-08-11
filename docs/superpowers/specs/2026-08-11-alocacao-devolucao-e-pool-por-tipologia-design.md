# Aba Alocação Equipes: devolução ao pool e pool agrupado por tipologia

Data: 2026-08-11
Escopo: `tools/semanal/render-aba-alocacao.js` (o pool), `tools/semanal/compute-alocacao.js`
(a grade e o filtro), `tools/semanal/render-semanal.js`
(os gestos), e os testes correspondentes. Nada fora da aba Alocação Equipes.

Continuação de `2026-08-10-semanal-alocacao-equipes-design.md`, que desenhou a aba. Este
documento cobre dois pedidos do dono do projeto feitos em 2026-08-11, depois de o modo
Sheet entrar no ar:

1. um arrasto de **devolução** — tirar uma equipe de um contrato e mandá-la de volta ao pool;
2. **organizar o pool por tipologia**, que hoje é uma lista plana.

## O estado de hoje, medido

O roster da aba EQ tem **117 equipes** (busca ao vivo em 2026-08-11):

| Serviço | Equipes | Colunas que serve |
|---|---|---|
| `SM` | 45 | `SM / SM.F / SR` |
| `SP` | 43 | `SP` |
| `CPTu \| VT \| SH` | 7 | `Especiais` |
| `ST \| PI \| BL` | **6** | **`ST`, `PI`, `BL`** |
| `ST` | 6 | `ST` |
| `PI` | 6 | `PI` |
| `SP/SM` | **1** | **`SP`, `SM / SM.F / SR`** |
| `TST` | 2 | — (fora do quadro) |
| `Lab` | 1 | — (fora do quadro) |

Ou seja: 114 equipes no quadro, das quais **107 servem uma coluna só, 1 serve duas e 6
servem três**.

O pool (`renderPool`, `render-aba-alocacao.js`) é hoje um `flex-wrap` plano dentro de
`.pool-cartoes`, com as equipes sem destino na semana, mais o `<details>` "fora do quadro"
para as 3 de `TST`/`Lab`.

## Decisão 1 — a devolução não precisa de camada de dados nova

`aplicarMovimento(equipeId, sup, coluna)` (`render-semanal.js`) **já** trata a remoção:

```js
if (!sup) delete ESTADO_ALOCACAO.alocacao[equipeId];
```

e propaga `sup: null` para `clienteAlocacao().gravar(...)`, que no lado do cliente faz
`delete mapa[movimento.equipeId]` (`alocacao-sheet.js`) e, no lado da planilha, grava a
linha com `sup` vazio — que `linhasDaSemana` (`apps-script-alocacao.gs`) ignora na
releitura. Esse caminho inteiro foi exercitado ao vivo em 2026-08-11 e está coberto por
teste (`gravar com sup vazio tira a equipe do quadro`).

**O que falta é só o gesto.** Nenhuma mudança em `aplicarMovimento`, no cliente ou no
Apps Script.

## Decisão 2 — um resolvedor de ALVO, no lugar do resolvedor de célula

Hoje os dois gestos fazem a mesma pergunta e ignoram tudo que não for célula:

- arrasto: `pointerup` → `resolverCelulaAlocacao(e)` → `if (celula) aplicarMovimento(...)`
- clique-clique: o 2º `click` → `e.target.closest('.celula-alocacao')` → mesma coisa

`resolverCelulaAlocacao` passa a ser `resolverAlvoAlocacao(e)`, devolvendo uma de três
coisas:

| Retorno | Quando | Ação |
|---|---|---|
| `{ tipo: 'celula', el }` | há `.celula-alocacao` sob o ponto | `aplicarMovimento(id, sup, coluna)` |
| `{ tipo: 'pool' }` | há `.pool-alocacao` sob o ponto | `aplicarMovimento(id, '', '')` |
| `null` | nem um nem outro | **nada** |

Mantém a prioridade por `document.elementFromPoint`, e não por `e.target`, pelo motivo já
documentado na função (o `setPointerCapture` retarget-a `e.target` para o cartão que
capturou, nunca para o que está fisicamente sob o dedo). A célula ganha prioridade sobre o
pool se, por alguma razão de layout, as duas casarem.

**Soltar no vazio continua não fazendo nada — e isso é deliberado.** Alocar é trabalho do
usuário; um solte impreciso não pode desfazê-lo. Só um solte explícito sobre o pool
devolve. É a mesma escolha conservadora que a aba já faz em `pointercancel`.

## Decisão 3 — o destaque do pool tem que morrer nos QUATRO caminhos de saída

Enquanto se arrasta uma equipe **já alocada**, o pool acende como alvo válido (classe nova
`.pool-alvo`, irmã de `.celula-alvo`). Arrastando uma equipe que já está no pool, não
acende: devolver ao lugar onde ela já está é no-op, e acender sugeriria uma ação que não
existe.

O perigo está no encerramento, não no acendimento. `encerrarArrastoAlocacao` é descrita no
código como o "único ponto de saída", e o comentário lá é explícito: os quatro caminhos
(soltura aceita, recusada, cancelada por `pointercancel`, ou solta fora de qualquer célula)
"deixam o quadro exatamente igual". Hoje ela chama `limparDestaqueCelulas()`, que só varre
`.celula-alocacao`. **Se o destaque do pool for limpo em outro lugar, ele fica aceso para
sempre em pelo menos um dos quatro caminhos.**

Portanto: `limparDestaqueCelulas` passa a limpar também `.pool-alvo`. Um só lugar, o que
já existe. O nome fica impreciso (limpa mais que células) — renomear para
`limparDestaquesAlocacao` junto, já que é chamada de 5 pontos e todos querem a limpeza
completa.

A seleção por clique usa o MESMO par acender/limpar, então ganha o comportamento de graça.

## Decisão 4 — o pool agrupa na ordem canônica, e a polivalente aparece em CADA grupo dela

`renderPool` passa a emitir um bloco por entrada de `COLUNAS_ALOCACAO`, **nessa ordem**
(`SP`, `SM / SM.F / SR`, `ST`, `PI`, `BL`, `Especiais`) — a mesma ordem das colunas da
grade, para o olho não ter que traduzir entre as duas metades da tela. Cada bloco tem
título e contagem.

Uma equipe aparece em **todos** os grupos de `equipe.colunas`. As alternativas foram
descartadas por causa de um fato medido: **não existe nenhuma equipe com serviço `BL`
sozinho.** As 6 equipes `ST | PI | BL` são as únicas candidatas a BL que existem. Num pool
com grupo "Polivalentes" separado, ou com a equipe só na primeira coluna canônica dela, o
grupo BL nasceria permanentemente vazio e quem procurasse alguém para BL não encontraria
ninguém — exatamente a pergunta que o agrupamento deveria responder.

O custo é a repetição: 7 equipes polivalentes viram 20 cartões, então o pool desenha ~127
cartões para 114 equipes. Aceito explicitamente pelo dono do projeto.

Para a repetição não ser lida como equipes diferentes:

- selo `⇄` no cartão polivalente;
- uma linha no popup que já existe, nomeando os outros grupos em que ela está.

**Grupos vazios não são desenhados.** Um bloco "PI (0)" é ruído; a grade já poda coluna
sem nada pelo mesmo motivo.

O `<details>` "fora do quadro" continua exatamente como está, fora do agrupamento — as 3
equipes de `TST`/`Lab` não têm coluna por definição.

## Decisão 5 — a duplicação é segura para o arrasto, e isto foi verificado

Toda a máquina de arrasto resolve o cartão por `e.target.closest('[data-equipe]...')`, a
partir do evento — nunca por `document.querySelector('[data-equipe="X"]')`. Verificado:
não existe nenhuma consulta desse tipo no repositório. Logo, dois cartões com o mesmo
`data-equipe` não se confundem; o gesto age sempre sobre o que foi realmente tocado.

`criarFantasmaArrasto(equipeId)` também não consulta o DOM — cria um `div` novo com
`textContent = equipeId`. (Uma versão anterior deste desenho listava isso como risco; a
leitura do código mostrou que não é.)

O que a duplicação exige: quando a equipe é alocada, **todas** as cópias dela somem do
pool. Isso já sai de graça — `renderPool` filtra por `porEquipeMap[e.id].sup` antes de
agrupar, e `montarAbaAlocacao` redesenha a seção inteira a cada movimento.

**Armadilha para quem escrever os testes novos:** hoje nenhum teste procura cartão por
`querySelector('[data-equipe="X"]')` (verificado no repositório inteiro), mas os testes de
devolução vão precisar simular um gesto a partir de um cartão específico. Com as cópias,
`querySelector` devolve a PRIMEIRA — que pode ser a de outro grupo, ou a do pool quando se
queria a da célula. Buscar sempre dentro do escopo certo (a célula, ou o bloco do grupo),
nunca no documento inteiro.

## Decisão 6 — `somenteLeitura` bloqueia a devolução como bloqueia a alocação

Nos modos `somenteLeitura` (hoje `'mes-diferente'`, quando a semana exibida não é do mês
que o espelho da EQ cobre) os cartões saem com `data-arrastavel="não"`, e os dois gestos já
filtram por `[data-arrastavel="sim"]` no `closest`. A devolução deve herdar isso sem código
novo — mas **com teste**, porque é uma proteção que se perde calada se alguém mudar o
seletor.

## Decisão 7 — o filtro de SUP não filtra a grade (bug relatado em 2026-08-11)

O dono do projeto filtrou pelo SUP `7133` e a grade devolveu também `6830`, `7285` e
`7593`.

**Causa raiz**, em `montarGradeAlocacao` (`compute-alocacao.js`, l. 139-141): as células
candidatas saem da união de duas fontes, e só uma respeita o filtro.

```js
Object.keys(porCelula).forEach(...);        // indicesPorCelula(registros, indices) -- FILTRADO
Object.keys(equipesNaCelula).forEach(...);  // montado de `alocacao` -- NÃO FILTRADO
```

Qualquer SUP com equipe alocada vira linha. E como a semana **nasce semeada do realizado**,
as equipes já entram alocadas nos SUPs onde trabalharam — daí os três SUPs extras.

Reproduzido isoladamente, com controle: filtrando só `SUP-A` e com uma equipe alocada em
`SUP-B`, a grade devolve `["SUP-A", "SUP-B"]`; com `alocacao: {}`, devolve `["SUP-A"]`.
Não há teste cobrindo filtro nesta aba.

**Decisão do dono do projeto:** a linha é podada E a equipe também não aparece no pool
enquanto o filtro estiver ligado. O custo foi dito antes da escolha — a equipe fica
invisível enquanto o filtro estiver ligado — e aceito.

**A armadilha que essa poda cria, e que a implementação PRECISA evitar:** hoje `renderPool`
inclui a equipe quando `!porEquipeMap[id] || !porEquipeMap[id].sup`, e `porEquipeMap` vem
de `resumirAlocacao(grade)`. Podando a linha, `celulaPorEquipe[id]` nunca é preenchido, o
resumo devolve `sup: null`, e a equipe **volta a aparecer no pool como livre** — podendo
ser alocada uma segunda vez, em dois SUPs ao mesmo tempo. Foi medido: é o motivo provável
de a união existir como está.

Portanto: **o pool decide pela alocação CRUA (`ESTADO_ALOCACAO.alocacao`), não pelo resumo
da grade.** Uma equipe com entrada em `alocacao` nunca entra no pool, tenha a linha dela
sobrevivido ao filtro ou não. Esta é a única mudança que impede a regressão, e é o ponto
mais fácil de errar deste documento.

Os totais da faixa saem de `resumirAlocacao(grade)` e passam a excluir as linhas podadas —
consistente com a grade exibida, e é o que se espera de um filtro.

## Testes

Novos, em `test/semanal-render-semanal-wireup.test.js` (gestos) e
`test/semanal-render-aba-alocacao.test.js` (pool):

Devolução:
- arrastar uma equipe alocada até o pool a devolve, e a gravação sai com `sup: null`;
- o mesmo pelo gesto de clique-clique (clicar no cartão alocado, clicar no pool);
- soltar no vazio (nem célula nem pool) **não** devolve — a alocação sobrevive;
- em `somenteLeitura`, nenhum dos dois gestos devolve;
- depois de qualquer um dos quatro caminhos de saída do arrasto, não sobra `.pool-alvo`
  aceso (é o modo de falha da Decisão 3);
- arrastar uma equipe que já está no pool não acende `.pool-alvo`.

Pool agrupado:
- os blocos saem na ordem de `COLUNAS_ALOCACAO`;
- uma equipe `ST | PI | BL` aparece nos três grupos, com o selo;
- o grupo `BL` contém as 6 — é o caso que motivou a Decisão 4;
- grupo sem equipe não é desenhado;
- a soma dos cartões do pool é maior que o número de equipes livres quando há polivalente
  (a repetição é intencional, e o teste a fixa em vez de deixá-la parecer bug);
- "fora do quadro" continua fora do agrupamento, com as 3 de sempre.

Filtro (Decisão 7), o grupo que hoje não existe:
- filtrando por um SUP, um SUP com equipe alocada que o filtro exclui **não** vira linha —
  é o bug relatado, e o teste tem que falhar contra o código de hoje;
- controle no mesmo teste: sem alocação nenhuma, o filtro já funcionava e continua;
- a equipe alocada num SUP podado **não** aparece no pool (a armadilha da Decisão 7);
- os totais da faixa excluem as linhas podadas;
- limpar o filtro traz a linha e a equipe de volta, na mesma célula — a poda é de
  exibição, nunca de estado.

Regressão:
- o `INVARIANTE: com a alocação vazia, a soma da tendência da grade bate com a Tabela
  Semanal` continua verde. Nada aqui toca em número, mas é a prova de que a aba não
  divergiu da conta oficial, e vale rodar.
- alocar, filtrar, desfiltrar e devolver continua funcionando em sequência — a poda não
  pode corromper `ESTADO_ALOCACAO.alocacao`.

## Fora de escopo

- Reordenar ou filtrar o pool por outra coisa que não tipologia (disponibilidade, líder).
- Devolver várias equipes de uma vez.
- Qualquer mudança na grade, nas contas, ou na persistência.
- Logística (líderes, veículos, equipes que andam juntas) — adiada pelo dono do projeto
  para a aba Veículos do dashboard Matriz de Equipes, outro repositório.
