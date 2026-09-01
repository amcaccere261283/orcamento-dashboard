# Botão "Congelar próxima semana" no Consolidado — design

Data: 2026-08-31. Página: Planejamento Semanal, aba Consolidado.
Substitui o agendamento de sexta 22h desenhado em
`2026-08-31-consolidado-congelamento-sexta-e-resumo-design.md` (Decisão 1 e Task 7
daquele plano), que nunca chegou a ser implementado.

## O pedido

"Clicar em um botão e congelar a Tendência da semana para acompanhamento."

O congelamento em si — o que é congelado, como é calculado, como o Consolidado lê —
continua valendo do design anterior. O que muda é o **gatilho** (botão em vez de cron) e,
por consequência, **onde o dado é persistido**.

## Por que o agendamento saiu

O design anterior previa `tools/semanal/congelar-tendencia-semanal.js` rodando via Task
Scheduler nas 3 máquinas, sexta 22h, gravando `docs/tendencia-congelada-semanal.json` e
publicando por git. Isso exigia configurar 3 máquinas e dependia de o job não falhar.

A revisão final da branch (2026-08-31) achou três defeitos nesse caminho, todos latentes
porque nenhum congelamento tinha rodado ainda. O botão, com as decisões abaixo, **dissolve
os três** em vez de consertá-los um a um.

## Decisões do dono do projeto (2026-08-31)

1. **O botão congela sempre a PRÓXIMA semana** (a que começa na segunda seguinte) —
   mesmo alvo que o cron teria. A expectativa é clicar na sexta.

   **`chaveSemanaSeguinteDeSexta` NÃO serve para isso e não pode ser reusada.** Ela foi
   escrita para um cron de sexta com tolerância de atraso: mapeia segunda–quinta de volta
   para a sexta ANTERIOR e devolve a segunda seguinte a ela — ou seja, a segunda da semana
   CORRENTE. Clicando numa terça, ela congelaria a semana em curso, não a próxima,
   contrariando esta decisão em silêncio. Com o cron aposentado (Decisão 4) ela perde o
   único chamador e **sai junto**.

   A regra do botão é outra e é mais simples: **a próxima segunda estritamente depois de
   hoje**. Sexta 28/08 → 31/08. Terça 01/09 → 07/09. Segunda 31/08 → 07/09 (clicar na
   segunda congela a semana seguinte, não a que acabou de começar). Função nova,
   `proximaSegunda(hojeEpoch)`, com teste cobrindo os sete dias da semana.
2. **Proteção igual à do dashboard**: o Apps Script só devolve dados mediante token
   derivado da senha. O congelado inclui projeção financeira por contrato.
3. **Reclique é RECUSADO**, não sobrescrito: "esta semana já foi congelada em X, por Y".
   Refazer exige apagar a linha na planilha à mão.
4. **Uma origem só**: o CLI e o JSON no git são APOSENTADOS. A Sheet é a única origem.
5. **O botão aceita clique em qualquer dia** (não só sexta a domingo). Risco aceito
   explicitamente: quem clicar primeiro define a âncora, e o reclique recusado torna isso
   permanente até alguém editar a planilha.
6. **As linhas de TOTAL entram no escopo** (ver "O total lê o snapshot" abaixo).

## Arquitetura

**Botão "Congelar próxima semana"** na aba Consolidado, perto do seletor de semana.

Ao clicar, o navegador:

1. calcula o snapshot da semana-alvo com `calcularSnapshotSemanaAlvo`
   (`tools/semanal/congelar-tendencia-semanal.js`) — módulo puro, já implementado e
   testado, que roda igual em Node e no navegador;
2. pergunta ao Apps Script se a semana-alvo já tem QUALQUER linha;
3. se tiver, **recusa** e mostra data/autor do congelamento existente;
4. se não tiver, envia as linhas e confirma na tela.

Ao abrir a página (e ao trocar de semana), o Consolidado busca o congelado da semana
exibida na Sheet, de forma assíncrona — mesmo padrão de `carregarAlocacaoDaSemana`.
Deixa de existir `window.__CONGELADO_SEMANAL__`.

### Formato na planilha

Uma linha por `(ano, semanaInicio, chaveMatriz)`:

| Ano | SemanaInicio | Chave | Volume | Financeiro | Equipe | ProdutividadeMedia | Autor | CongeladoEm |
|---|---|---|---|---|---|---|---|---|

`Chave` é `chaveMatriz(sup, tipologia)` = `sup + '||' + tipologia` — **dois** pipes, nunca
montada à mão. `SemanaInicio` é `YYYY-MM-DD`. São ~340 linhas por semana congelada.

**Gravar como TEXTO PURO e normalizar na leitura.** O Sheets coage `'2026-08-10'` para
`Date` na gravação, e `String(Date)` nunca casa com a string ISO na releitura — o script
gravaria e descartaria a própria linha, em silêncio. Foi exatamente o que mordeu o
`apps-script-alocacao.gs` em 2026-08-11. Os dois cintos de lá (`setNumberFormat('@')`
antes de escrever + `normalizarDia` na leitura) são obrigatórios aqui também.

## Autenticação

No desbloqueio, `tentarDesbloquear` (`tools/comum/render-shell.js`) passa a reter
`window.__TOKEN_SHEET__` = SHA-256 da senha com um sal fixo — **nunca a senha crua**, que
hoje é variável local e some depois do unlock. O Apps Script compara com o mesmo valor,
guardado nas **Script Properties** (colado uma vez na implantação; nunca no repositório,
pela mesma regra que vale para `ORCAMENTO_SENHA`).

O sal é uma constante no código do cliente, portanto **público** — ele não é segredo e não
precisa ser. Sua função é impedir que o token sirva em outro lugar, não esconder a senha:
quem já tem a senha deriva o token de qualquer jeito, e quem não tem esbarra no PBKDF2 do
blob antes de chegar aqui. A comparação vale porque o valor esperado mora no servidor.

**Ao rotacionar `ORCAMENTO_SENHA`, o token nas Script Properties tem de ser atualizado
junto** — senão o botão e a leitura do congelado param, com "token recusado", enquanto o
resto da página continua funcionando. Fica registrado no `CLAUDE.md` junto da senha.

O que isso protege: impede que quem ache a URL do Apps Script no código-fonte da página
leia as projeções. O que não protege: quem já tem a senha do dashboard — essa pessoa já vê
tudo. É o mesmo nível de proteção do resto da página, não mais.

`render-shell.js` é compartilhado com o dashboard de orçamento, então o token fica
disponível nas duas páginas. A Alocação continua sem exigir token (não é escopo aqui);
se um dia quiser fechar aquela porta, o mecanismo já estará pronto.

## Os três bloqueios da revisão final

| Bloqueio | Como morre |
|---|---|
| Snapshot publicado fora do blob cifrado (`<script>` limpo + JSON em `docs/`, servido sem senha) | Deixa de existir: o dado nunca entra no HTML. Vive na Sheet, atrás do token |
| Reclique sobrescreve a foto de sexta em silêncio | A escrita recusa quando a semana-alvo já tem qualquer linha (Decisão 3) |
| Semana que cruza virada de mês nunca acha o snapshot | O gravador emite **uma linha por fragmento** que o leitor procura (abaixo) |

### O fragmento de semana

`semanasDoMes` corta semanas na virada do mês: a semana 31/08–06/09 vira o toco
`[31/08, 31/08]` em agosto e `[01/09, 06/09]` em setembro. O gravador sempre chaveava numa
SEGUNDA (`2026-08-31`); o leitor chaveia em `semanaEscolhida.inicio`, que para o fragmento
de setembro é `2026-09-01` — uma terça. Nenhuma sexta emitiria essa chave, e essa semana
mostraria "recalculada" com os dois blocos em branco. Acontece em ~1 mês a cada 4.

**Correção:** ao congelar, resolver a semana-alvo através de `semanasDoMes` e gravar uma
entrada por fragmento resultante, com o MESMO conjunto de valores. O leitor não muda.

## O total lê o snapshot

`serieDaSemana` só consulta `ctx.tendenciaExterna` quando `indices.length === 1`, e
`renderLinhaResumoGenerica` idem. O Consolidado desenha TOTAL GERAL, total por tipologia e
TOTAL por SUP — todas linhas agregadas. Efeito hoje: nos dois blocos novos essas linhas
ficariam **permanentemente em branco**, incluindo a primeira linha da tabela; e na tabela
principal os totais viriam de âncora diferente das linhas acima deles, não fechando na
soma.

O design anterior já pedia isso ("os totais por tipologia/SUP/geral são somados a partir
daqui"); não foi implementado.

**Correção:** quando `indices.length > 1`, somar
`porRegistro[chave][dimensao].tendencia` sobre os registros de `indices`, pulando chaves
ausentes e devolvendo `null` só se nenhuma existir. **`produtividadeMedia` não se soma** —
agrega como `Σvolume ÷ Σequipe` do mesmo snapshot.

## Estados na tela

O botão diz qual semana vai congelar, sempre: **"Congelar semana de 31/08 a 06/09"** — sem
isso, "próxima semana" é ambíguo para quem clica numa terça (ver Decisão 1).

Quatro estados: **pronto**; **congelando** (desabilitado); **congelada** — vira o rótulo
"Semana de 31/08 congelada em 29/08 às 22h14, por Américo"; e **erro**, com o motivo e
volta ao estado pronto.

O estado inicial depende de uma consulta à Sheet pela semana-alvo, que é assíncrona: até
ela responder, o botão nasce **desabilitado com "Verificando…"**. Nascer habilitado
deixaria clicar antes de saber se a semana já foi congelada.

**O rótulo do cabeçalho para de mentir.** Hoje "(congelada)"/"(recalculada)" está colado na
coluna "Previsto até a data" — que nunca congela — e acende só por existir snapshot para a
semana, mesmo que nenhuma linha visível o tenha usado. Passa para a coluna onde o valor
congelado é de fato consumido, e só acende quando foi usado.

## Falhas

**Leitura** (Sheet fora do ar, token recusado, semana sem registro): a tabela principal cai
no recálculo de hoje com rótulo "recalculada" — comportamento atual — e os dois blocos
ficam "sem dado". Nunca quebra a página.

**Escrita** interrompida no meio: como a checagem de existência vem antes e as linhas são
independentes, a semana pode ficar parcialmente gravada. Por isso a verificação de "já
congelada" olha se existe **qualquer** linha da semana — e a recusa nesse caso é honesta:
é preciso limpar na planilha para refazer. Escolha deliberada: um congelamento parcial que
se deixa completar em silêncio seria pior que um que exige intervenção visível.

## O que é aposentado

- `main()`, o heartbeat (`heartbeat-congelamento-semanal.csv`), a coordenação por git,
  `gravarSnapshotNoArquivo` e `descartarEscritaNaoCommitada` em
  `tools/semanal/congelar-tendencia-semanal.js`. **As funções puras de cálculo ficam**
  (`calcularSnapshotSemanaAlvo`, `localizarSemanaAlvo`) — são o que o botão usa.
  `chaveSemanaSeguinteDeSexta` sai também: era a regra do cron, e o botão usa
  `proximaSegunda` (ver Decisão 1).
- `lerCongeladoSemanal` e o global `window.__CONGELADO_SEMANAL__`
  (`tools/semanal/build-dashboard.js`, `render-semanal.js`).
- `tools/semanal/congelar-semanal.ps1` (existe como untracked, nunca foi commitado).
- Os 2 testes de embed que passam por `build()` e escrevem/apagam
  `docs/tendencia-congelada-semanal.json` de verdade — some o alvo, some o teste.

## Testes

- **Apps Script em sandbox com Sheets dublê**, no molde de
  `test/semanal-apps-script-alocacao.test.js`. O dublê **tem de imitar a coerção de data**
  — sem isso o teste passa com o bug. Casos: gravação e releitura casando; recusa de
  reclique; token errado rejeitado; token correto aceito.
- **`proximaSegunda` nos sete dias da semana**: sexta 28/08 → 31/08; sábado e domingo →
  31/08; segunda 31/08 → 07/09; terça a quinta → 07/09. É a prova de que clicar fora de
  sexta não congela a semana errada (a armadilha de `chaveSemanaSeguinteDeSexta`).
- **Fragmento de mês**: congelar a semana 31/08–06/09 grava sob `2026-08-31` **e**
  `2026-09-01`, e o Consolidado acha o congelado nas duas.
- **Totais**: TOTAL GERAL e TOTAL por SUP somam os registros do snapshot;
  `produtividadeMedia` agrega como Σvolume ÷ Σequipe, `null` quando Σequipe é 0.
- **Rótulo do cabeçalho**: acende só quando alguma linha visível usou o congelado.
- **Degradação**: Sheet indisponível deixa a tabela principal em "recalculada" e os blocos
  em "sem dado", sem lançar.

## Fora de escopo

- Exigir token na Alocação Equipes (o mecanismo fica pronto, a mudança não é feita).
- Alerta/e-mail quando ninguém congelou a semana.
- Migrar congelamentos antigos: não existe nenhum, o recurso nunca rodou.
- Os itens menores que a revisão final parqueou e que não bloqueiam este trabalho: código
  morto (`colunasExtras`/`produtividadeEsperada`/`ticketMedioPrevisto`), `pct()`/`num()`
  duplicados, custo de render dos blocos novos (3 chamadas de `serieDaSemana` por linha),
  virada de ano em `localizarSemanaAlvo`, descontinuidade do desvio no último dia da
  semana.
