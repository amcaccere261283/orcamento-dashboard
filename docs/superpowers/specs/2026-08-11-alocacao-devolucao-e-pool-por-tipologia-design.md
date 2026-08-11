# Aba Alocação Equipes: devolução, pool por tipologia, filtro, busca e status da célula

Data: 2026-08-11
Escopo: `tools/semanal/render-aba-alocacao.js` (o pool), `tools/semanal/compute-alocacao.js`
(a grade e o filtro), `tools/semanal/render-semanal.js`
(os gestos), e os testes correspondentes. Nada fora da aba Alocação Equipes.

Continuação de `2026-08-10-semanal-alocacao-equipes-design.md`, que desenhou a aba. Este
documento cobre cinco pedidos do dono do projeto feitos em 2026-08-11, depois de o modo
Sheet entrar no ar:

1. um arrasto de **devolução** — tirar uma equipe de um contrato e mandá-la de volta ao pool;
2. **organizar o pool por tipologia**, que hoje é uma lista plana;
3. **o filtro de SUP não filtra a grade** — bug relatado depois dos dois primeiros, e que
   por tocar nos mesmos arquivos entra aqui em vez de num documento à parte (Decisão 7);
4. um **campo para achar equipe** por id ou líder (Decisão 8);
5. avaliar os rótulos da célula — de onde saiu **um bug de status invertido** e um número
   sem rótulo (Decisão 9).

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
pool. Isso sai de graça do redesenho — `montarAbaAlocacao` refaz a seção inteira a cada
movimento, e a equipe deixa de ser candidata a qualquer grupo de uma vez só. (O critério
de "está alocada" muda na Decisão 7: passa a ser a alocação crua, não
`porEquipeMap[e.id].sup`. Vale para as cópias exatamente como valia para o cartão único.)

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

## Decisão 8 — campo de busca de equipe, próprio da aba

Pedido de 2026-08-11: um filtro por **id da equipe**, mostrando id + líder, com um campo
para digitar. (O pedido original incluía "sondador"; **retirado pelo dono do projeto no
mesmo dia**. Fica registrado que ele não era trivial: `sondador` não existe no registro da
equipe — a aba EQ tem `Equipe` (col. 1) e `Líderes` (col. 4), e "Sondador" é a coluna Y do
Avanço Sond, outra fonte. O popup do cartão, aliás, documenta a regra de que nome de
pessoa do efetivo não entra nesta página, porque vive na aba PESSOAS, que o projeto não
lê.)

**As colunas 1 e 4 são a MESMA pessoa em duas formas**, e isso decide contra o que a busca
casa. Cabeçalhos e dados reais, lidos da Sheet em 2026-08-11:

| col 0 `ID` | col 1 `Equipe` | col 4 `Líderes` |
|---|---|---|
| `4` | `José I. Amaral` | `Amaral` |
| `59` | `Paulo S. Lima` | `Paulo S.` |
| `79` | `Leonardo D. Marques` | `Leonardo` |

A col. 1 traz o nome completo (o código a chama de `nome`, apesar de o cabeçalho dizer
"Equipe"); a col. 4, o apelido — e é o apelido que o cartão mostra, porque
`equipesDoQuadro` monta `lider` da col. 4 com `|| bruta.nome` de reserva.

**O cartão já mostra os dois campos pedidos** — `cartao-medalhao` traz o id e `cartao-lider`
o líder. Nada a acrescentar ali; o que falta é o campo de digitação.

**Um `<input type="text">` próprio da aba**, junto dos controles de semana, e **não** na
barra de filtros compartilhada. A barra compartilhada opera sobre `registros`
(`indicesFiltrados`), e equipe não é registro — enfiar um filtro de equipe ali significaria
um filtro que não faz nada em cinco das sete abas. Mesmo precedente do Balanço e do
Consolidado, que têm controles próprios.

**Casa contra id, líder E nome completo** — os TRÊS —, por substring, insensível a
maiúsculas e a acento, via `normalizarBusca` (`render-shell.js`), a mesma função que a
busca da aba Alertas já usa.

Incluir o nome completo não é zelo: pela tabela acima, casar só contra o que o cartão
MOSTRA deixaria `josé` sem achar a equipe 4 e `marques` sem achar a 79, porque o cartão só
tem o apelido. Quem digita procura pela pessoa, não pela forma abreviada que a planilha
escolheu. Digitar `4` acha a equipe 4; `amaral` e `josé` acham a mesma.

Efeito colateral aceito: um resultado pode não conter visivelmente o texto digitado (busque
`josé`, apareça um cartão escrito `Amaral`). Por isso, quando o casamento vier SÓ do nome
completo, o cartão exibe o nome completo abaixo do apelido — senão o resultado parece
aleatório.

**Escopo: o campo poda o POOL.** É onde está o problema real — são ~127 cartões depois do
agrupamento da Decisão 4, e achar uma equipe entre eles a olho é o que motivou o pedido. Os
grupos vazios pela poda somem, pela regra que a Decisão 4 já estabelece.

**Equipe que casa a busca mas está ALOCADA não some calada.** Ela não está no pool (está
numa célula), então a poda sozinha faria o campo responder "não achei" para uma equipe que
existe — o modo de falha que este projeto evita. O pool passa a emitir, abaixo dos grupos,
uma linha por equipe casada e alocada: `EQ-37 (Silva) — alocada em SUP-7133-24 · ST`. Texto,
não cartão: arrastar se faz da célula, e um segundo cartão arrastável reintroduziria o risco
de dupla alocação da Decisão 7.

**O campo não mexe na grade.** Ele responde "onde está esta equipe?", não "mostre só esta
equipe" — quem recorta a grade é o filtro de SUP (Decisão 7). Os dois eixos são
independentes e podem valer ao mesmo tempo.

**O texto digitado não é estado persistido** — vive só no DOM, como a busca da aba Alertas.
Trocar de semana ou de mês não o preserva.

## Decisão 9 — o status da célula está INVERTIDO (bug), e a Tendência não tem rótulo

Dois achados de 2026-08-11, ao avaliar o título de cada SUP/tipologia a pedido do dono do
projeto.

### 9a — o número sem rótulo é a Tendência

A célula imprime quatro coisas, e só a primeira não diz o que é:

```js
'<div class="celula-tendencia">' + formatarNumero(c.tendencia) + '</div>'   // <- sem rótulo
'... · saldo ' + formatarNumero(c.saldo) + '</div>'
renderBarraCobertura(cobertura)
'<span class="carteira">carteira ' + formatarNumero(c.carteira, 0) + '</span>'
```

É a **Tendência congelada** daquele SUP × tipologia na semana (congelada em
`ancoraDaSemana` — ver o spec de 2026-08-10). Ganha rótulo, no mesmo padrão de `saldo` e
`carteira`.

### 9b — folga e sobrecarregada estão trocadas na célula

`classificarOcupacao` (`compute-alocacao.js`) tem limiares escritos para **ocupação**:

```js
FAIXA_OCUPACAO = { folga: 0.85, sobrecarga: 1.05 };   // ocupação = carga ÷ capacidade
```

Correto para uma equipe: pouca carga = folga, muita carga = sobrecarga. Mas `renderCelula`
alimenta a MESMA função com `cobertura = capacidadeAlocada / tendencia` — a razão
**recíproca**. Resultado medido:

| tendência | capacidade | cobertura | rótulo exibido | saldo exibido |
|---|---|---|---|---|
| 100 | 50 | 0,50 | **Com folga** | **−50** |
| 100 | 85 | 0,85 | Equilibrada | −15 |
| 100 | 100 | 1,00 | Equilibrada | 0 |
| 100 | 150 | 1,50 | **Sobrecarregada** | **+50** |

A célula contradiz o número que ela mesma imprime ao lado. O par invertido é
**folga ↔ sobrecarregada**; `equilibrada` (0,85–1,05) é quase simétrica em torno de 1 e por
isso parece certa nos dois sentidos — que é o motivo de o bug ter sobrevivido.

**Causa raiz:** o comentário em `render-aba-alocacao.js`, logo acima do cálculo, afirma que
"Cobertura é a mesma noção de ocupação (carga ÷ capacidade), só que no nível da célula
(capacidade alocada ÷ tendência)". As duas fórmulas escritas nessa mesma frase são
recíprocas. A equivalência falsa é o que autorizou reaproveitar a função.

**Alcance verificado: um único ponto de chamada.** O resumo por SUP usa `leituraDoSup`
(outro classificador) e mostra `cobertura` como percentual cru, sem rótulo de faixa; o
resumo por equipe usa a ocupação verdadeira (`carga ÷ capacidade`), vinda de
`resumirAlocacao`. Nenhum dos dois está afetado, e nenhum dos dois muda.

**Correção:** a célula passa a classificar pela ocupação dela — `tendencia ÷
capacidadeAlocada` —, reaproveitando `classificarOcupacao` com os MESMOS limiares, agora
com o argumento na orientação certa. Nada de faixas novas.

**Célula com tendência e sem nenhuma equipe** é divisão por zero, e é o caso mais
descoberto que existe — não o mais tranquilo. Hoje ela cai em `livre` e exibe "Livre", que
lê como "tudo certo aqui" quando significa "tem demanda e ninguém designado". Passa a ser
um estado próprio, **"Sem equipe"**, em tom de atenção.

**Armadilha, e ela é do tipo que este repositório já foi mordido antes:**
`ROTULO_SITUACAO`/`CLASSE_SITUACAO` são compartilhados entre a célula e o resumo por
equipe, e `livre` tem significado legítimo do lado da equipe — "está no pool, sem
alocação", que deve continuar dizendo "Livre". **Não renomear `livre`.** "Sem equipe" entra
como CHAVE NOVA, usada só pela célula.

Célula sem tendência nenhuma (existe por carteira ou por equipe alocada) continua num
estado neutro, sem faixa — não há demanda para cobrir, e chamá-la de folga ou de sobrecarga
seria inventar.

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

Busca de equipe (Decisão 8):
- digitar parte do id acha a equipe; parte do líder também; **e parte do nome completo
  também** — com dado real: `josé` tem que achar a equipe 4, cujo cartão diz `Amaral`;
- casando só pelo nome completo, o cartão passa a exibi-lo (senão o resultado parece
  aleatório);
- insensível a maiúsculas e a acento (é o que `normalizarBusca` promete) — `jose` sem
  acento acha `José`;
- equipe que casa mas está alocada aparece na linha de texto, com SUP e coluna, e **não**
  como cartão arrastável;
- campo vazio devolve o pool inteiro, idêntico ao de antes da busca;
- busca sem nenhum resultado não deixa a área muda — diz que não achou;
- a busca poda o pool mas **não** mexe nas linhas da grade;
- busca e filtro de SUP valem ao mesmo tempo sem se atropelar.

Status da célula (Decisão 9), e este grupo tem que falhar contra o código de hoje:
- capacidade METADE da tendência mostra "Sobrecarregada", não "Com folga" (hoje mostra
  "Com folga · saldo −50", que é a contradição relatada);
- capacidade UMA VEZ E MEIA a tendência mostra "Com folga", não "Sobrecarregada";
- capacidade igual à tendência continua "Equilibrada" — a faixa do meio não muda;
- **o rótulo nunca contradiz o sinal do saldo**: saldo negativo jamais sai com "Com
  folga"/"Livre", saldo positivo jamais com "Sobrecarregada". Vale como propriedade,
  varrendo uma faixa de valores, e não como caso a caso — é a forma mais direta de
  travar a classe inteira do bug;
- tendência sem nenhuma equipe mostra "Sem equipe", em tom de atenção;
- `livre` continua significando "no pool" no resumo por equipe, com o rótulo "Livre"
  intacto — a chave compartilhada não pode ter sido renomeada;
- a Tendência aparece rotulada na célula;
- o resumo por SUP e o resumo por equipe não mudam nada (são o controle: a correção é de
  um ponto só).

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
