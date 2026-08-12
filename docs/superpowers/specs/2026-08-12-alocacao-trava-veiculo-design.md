# Alocação Equipes: trava de deslocamento por veículo compartilhado

**Data:** 2026-08-12
**Aba:** Alocação Equipes (`planejamento-semanal.html`, sétima aba)
**Pedido do dono do projeto:** *"fazer uma trava para o deslocamento das equipes que
possuem o mesmo veículo, impedindo que 2 equipes (ids) diferentes, mas que pertencem ao
mesmo veículo, possam ser destinados a SUPs diferentes."*

## O problema

Equipes de campo compartilham veículo. Duas equipes no mesmo carro não conseguem estar em
SUPs diferentes na mesma semana — o quadro permitia montar exatamente esse plano
impossível, sem nenhum sinal na tela.

Hoje `aplicarMovimento` (`tools/semanal/render-semanal.js`) valida duas coisas: a equipe
está disponível, e a coluna de destino está no conjunto de colunas dela. Veículo não entra
na conta em lugar nenhum — a coluna `Veículo` da aba EQ é lida (`camposDoPopup`,
`equipes-alocaveis.js`) só para exibir no popup.

## Medição da fonte (aba EQ, roster de 117 equipes, 2026-08-12)

A coluna `Veículo` (índice 5) carrega **quatro tipos de conteúdo diferentes**, e essa
mistura é o que decide o desenho:

| Conteúdo | Ocorrências | Vincula? |
|---|---|---|
| Placa, ex. `STB2D37 (D, 9p)` | maioria | **Sim**, entre equipes com a mesma placa |
| `Carona ID N`, ex. `carona ID 660` | 21 | **Sim**, com a equipe N |
| `Próprio` / `próprio` / `PRÓPRIO` | 16 | **Não** |
| Vazio | 10 | **Não** |
| `afastado`, `D?`, `Suporte` | 3 | **Não** |

**O fecho é transitivo.** `{644, 651, 656, 660}`: três equipes dizem `carona ID 660` e a
660 tem a placa `ELE-8E91 (9 p)` — quatro equipes, um veículo.

**A placa precisa ser normalizada.** Casando texto exato, **três grupos reais somem**:
`UDU8J88 (D, 9p)` vs `UDU8J88 (D, 9 p)`, `UGN4D95 (B, 3p)` vs `UGN4D95 (3p)`,
`URZ1E19 (3 p)` vs `URZ1E19 (B, 3P)`. O que varia é só o descritivo entre parênteses e a
caixa — a placa em si é a mesma.

**O `Carona ID` varia na escrita**: `Carona ID 171`, `carona ID 463`, `Carona  ID 477`
(espaço duplo). E **duas apontam para IDs que não existem no roster** (`Carona ID 10`,
`Carona ID 477`).

**Resultado com as regras deste desenho: 21 grupos, 54 das 117 equipes (46%).**

**Dois grupos já nascem espalhados** pela semeadura do realizado: `{479, 604, 623}` (OS
15819-24 vs 16925-25) e `{353, 513, 629}` (OS 17413-26 vs 17666-26).

## Decisão 1 — o vínculo é uma lista de PERMISSÃO, nunca de exclusão

Só duas formas de texto criam vínculo:

- **Placa:** `/^([A-Za-z]{3})[ -]?([0-9][A-Za-z0-9]{3})/`, chave = os dois grupos
  concatenados em maiúsculas. Cobre a placa antiga (`SUH-6F44`, `EYX 4G65`) e a Mercosul
  (`UFY1G30`), e ignora o descritivo entre parênteses.
- **Carona:** `/^carona\s+id\s*(\d+)/i`, apontando para um ID **presente no roster**.
  Alvo ausente não cria aresta — a equipe fica solteira.

**Qualquer outro texto não agrupa.** O inverso (agrupar tudo, com uma lista de exclusão
para `Próprio`/`afastado`/`Suporte`) falharia em silêncio no dia em que alguém digitasse
uma palavra nova em duas linhas: as duas equipes ficariam presas uma na outra sem nada na
tela explicando por quê. Com permissão, um texto novo simplesmente não trava nada — o
modo de falhar é a ausência da trava, não uma trava fantasma.

Pelo mesmo motivo `Próprio` é tratado como "sem vínculo" por **não casar nenhum dos dois
padrões**, e não por estar numa lista negra: as 16 equipes `Próprio` continuariam
separadas mesmo que a grafia virasse `Veículo próprio`.

## Decisão 2 — o grafo é montado sobre o roster INTEIRO

Inclusive as equipes fora do quadro (Lab, TST, SN). Duas equipes alocáveis podem se ligar
através da carona numa terceira que não é alocável — o veículo é o mesmo de qualquer
forma. O grupo **exposto** ao quadro contém só as alocáveis; a terceira serve de ponte e
some.

## Decisão 3 — o destino do gesto vale para o grupo inteiro, e o pool é um destino

Arrastar (ou clicar-clicar) uma equipe leva **todas as companheiras de veículo** para o
destino do gesto:

- **Soltar numa célula:** o grupo inteiro vai para aquele SUP — tanto quem estava em outro
  SUP quanto **quem estava parado no pool**. Equipes que andam no mesmo carro andam
  juntas; deixar a companheira no pool descreveria uma equipe ativa sem carro.
- **Soltar no pool:** o grupo inteiro volta ao pool. A regra é simétrica de propósito —
  "andam juntas" nos dois sentidos, e tirar só uma do quadro recriaria o plano impossível
  ao contrário.
- **Soltar no vazio continua não fazendo nada**, como já era.

**A única exceção é a equipe indisponível** (`disponivel === false`, nenhum dia ativo na
semana — férias, afastamento, qualquer motivo): ela **nunca é tocada** pelo movimento do
grupo. Não há deslocamento a coordenar com quem não vai a campo, e `aplicarMovimento` já
recusa alocá-la individualmente — a trava não pode ser a porta dos fundos que contorna
essa recusa.

**A coluna de cada companheira é preservada** quando ela serve a mesma coluna no destino;
senão, cai na primeira coluna que ela serve, na ordem canônica de `COLUNAS_ALOCACAO`.
Uma equipe de ST em SUP-A vai para ST em SUP-B — a trava é sobre SUP, e mudar a tipologia
de quem vai de carona seria uma decisão que ninguém pediu. (Isto reusa a intenção de
`colunaSemeada`, mas sem `temDemanda`: `montarAbaAlocacao` não passa esse parâmetro para
`equipesDoQuadro` hoje, e a trava não vai introduzir essa dependência.)

**Se o movimento da equipe arrastada for recusado** (indisponível, ou coluna fora do
conjunto dela), **nada se move** — nem ela nem o grupo. A recusa é avaliada antes de
qualquer efeito.

## Decisão 4 — a trava age só em movimento; a semeadura não é reescrita

`semearDoRealizado` ("Repor o realizado") e `limparAlocacao` **não passam pela trava**. A
semeadura é o retrato de onde as equipes estiveram de fato, lido da própria aba EQ — se
duas companheiras de veículo trabalharam em OS de SUPs diferentes, é isso que aconteceu, e
não cabe à aba de planejamento reescrever o realizado para caber na regra. `limparAlocacao`
esvazia tudo, então não produz grupo espalhado por construção.

Consequência aceita: os dois grupos medidos acima **nascem em conflito**, e é a Decisão 5
que dá o sinal disso. Depois da trava no ar, conflito novo só pode entrar por semeadura ou
por alocação salva na Sheet antes desta versão.

## Decisão 5 — conflito herdado é marcado, não corrigido

Um helper puro (`conflitosDeVeiculo`) percorre a alocação e devolve, por equipe, os
companheiros que estão em SUP diferente. Os cartões envolvidos ganham estado de alerta, e
o popup nomeia quem está onde ("mesmo veículo da equipe 623, em SUP-X").

**O sinal vive no cartão, não na aba Alertas.** O cartão é onde o remanejamento acontece;
a aba Alertas mede desvio de tendência contra premissa, que é outra pergunta.

## Decisão 6 — o grupo é visível no cartão, e destacado na seleção

- **Selo permanente no cartão**, ao lado do `⇄` de polivalente: identifica o veículo e o
  tamanho do grupo, para a trava nunca surpreender antes do gesto.
- **Ao selecionar ou começar a arrastar uma equipe**, os cartões das companheiras acendem —
  mesmo mecanismo (e mesmo ponto de saída) do destaque de células compatíveis, que já
  existe: aceso em `destacarCelulasCompativeis`, apagado **só** em
  `limparDestaquesAlocacao`. Apagar em outro lugar deixaria o destaque preso em um dos
  quatro caminhos de saída do arrasto — armadilha já documentada no `CLAUDE.md`.
- O selo de grupo aparece em **todas** as instâncias do cartão de uma equipe polivalente
  (ela se repete em cada grupo de tipologia do pool), e o destaque acende todas elas.

Rótulo do grupo: a placa normalizada, quando alguma equipe do grupo tem uma. O único grupo
medido sem nenhuma placa é `{322, 635, 666}` (a 322 tem veículo vazio e as outras duas
dizem `Carona ID 322`) — nesse caso o rótulo é o ID de referência da carona.

O desenho visual segue a skill `design-kanban-alocacao-equipes` (paleta, estados e
espaçamento da aba) e passa pela revisão do Open Design, como todo HTML deste projeto.

## Decisão 7 — persistência: uma gravação por equipe movida

Nenhuma mudança em `alocacao-sheet.js`. O movimento de grupo grava um
`clienteAlocacao().gravar({chaveSemana, equipeId, sup, coluna})` por equipe movida —
exatamente o laço que `semearDoRealizado` já usa. A gravação continua vindo **depois** do
redesenho e não é esperada: a tela nunca trava por causa da rede.

`ESTADO_ALOCACAO.geracaoAlocacao` é incrementado **uma vez** pelo movimento inteiro, não
uma vez por equipe — ele é o token que invalida um `carregarAlocacaoDaSemana` em voo, e o
grupo é um gesto só.

## Arquitetura

**Módulo novo: `tools/semanal/grupos-veiculo.js`** — puro, sem DOM, no formato que
`transformaModulo` (`tools/comum/browser-bundle.js`) reconhece (`var`/`function`, requires
no topo), porque roda no build **e** no navegador.

```
normalizarVeiculo(texto) -> { tipo: 'placa'|'carona'|'nenhum', chave }
agruparPorVeiculo(linhasDoRoster) -> { grupoPorId, membrosDoGrupo, rotuloDoGrupo }
conflitosDeVeiculo(alocacao, equipes) -> { [equipeId]: [{ id, sup }] }
destinoDoGrupo(equipes, alocacao, equipeId, sup, coluna) -> [{ id, sup, coluna }]
```

`destinoDoGrupo` é a peça que carrega a Decisão 3 inteira e é onde os testes de
comportamento batem: ela recebe o gesto e devolve a lista de movimentos a aplicar,
**sem tocar em estado nem no DOM**. `aplicarMovimento` vira o laço que aplica essa lista.

**`equipes-alocaveis.js`** passa a anexar `veiculoGrupo` (chave) e `companheiros` (IDs
alocáveis do grupo, sem a própria) a cada equipe devolvida por `equipesDoQuadro`. O
agrupamento é calculado sobre a grade completa da aba EQ, antes do filtro que separa
"fora do quadro".

**`render-aba-alocacao.js`** desenha o selo, o estado de conflito e a classe de destaque.
**`render-semanal.js`** (`aplicarMovimento`, `destacarCelulasCompativeis`) aplica a lista e
acende as companheiras.

## Testes

Suíte nova `test/semanal-grupos-veiculo.test.js`, sobre os casos **reais medidos**:

- Cadeia de quatro: `{644, 651, 656, 660}` sai como um grupo só.
- Placa com pontuação divergente: `UDU8J88 (D, 9p)` e `UDU8J88 (D, 9 p)` agrupam.
- `Próprio`/`próprio`/`PRÓPRIO` em equipes diferentes **não** agrupam — nem entre si, nem
  com vazio.
- `afastado`, `D?`, `Suporte` não agrupam.
- Carona órfã (`Carona ID 10`) fica solteira.
- Ponte por equipe fora do quadro: duas alocáveis que caroneiam numa Lab saem no mesmo
  grupo, e a Lab não aparece em `companheiros`.
- Ciclo (`A: carona B`, `B: carona A`) não entra em laço infinito.

Comportamento (`destinoDoGrupo`): companheira em outro SUP vem junto; companheira no pool
vem junto; companheira **indisponível não vem**; soltar no pool devolve o grupo; coluna
preservada quando servida, primeira coluna servida quando não; equipe arrastada recusada
não move ninguém.

Integração, com o DOM falso (`test/helpers/dom-falso-semanal.js`, usando
`registrarCelulasAlocacao()` — sem ele o teste passa vazio): o arrasto de uma equipe de
grupo grava N movimentos, e o destaque das companheiras morre em
`limparDestaquesAlocacao`.

Continua valendo o invariante existente: `INVARIANTE: com a alocação vazia, a soma da
tendência da grade bate com a Tabela Semanal` — a trava não toca em número nenhum.

## Fora de escopo

- **Não** mexe na semeadura nem no realizado (Decisão 4).
- **Não** cria alerta na aba Alertas (Decisão 5).
- **Não** valida capacidade, equipamento, tenda ou habilitação — a trava é sobre veículo.
- **Não** corrige a coluna `Veículo` na planilha de origem. Se `Carona ID 10` e
  `Carona ID 477` forem erro de digitação, quem corrige é o dono da aba EQ; o dashboard só
  deixa de vincular.
