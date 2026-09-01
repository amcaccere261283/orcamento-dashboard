# Desfazer o congelamento + botão no topo do Consolidado — design

Data: 2026-09-01. Página: Planejamento Semanal, aba Consolidado.
Complementa `2026-08-31-congelar-semana-botao-design.md` (já implementado e em
produção desde 2026-09-01), que tornou o congelamento **deliberadamente irreversível
pelo produto** — "para refazer, apague as linhas na planilha à mão" era a Decisão 3
daquele design. Este documento reabre essa decisão por pedido explícito do dono do
projeto: um botão que desfaz pelo produto, sem precisar abrir a planilha.

## O pedido

1. Um botão "Desfazer congelamento" complementando o "Congelar próxima semana" já no ar.
2. Mover os dois botões para o topo da aba Consolidado, ao lado do seletor de semana —
   hoje o botão de congelar fica colado depois das 3 tabelas, exigindo rolar a página.

## Decisões do dono do projeto (2026-09-01)

1. **Desfazer APAGA a(s) linha(s) da planilha**, não marca como desfeita mantendo
   histórico. Depois de desfeito, a semana fica exatamente como se nunca tivesse sido
   congelada — inclusive podendo ser recongelada pelo fluxo normal.
2. **Mesmo token do congelamento** — nenhum controle de acesso adicional. Quem tem a
   senha do dashboard pode congelar E desfazer, mesma simetria que já existe hoje.
3. **Vale para qualquer semana em tela**, não só a semana-alvo do botão de congelar
   (a próxima segunda). Trocando o seletor para uma semana congelada no passado, a
   opção de desfazer aparece pra ela também — cobre o caso de erro percebido dias
   depois, não só no instante do clique.
4. **Confirmação simples** (`confirm()` do navegador) antes de executar — é uma
   exclusão permanente de dado real.
5. **O botão vai para o topo, ao lado do seletor de semana** — não acima de tudo sem
   relação com o seletor; especificamente ao lado dele, dentro do mesmo bloco de
   controles que `renderControles` já desenha.

## Onde cada peça vive hoje (levantamento antes do desenho)

- `renderControles` (`tools/semanal/render-aba-consolidado.js:502-514`) já monta o
  `<div class="controles-consolidado">` no TOPO da aba, com o `<select
  id="consolidado-semana">` e o botão "Gerar relatório Excel" — é chamada de dentro de
  `renderAbaConsolidado` (linha 566), antes das tabelas.
- O botão de congelar hoje é montado inteiramente em `render-semanal.js`
  (`SCRIPT_CLIENTE_SEMANAL`), concatenado DEPOIS do HTML de `renderAbaConsolidado(...)`
  (linhas ~1808-1828) — um `<div class="controles-consolidado">` SEPARADO, colado no
  fim.
- O client script já localiza tudo por `id` (`document.getElementById('btn-congelar-semana')`
  etc.) — não depende de onde no DOM o elemento está. Mover a posição não exige mudar
  nenhuma lógica de habilitar/desabilitar/clique, só onde o HTML estático nasce.

## Arquitetura

### 1. Mover o botão de congelar para dentro de `renderControles`

`render-aba-consolidado.js`: `renderControles` passa a emitir, dentro do MESMO
`<div class="controles-consolidado">` que já tem o seletor de semana e "Gerar
relatório Excel", o markup estático dos dois botões novos:

```html
<button id="btn-congelar-semana" class="btn-secundario" disabled>Verificando…</button>
<span id="status-congelamento" class="nota-inline"></span>
<span id="status-congelamento-leitura" class="nota-inline"></span>
<button id="btn-desfazer-congelamento" class="btn-secundario" style="display:none">Desfazer congelamento desta semana</button>
<span id="status-desfazer" class="nota-inline"></span>
```

`render-semanal.js` PARA de concatenar seu próprio `<div class="controles-consolidado">`
depois das tabelas — os elementos já existem no HTML vindo de `renderAbaConsolidado`,
e o client script continua achando-os pelo mesmo `id` de sempre. Nenhuma mudança na
lógica de `atualizarBotaoCongelar`/`congelarProximaSemana`/`carregarCongeladoDaSemana`
além de onde o markup nasce.

`btn-desfazer-congelamento` nasce com `display:none` (estático, sem JS) — o client
script decide quando mostrar (ver abaixo), então o caso "sem JavaScript" nunca mostra
um botão de exclusão permanente sem função.

### 2. Mostrar/esconder "Desfazer" com base no que já é buscado

A busca que já roda hoje para decidir o rótulo "(congelada)"/"(recalculada)" da semana
em tela (`carregarCongeladoDaSemana`, dispara ao montar a aba e a cada troca de
semana) passa a também controlar a visibilidade do botão de desfazer — **nenhuma
chamada nova ao Apps Script**, é a mesma resposta lida de outro ângulo:

- Se a semana EM TELA tem congelado (`ESTADO_CONGELAMENTO.congelado` não-nulo para a
  `chave` atual): `btn-desfazer-congelamento` fica visível e habilitado, com o texto
  "Desfazer congelamento da semana de DD/MM a DD/MM".
- Se não tem: fica escondido (`display:none`), não só desabilitado — não faz sentido
  oferecer desfazer o que não existe.

### 3. O clique em "Desfazer"

1. `confirm('Desfazer o congelamento da semana de DD/MM a DD/MM? Esta ação não pode
   ser desfeita.')` — se cancelado, nada acontece.
2. Calcula as chaves de fragmento da semana em tela com a MESMA função que o
   congelamento já usa (`fragmentosDaSemanaAlvo`, que espera a segunda-feira da
   semana-alvo). **Armadilha:** a semana EM TELA pode ela mesma já ser um fragmento
   truncado (se cruza virada de mês, `semanaEscolhida.inicio` não é necessariamente
   uma segunda) — passar esse `.inicio` direto pra `fragmentosDaSemanaAlvo` sem
   corrigir acharia só o próprio fragmento, nunca o outro lado da mesma semana
   congelada. É preciso achar a segunda-feira da semana ISO que contém
   `semanaEscolhida.inicio` primeiro: `proximaSegunda` não serve (acha a PRÓXIMA,
   estritamente depois); precisa de uma função nova, `segundaDaSemana(diaEpoch)`,
   que anda pra TRÁS até a segunda (incluindo o próprio dia, se já for segunda) —
   `diaEpoch - ((diaDaSemana + 6) % 7)`, com `diaDaSemana` no padrão `getUTCDay()`
   (0=domingo..6=sábado). Só depois chama `fragmentosDaSemanaAlvo(formatarDiaIso(segundaDaSemana(semanaEscolhida.inicio)))`
   pra pegar as chaves dos dois lados. Reaproveita o restante do cálculo, não inventa
   um novo.
3. POST para o mesmo `URL_CONGELAMENTO`, corpo `{ acao: 'desfazer', token, chaves:
   [...] }` (plural — mesma forma de payload por fragmento que `congelar` já manda,
   só que sem o resto dos dados, já que é exclusão).
4. Em sucesso: `ESTADO_CONGELAMENTO.congelado = null` para a chave em tela, redesenha a
   aba Consolidado (rótulo volta a "(recalculada)", totais recalculam, botão de
   desfazer some, botão de congelar reavalia se a semana em tela por acaso for também a
   semana-alvo do congelamento).
5. Em erro (token recusado, rede fora): mostra em `#status-desfazer`, sem mexer no
   estado local — a semana continua congelada até prova em contrário.

### 4. `apps-script-congelamento.gs`: `doPost` ganha `acao: 'desfazer'`

```javascript
if (corpo.acao === 'desfazer') {
  var trava = LockService.getScriptLock();
  trava.waitLock(30000);
  try {
    var chavesApagar = {};
    (corpo.chaves || []).forEach(function (c) { chavesApagar[String(c)] = true; });
    var aba = abaCongelamento();
    var dados = aba.getDataRange().getValues();
    var linhasParaApagar = [];
    for (var i = 1; i < dados.length; i++) {
      if (chavesApagar[normalizarDia(dados[i][COL_SEMANA_INICIO - 1])]) linhasParaApagar.push(i + 1);
    }
    // De trás pra frente -- apagar de cima pra baixo desloca os índices das
    // linhas seguintes, e o próximo apagamento erraria a linha.
    linhasParaApagar.sort(function (a, b) { return b - a; })
      .forEach(function (linha) { aba.deleteRow(linha); });
    return resposta({ ok: true, apagadas: linhasParaApagar.length });
  } finally {
    trava.releaseLock();
  }
}
```

Mesma trava (`LockService`) que a escrita — evita corrida entre um `congelar` e um
`desfazer` simultâneos na mesma semana. Apagar 0 linhas (semana já não tinha
congelamento) é sucesso silencioso, `{ ok: true, apagadas: 0 }` — idempotente, não é
erro.

### 5. `congelamento-sheet.js`: `desfazer(chaves)`

Espelha `congelar`, mesmo formato de erro (`{ ok: false, motivo }` em vez de lançar):

```javascript
desfazer: async function (chaves) {
  if (!url || !buscar) return { ok: false, motivo: 'rede' };
  try {
    var resposta = await buscar(url, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: token, acao: 'desfazer', chaves: chaves }),
    });
    var corpo = await resposta.json();
    if (corpo && corpo.ok) return { ok: true, apagadas: corpo.apagadas };
    return { ok: false, motivo: (corpo && corpo.erro) || 'rede' };
  } catch (err) {
    return { ok: false, motivo: 'rede' };
  }
}
```

## Testes

- **`apps-script-congelamento.gs`**: `desfazer` apaga só as linhas das chaves pedidas
  (não mexe em linhas de outras semanas); apaga os DOIS fragmentos de uma semana que
  cruza mês; apaga de trás pra frente (índices não desalinham); token errado recusa
  sem apagar nada; 0 linhas encontradas devolve sucesso com `apagadas: 0`, não erro.
- **`congelamento-sheet.js`**: `desfazer` degrada pra `{ok:false, motivo}` em qualquer
  falha, nunca lança.
- **`render-aba-consolidado.js`**: `renderControles` emite os dois botões novos dentro
  do MESMO `.controles-consolidado` do seletor de semana; `btn-desfazer-congelamento`
  nasce com `display:none`.
- **`render-semanal.js` (wireup)**: com uma semana congelada em tela, o botão de
  desfazer aparece habilitado; confirmação cancelada não manda requisição; sucesso
  redesenha com "(recalculada)" e o botão some; o cálculo dos fragmentos a apagar bate
  com `fragmentosDaSemanaAlvo` da semana EM TELA, não da semana-alvo do congelamento
  (teste com uma semana passada selecionada, diferente da próxima segunda).
- **`segundaDaSemana`**: teste dedicado nos sete dias da semana (segunda devolve o
  próprio dia; os outros seis andam pra trás até a segunda anterior) — mesmo padrão de
  teste que `proximaSegunda` já tem, provando que os dois nunca se confundem (um anda
  pra frente, o outro pra trás).
- Regressão: os testes existentes que verificam a posição do bloco de controles do
  Consolidado (se algum comparar HTML exato) precisam ser atualizados para o novo
  local — não é um teste novo, é ajuste de fixture.

## Fora de escopo

- Qualquer forma de desfazer PARCIAL (um fragmento sim, outro não) — a exclusão é
  sempre da semana inteira, todos os fragmentos dela.
- Log de quem desfez o quê — a planilha simplesmente perde a linha; não há auditoria
  de exclusão neste pedido.
- Mudar o botão de congelar em si (alvo, formato do payload, recusa de reclique) —
  esse mecanismo continua exatamente como está.
