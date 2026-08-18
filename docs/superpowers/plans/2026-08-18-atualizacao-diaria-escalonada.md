# Atualização diária escalonada (Patrick → Kairo → Américo) — Plano de Implementação

> **Para quem for executar:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans pra executar tarefa por tarefa. Os passos usam `- [ ]` pra acompanhamento.

**Objetivo:** substituir a tarefa diária das 3 máquinas (`atualizar-diario.ps1`, hoje
rodando às 8h ao mesmo tempo nas 3, causando commits redundantes e conflitos de
rebase) por um mecanismo escalonado — Patrick 8h → Kairo 8h15 → Américo 8h30, com
2ª rodada de segurança 1h depois — em que cada máquina checa via git se alguém já
publicou com sucesso hoje antes de rodar, e o dashboard passa a mostrar um aviso
"Atualizado às HH:mm por `<máquina>`" no cabeçalho.

**Arquitetura:** um módulo novo e puro (`coordenacao-volume.js`) concentra toda a
lógica testável (parsing do heartbeat, decisão de pular ou rodar, formatação do
aviso). Um script de orquestração novo (`atualizar-diario-escalonado.js`) lê esse
heartbeat direto do git (sem abrir Chrome), decide, e — se decidir rodar — reaproveita
as buscas e a publicação que `atualizar-arquivos.js` já tem hoje (refatorado pra
exportar as peças reaproveitáveis). O aviso na tela é só uma concatenação a mais no
subtítulo que `render-semanal.js` já monta.

**Tech Stack:** Node.js (`node:test`, `node:assert/strict`, `node:child_process`,
`node:fs`), PowerShell 5.1 (Task Scheduler), sem dependências novas.

**Spec:** `docs/superpowers/specs/2026-08-18-atualizacao-diaria-escalonada-design.md`

## Global Constraints

- Fuso sempre America/Sao_Paulo, via `tools/comum/datas.js` (`hojeNoFusoProjeto`,
  `agoraNoFusoProjeto`) — nunca `Intl`/hora local da máquina.
- `docs/heartbeat-atualizacao-diaria.csv` (o heartbeat diário existente, `chrome_ok`)
  **não muda** — o alerta por e-mail depende do formato dele.
- `tools/semanal/atualizar-arquivos.js` continua funcionando como comando manual,
  comportamento idêntico ao de hoje, só reorganizado por dentro.
- `ORCAMENTO_SENHA` nunca em arquivo do repositório, só variável de ambiente.
- Scripts `.ps1` deste projeto: **sem acento em texto nenhum** (PowerShell 5.1 lê
  `.ps1` sem BOM como codepage do sistema, não UTF-8 — acento vira mojibake).
- `node --test test/*.js` tem que fechar 100% verde antes de qualquer commit final.

---

### Task 1: Módulo de coordenação (`coordenacao-volume.js`)

**Files:**
- Create: `tools/semanal/coordenacao-volume.js`
- Test: `test/semanal-coordenacao-volume.test.js`

**Interfaces:**
- Consumes: `hojeNoFusoProjeto`, `agoraNoFusoProjeto` de `../comum/datas.js`.
- Produces (usados pelas Tasks 2, 3 e 5):
  - `CABECALHO_HEARTBEAT_VOLUME` (string) = `'data_hora,maquina,resultado,detalhe'`
  - `NOMES_AMIGAVEIS` (objeto `{ hostname: nomeAmigavel }`)
  - `nomeAmigavel(hostname: string): string`
  - `parseHeartbeatVolume(texto: string): Array<{dataHora: Date, maquina: string, resultado: 'ok'|'falhou', detalhe: string}>`
  - `formatarLinhaHeartbeat({dataHora: Date, maquina: string, resultado: string, detalhe: string}): string`
  - `jaAtualizadoHoje(linhas: Array<...>, agora?: Date): boolean`
  - `decidirResultado(resultadosBuscas: Array<{nome: string, ok: boolean, erro?: string}>): {resultado: 'ok'|'falhou', detalhe: string}`
  - `formatarAvisoAtualizacao(linhas: Array<...>): string` (vazio se não há linha `ok`)
  - `lerAvisoAtualizacaoVolume(caminhoArquivo: string): string` (lê o arquivo, vazio se não existir)

- [ ] **Step 1: Escrever os testes que travam o comportamento (todos de uma vez, arquivo novo)**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  CABECALHO_HEARTBEAT_VOLUME, NOMES_AMIGAVEIS, nomeAmigavel,
  parseHeartbeatVolume, formatarLinhaHeartbeat, jaAtualizadoHoje,
  decidirResultado, formatarAvisoAtualizacao, lerAvisoAtualizacaoVolume,
} = require('../tools/semanal/coordenacao-volume.js');

test('nomeAmigavel traduz hostnames conhecidos e cai no hostname cru pros desconhecidos', () => {
  assert.equal(nomeAmigavel('COMPUTADOR053'), 'Patrick');
  assert.equal(nomeAmigavel('COMP-074'), 'Américo');
  assert.equal(nomeAmigavel('MAQUINA-QUALQUER'), 'MAQUINA-QUALQUER');
});

test('formatarLinhaHeartbeat produz uma linha CSV com ISO/maquina/resultado/detalhe', () => {
  const linha = formatarLinhaHeartbeat({
    dataHora: new Date('2026-08-18T11:03:12.000Z'), maquina: 'COMP-074', resultado: 'ok', detalhe: '',
  });
  assert.equal(linha, '2026-08-18T11:03:12.000Z,COMP-074,ok,');
});

test('formatarLinhaHeartbeat troca vírgula do detalhe por ponto-e-vírgula (não pode quebrar a coluna)', () => {
  const linha = formatarLinhaHeartbeat({
    dataHora: new Date('2026-08-18T11:00:00.000Z'), maquina: 'X', resultado: 'falhou', detalhe: 'Falha A, erro; Falha B, erro',
  });
  assert.equal(linha, '2026-08-18T11:00:00.000Z,X,falhou,Falha A; erro; Falha B; erro');
});

test('parseHeartbeatVolume ignora o cabeçalho e lê as linhas de dado', () => {
  const texto = `${CABECALHO_HEARTBEAT_VOLUME}\n2026-08-18T11:00:00.000Z,COMP-074,ok,\n2026-08-18T11:15:00.000Z,KAIRO-PC,falhou,Avanços (furos)\n`;
  const linhas = parseHeartbeatVolume(texto);
  assert.equal(linhas.length, 2);
  assert.equal(linhas[0].maquina, 'COMP-074');
  assert.equal(linhas[0].resultado, 'ok');
  assert.ok(linhas[0].dataHora instanceof Date);
  assert.equal(linhas[1].detalhe, 'Avanços (furos)');
});

test('parseHeartbeatVolume devolve array vazio pra texto vazio ou ausente', () => {
  assert.deepEqual(parseHeartbeatVolume(''), []);
  assert.deepEqual(parseHeartbeatVolume(undefined), []);
});

test('jaAtualizadoHoje: true quando há linha OK de hoje (fuso America/Sao_Paulo)', () => {
  const agora = new Date('2026-08-18T11:30:00.000Z'); // 08:30 em SP
  const linhas = [{ dataHora: new Date('2026-08-18T11:03:00.000Z'), maquina: 'COMP-074', resultado: 'ok', detalhe: '' }];
  assert.equal(jaAtualizadoHoje(linhas, agora), true);
});

test('jaAtualizadoHoje: false quando a única linha OK é de ontem', () => {
  const agora = new Date('2026-08-18T11:30:00.000Z');
  const linhas = [{ dataHora: new Date('2026-08-17T11:03:00.000Z'), maquina: 'COMP-074', resultado: 'ok', detalhe: '' }];
  assert.equal(jaAtualizadoHoje(linhas, agora), false);
});

test('jaAtualizadoHoje: false quando a linha de hoje é "falhou" (próxima máquina deve tentar)', () => {
  const agora = new Date('2026-08-18T11:30:00.000Z');
  const linhas = [{ dataHora: new Date('2026-08-18T11:03:00.000Z'), maquina: 'COMP-074', resultado: 'falhou', detalhe: 'x' }];
  assert.equal(jaAtualizadoHoje(linhas, agora), false);
});

test('jaAtualizadoHoje: false com lista vazia', () => {
  assert.equal(jaAtualizadoHoje([], new Date('2026-08-18T11:30:00.000Z')), false);
});

test('jaAtualizadoHoje: fronteira de fuso -- 02:30 UTC de 18/08 ainda é 17/08 em SP (23:30)', () => {
  // 2026-08-18T02:30:00Z = 2026-08-17T23:30:00 em UTC-3
  const agora = new Date('2026-08-18T02:30:00.000Z');
  const linhas = [{ dataHora: new Date('2026-08-18T02:00:00.000Z'), maquina: 'X', resultado: 'ok', detalhe: '' }];
  assert.equal(jaAtualizadoHoje(linhas, agora), true, 'linha e "agora" caem no mesmo dia em SP (17/08), então conta como hoje');
});

test('decidirResultado: ok quando pelo menos 1 busca teve sucesso', () => {
  const r = decidirResultado([
    { nome: 'Avanços (furos)', ok: true },
    { nome: 'Lab Realizado (ensaios)', ok: false, erro: 'timeout' },
  ]);
  assert.equal(r.resultado, 'ok');
  assert.equal(r.detalhe, 'Lab Realizado (ensaios) (timeout)');
});

test('decidirResultado: falhou quando todas as buscas falharam', () => {
  const r = decidirResultado([
    { nome: 'Avanços (furos)', ok: false, erro: 'CDP não respondeu' },
    { nome: 'Lab Realizado (ensaios)', ok: false, erro: 'CDP não respondeu' },
  ]);
  assert.equal(r.resultado, 'falhou');
  assert.equal(r.detalhe, 'Avanços (furos) (CDP não respondeu); Lab Realizado (ensaios) (CDP não respondeu)');
});

test('formatarAvisoAtualizacao: vazio quando não há nenhuma linha ok', () => {
  assert.equal(formatarAvisoAtualizacao([]), '');
  assert.equal(formatarAvisoAtualizacao([{ dataHora: new Date(), maquina: 'X', resultado: 'falhou', detalhe: 'y' }]), '');
});

test('formatarAvisoAtualizacao: usa a linha OK mais recente e o nome amigável, hora em fuso SP', () => {
  const linhas = [
    { dataHora: new Date('2026-08-18T11:00:00.000Z'), maquina: 'COMPUTADOR053', resultado: 'ok', detalhe: '' }, // 08:00 SP
    { dataHora: new Date('2026-08-18T11:16:40.000Z'), maquina: 'COMP-074', resultado: 'ok', detalhe: '' }, // 08:16 SP -- mais recente
  ];
  assert.equal(formatarAvisoAtualizacao(linhas), 'Atualizado às 08:16 por Américo');
});

test('lerAvisoAtualizacaoVolume: string vazia quando o arquivo não existe', () => {
  assert.equal(lerAvisoAtualizacaoVolume(path.join(os.tmpdir(), 'nao-existe-nunca-heartbeat.csv')), '');
});

test('lerAvisoAtualizacaoVolume: lê o arquivo real e devolve o aviso da última linha ok', () => {
  const caminho = path.join(os.tmpdir(), `heartbeat-volume-teste-${Date.now()}.csv`);
  fs.writeFileSync(caminho, `${CABECALHO_HEARTBEAT_VOLUME}\n2026-08-18T11:00:00.000Z,COMPUTADOR053,ok,\n`);
  assert.equal(lerAvisoAtualizacaoVolume(caminho), 'Atualizado às 08:00 por Patrick');
  fs.unlinkSync(caminho);
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham (módulo ainda não existe)**

Run: `node --test test/semanal-coordenacao-volume.test.js`
Expected: FAIL — `Cannot find module '../tools/semanal/coordenacao-volume.js'`

- [ ] **Step 3: Implementar o módulo**

```js
'use strict';
const fs = require('node:fs');
const { hojeNoFusoProjeto, agoraNoFusoProjeto } = require('../comum/datas.js');

const CABECALHO_HEARTBEAT_VOLUME = 'data_hora,maquina,resultado,detalhe';

// Hostnames confirmados em 2026-08-18 (ver o spec) -- Kairo ainda não tem
// hostname conhecido, cai no fallback (retorna o próprio hostname cru).
const NOMES_AMIGAVEIS = {
  COMPUTADOR053: 'Patrick',
  'COMP-074': 'Américo',
};

function nomeAmigavel(hostname) {
  return NOMES_AMIGAVEIS[hostname] || hostname;
}

function formatarLinhaHeartbeat({ dataHora, maquina, resultado, detalhe }) {
  // CSV sem suporte a aspas neste projeto (mesmo padrão dos outros CSVs
  // gerados aqui) -- troca vírgula por ponto-e-vírgula no detalhe pra nunca
  // quebrar a coluna.
  const detalheSeguro = (detalhe || '').replace(/,/g, ';');
  return `${dataHora.toISOString()},${maquina},${resultado},${detalheSeguro}`;
}

function parseHeartbeatVolume(texto) {
  if (!texto) return [];
  const linhas = texto.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!linhas.length) return [];
  // A 1ª linha é sempre o cabeçalho -- este arquivo é sempre escrito por
  // formatarLinhaHeartbeat/este próprio módulo, nunca à mão.
  return linhas.slice(1).map((linha) => {
    const [dataHoraIso, maquina, resultado, detalhe = ''] = linha.split(',');
    return { dataHora: new Date(dataHoraIso), maquina, resultado, detalhe };
  });
}

function mesmoDiaSp(a, b) {
  return a.ano === b.ano && a.mes === b.mes && a.dia === b.dia;
}

function jaAtualizadoHoje(linhas, agora = new Date()) {
  const hoje = hojeNoFusoProjeto(agora);
  return linhas.some((l) => l.resultado === 'ok' && mesmoDiaSp(hojeNoFusoProjeto(l.dataHora), hoje));
}

function decidirResultado(resultadosBuscas) {
  const falhas = resultadosBuscas.filter((r) => !r.ok);
  const resultado = falhas.length < resultadosBuscas.length ? 'ok' : 'falhou';
  const detalhe = falhas.map((f) => `${f.nome} (${f.erro})`).join('; ');
  return { resultado, detalhe };
}

function formatarAvisoAtualizacao(linhas) {
  const linhasOk = linhas.filter((l) => l.resultado === 'ok').sort((a, b) => b.dataHora - a.dataHora);
  if (!linhasOk.length) return '';
  const ultima = linhasOk[0];
  const local = agoraNoFusoProjeto(ultima.dataHora);
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  return `Atualizado às ${hh}:${mm} por ${nomeAmigavel(ultima.maquina)}`;
}

function lerAvisoAtualizacaoVolume(caminhoArquivo) {
  if (!fs.existsSync(caminhoArquivo)) return '';
  return formatarAvisoAtualizacao(parseHeartbeatVolume(fs.readFileSync(caminhoArquivo, 'utf8')));
}

module.exports = {
  CABECALHO_HEARTBEAT_VOLUME, NOMES_AMIGAVEIS, nomeAmigavel,
  parseHeartbeatVolume, formatarLinhaHeartbeat, jaAtualizadoHoje,
  decidirResultado, formatarAvisoAtualizacao, lerAvisoAtualizacaoVolume,
};
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test test/semanal-coordenacao-volume.test.js`
Expected: PASS (16 testes)

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/coordenacao-volume.js test/semanal-coordenacao-volume.test.js
git commit -m "Adiciona módulo de coordenação da atualização escalonada (heartbeat/decisão/aviso)"
```

---

### Task 2: Aviso na tela — `render-semanal.js`

**Files:**
- Modify: `tools/semanal/render-semanal.js:2981` (assinatura de `renderSemanal`) e `:3050-3055` (chamada de `markupCabecalho`)
- Test: `test/semanal-build-dashboard.test.js` (arquivo existente)

**Interfaces:**
- Consumes: nenhuma nova (recebe o texto já pronto — `avisoAtualizacao?: string` — não importa de onde vem; Task 3 é quem passa).
- Produces: `renderSemanal({ ..., avisoAtualizacao })` — parâmetro novo opcional.

- [ ] **Step 1: Escrever o teste que falha, no arquivo de teste existente**

Adicionar ao final de `test/semanal-build-dashboard.test.js`:

```js
test('subtítulo do cabeçalho mostra o aviso de atualização quando informado', () => {
  const html = renderSemanal({
    registros: REGISTROS, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS,
    senha: 'fake', geradoEm: new Date(0), avisoAtualizacao: 'Atualizado às 08:15 por Kairo',
  });
  assert.match(html, /Jan\/1970 · Atualizado às 08:15 por Kairo/);
});

test('subtítulo do cabeçalho mostra só mês/ano quando não há aviso', () => {
  const html = renderSemanal({
    registros: REGISTROS, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS,
    senha: 'fake', geradoEm: new Date(0),
  });
  assert.match(html, /<div class="generated">Jan\/1970<\/div>/);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/semanal-build-dashboard.test.js`
Expected: FAIL no 1º teste novo (o aviso não aparece — parâmetro ainda ignorado)

- [ ] **Step 3: Implementar**

Em `tools/semanal/render-semanal.js:2981`, mudar a assinatura:

```js
function renderSemanal({ registros, baseline, demandas, periodos, senha, geradoEm, logoDataUri, iconDataUri, avisoAtualizacao }) {
```

E em `:3050-3055`, trocar o `subtitulo` fixo por um que concatena o aviso quando existir:

```js
${markupCabecalho({
    titulo: 'Planejamento Semanal',
    subtitulo: escapeHtml(avisoAtualizacao ? `${formatarMesAno(geradoEm)} · ${avisoAtualizacao}` : formatarMesAno(geradoEm)),
    logo: logoImg,
    recuo: '  ',
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/semanal-build-dashboard.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/semanal/render-semanal.js test/semanal-build-dashboard.test.js
git commit -m "Cabeçalho da página semanal mostra o aviso de última atualização, quando informado"
```

---

### Task 3: `build-dashboard.js` lê o heartbeat e alimenta o aviso

**Files:**
- Modify: `tools/semanal/build-dashboard.js:515-518` (chamada de `renderSemanal`)
- Test: nenhum teste novo — `lerAvisoAtualizacaoVolume` já está testada na Task 1;
  `build()` de ponta a ponta não é testável neste repo (precisa da MATRIZ real em
  `G:\`, ver o comentário em `test/semanal-build-dashboard-fontes-novas.test.js`).

**Interfaces:**
- Consumes: `lerAvisoAtualizacaoVolume` de `./coordenacao-volume.js` (Task 1).

- [ ] **Step 1: Editar `build-dashboard.js`**

No topo do arquivo, junto dos outros `require` de `tools/semanal/*`, acrescentar:

```js
const { lerAvisoAtualizacaoVolume } = require('./coordenacao-volume.js');
```

Logo antes da chamada de `renderSemanal` (linha ~515), acrescentar:

```js
const CAMINHO_HEARTBEAT_VOLUME = path.join(__dirname, '..', '..', 'dist', 'heartbeat-atualizacao-volume.csv');
const avisoAtualizacao = lerAvisoAtualizacaoVolume(CAMINHO_HEARTBEAT_VOLUME);
```

E adicionar `avisoAtualizacao` ao objeto passado pra `renderSemanal`:

```js
const html = renderSemanal({
  registros, baseline, demandas, periodos, senha, geradoEm: today,
  logoDataUri: loadDataUri(LOGO_PATH), iconDataUri: loadDataUri(ICON_PATH),
  avisoAtualizacao,
});
```

- [ ] **Step 2: Rodar a suíte inteira pra garantir que nada quebrou**

Run: `node --test test/*.js`
Expected: PASS (mesma contagem de antes + os 2 novos testes da Task 2)

- [ ] **Step 3: Commit**

```bash
git add tools/semanal/build-dashboard.js
git commit -m "build-dashboard.js lê o heartbeat de atualização e passa o aviso pro cabeçalho"
```

---

### Task 4: Refatorar `atualizar-arquivos.js` — expõe `rodarBuscas` e `publicarArquivos`

**Files:**
- Modify: `tools/semanal/atualizar-arquivos.js` (inteiro — extração de `publicarArquivos`, `main()` passa a chamá-la)

**Interfaces:**
- Produces (usados pela Task 5): `rodarBuscas(): Promise<Array<{nome: string, ok: boolean, erro?: string}>>`
  (já existia, só passa a ser exportada), `publicarArquivos(nomes: string[], mensagemCommit: string): {publicou: boolean}`
  (novo, extraído do corpo de `main()`), `ARQUIVOS_PUBLICAR: string[]` (já existia, só
  passa a ser exportada).

Este é um refactor de comportamento preservado — sem teste novo (o script não tem
teste hoje: é I/O pesado — git, Chrome, rede — e a lógica testável que ele usa já
está coberta em outros arquivos). A garantia é a suíte inteira continuar verde e uma
leitura lado a lado confirmando que `main()` faz exatamente os mesmos passos, na
mesma ordem.

- [ ] **Step 1: Extrair o bloco de cópia/commit/push de dentro de `main()` para uma função `publicarArquivos`**

Trocar o trecho de `main()` que vai de `console.log('\n=== Publicando em docs/ ===')`
até a chamada de `publicar()` (hoje dentro do `try` de `main`) por uma função nova,
**logo acima de `async function main()`**:

```js
// Copia os arquivos de dist/ pra docs/ (só os que mudaram), commita e publica.
// Extraído de main() em 2026-08-18 pra ser reaproveitado por
// atualizar-diario-escalonado.js, que decide os arquivos e a mensagem de
// commit de um jeito um pouco diferente (inclui o heartbeat de coordenação).
function publicarArquivos(nomes, mensagemCommit) {
  let algumaCopia = false;
  const arquivosParaGit = [];
  for (const nome of nomes) {
    const origem = path.join(DIST, nome);
    const alvo = path.join(DOCS, nome);
    if (!fs.existsSync(origem)) {
      console.warn(`Pulando ${nome}: não existe em dist/.`);
      continue;
    }
    arquivosParaGit.push(path.join('dist', nome), path.join('docs', nome));
    const bufOrigem = fs.readFileSync(origem);
    const bufAlvo = fs.existsSync(alvo) ? fs.readFileSync(alvo) : null;
    if (bufAlvo && bufOrigem.equals(bufAlvo)) {
      console.log(`${nome}: já estava igual em docs/, nada a copiar.`);
      continue;
    }
    fs.copyFileSync(origem, alvo);
    algumaCopia = true;
    console.log(`Copiado: dist/${nome} -> docs/${nome}`);
  }

  if (!algumaCopia) {
    console.log('\nNada mudou -- docs/ já estava sincronizado com dist/. Não há o que commitar.');
    return { publicou: false };
  }

  console.log('\n=== git add / commit / push ===');
  git(['add', ...arquivosParaGit]);
  const status = git(['status', '--porcelain', '--', ...arquivosParaGit]).trim();
  if (!status) {
    console.log('git: nada ficou staged (os arquivos copiados já estavam commitados) -- pulando commit/push.');
    return { publicou: false };
  }

  git(['commit', '-m', mensagemCommit]);
  console.log('Commit criado.');
  publicar();
  return { publicou: true };
}
```

- [ ] **Step 2: Simplificar `main()` pra chamar `publicarArquivos`**

Dentro do `try` de `main()`, trocar todo o bloco de cópia/commit (que acabou de sair
no Step 1) pelo trecho abaixo, mantendo a montagem da mensagem de commit exatamente
como já era:

```js
    console.log('\n=== Reconstruindo a página (build-dashboard.js) ===');
    const { build } = require('./build-dashboard.js');
    await build();

    const horario = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const falhas = resultadosBuscas.filter((r) => !r.ok);
    const mensagem = `Atualizar arquivos online (${horario})`
      + (falhas.length ? `\n\nFalha na busca de: ${falhas.map((f) => `${f.nome} (${f.erro})`).join('; ')}` : '');

    publicarArquivos(ARQUIVOS_PUBLICAR, mensagem);

    relatarResumo(resultadosBuscas);
```

(Isso substitui o bloco antigo, que ia de `console.log('\n=== Publicando em docs/
===')` até o `relatarResumo(resultadosBuscas)` final — inclusive a checagem `if
(!algumaCopia) { ...; return; }`, que agora vive dentro de `publicarArquivos` e
simplesmente não chama nada depois se `publicou: false`; como `relatarResumo` já era
chamado nos dois casos antes, mantenha a chamada solta no final de `main()`, fora do
`if`.)

- [ ] **Step 3: Atualizar `module.exports`**

```js
module.exports = { main, rodarBuscas, publicarArquivos, ARQUIVOS_PUBLICAR };
```

- [ ] **Step 4: Verificar que o módulo carrega e exporta o esperado**

Run: `node -e "const m = require('./tools/semanal/atualizar-arquivos.js'); console.log(Object.keys(m), typeof m.rodarBuscas, typeof m.publicarArquivos, Array.isArray(m.ARQUIVOS_PUBLICAR))"`
Expected: `[ 'main', 'rodarBuscas', 'publicarArquivos', 'ARQUIVOS_PUBLICAR' ] function function true`

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test test/*.js`
Expected: PASS (nenhum teste toca este arquivo hoje, então a contagem não muda)

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/atualizar-arquivos.js
git commit -m "atualizar-arquivos.js: extrai publicarArquivos e exporta rodarBuscas/ARQUIVOS_PUBLICAR"
```

---

### Task 5: Script de orquestração — `atualizar-diario-escalonado.js`

**Files:**
- Create: `tools/semanal/atualizar-diario-escalonado.js`

**Interfaces:**
- Consumes: `parseHeartbeatVolume`, `jaAtualizadoHoje`, `decidirResultado`,
  `formatarLinhaHeartbeat`, `CABECALHO_HEARTBEAT_VOLUME` (Task 1);
  `rodarBuscas`, `publicarArquivos`, `ARQUIVOS_PUBLICAR` (Task 4); `build` de
  `./build-dashboard.js`.
- Produces: `module.exports = { main }` (mesmo padrão de `atualizar-arquivos.js`).

Sem teste automatizado — mesma classe de script que `atualizar-arquivos.js` (I/O
pesado: git, Chrome, rede, filesystem do repositório real). A lógica de decisão que
importa (parsing, "já foi hoje", resultado) já está 100% coberta na Task 1; este
script só encadeia chamadas já testadas. Verificação é manual (Task 7).

- [ ] **Step 1: Escrever o script**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  parseHeartbeatVolume, jaAtualizadoHoje, decidirResultado, formatarLinhaHeartbeat,
  CABECALHO_HEARTBEAT_VOLUME,
} = require('./coordenacao-volume.js');
const { rodarBuscas, publicarArquivos, ARQUIVOS_PUBLICAR } = require('./atualizar-arquivos.js');

// Versão escalonada de atualizar-arquivos.js -- roda nas 3 máquinas
// (Patrick/Kairo/Américo), cada uma num horário diferente do Task
// Scheduler (ver docs/setup-atualizacao-escalonada.md), mas com o MESMO
// script: quem decide se roda é a checagem abaixo, não uma flag de "quem
// sou eu". Ver docs/superpowers/specs/2026-08-18-atualizacao-diaria-escalonada-design.md.

const RAIZ = path.join(__dirname, '..', '..');
const CAMINHO_HEARTBEAT_VOLUME = path.join(RAIZ, 'dist', 'heartbeat-atualizacao-volume.csv');
const NOME_HEARTBEAT_VOLUME = 'heartbeat-atualizacao-volume.csv';

function git(args) {
  return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8' });
}

// Lê o heartbeat de coordenação de origin/master, sem mesclar nada
// localmente -- só precisamos SABER se já rodou hoje, não trazer o
// arquivo pra árvore de trabalho ainda (isso acontece só se decidirmos
// rodar, via publicarArquivos -> git add, mais adiante).
function lerHeartbeatDoOrigin() {
  try {
    const texto = git(['show', `origin/master:dist/${NOME_HEARTBEAT_VOLUME}`]);
    return parseHeartbeatVolume(texto);
  } catch (err) {
    // Arquivo ainda não existe no origin (1ª execução deste mecanismo) --
    // trata como "nunca atualizado".
    return [];
  }
}

function gravarLinhaHeartbeat(linha) {
  fs.mkdirSync(path.dirname(CAMINHO_HEARTBEAT_VOLUME), { recursive: true });
  if (!fs.existsSync(CAMINHO_HEARTBEAT_VOLUME)) {
    fs.writeFileSync(CAMINHO_HEARTBEAT_VOLUME, CABECALHO_HEARTBEAT_VOLUME + '\n');
  }
  fs.appendFileSync(CAMINHO_HEARTBEAT_VOLUME, linha + '\n');
}

async function main() {
  if (!process.env.ORCAMENTO_SENHA) {
    throw new Error(
      'Defina ORCAMENTO_SENHA antes de rodar (a senha nunca fica em arquivo do repositório) -- ex.: '
      + "ORCAMENTO_SENHA='...' node tools/semanal/atualizar-diario-escalonado.js"
    );
  }

  console.log('Checando (via git, sem abrir Chrome) se já houve atualização com sucesso hoje...');
  git(['fetch', 'origin', 'master']);
  const linhasOrigin = lerHeartbeatDoOrigin();
  if (jaAtualizadoHoje(linhasOrigin)) {
    console.log('Já atualizado hoje por outra máquina -- nada a fazer.');
    return;
  }
  console.log('Ainda não atualizado hoje (ou a última tentativa falhou) -- prosseguindo.');

  // Mesma guarda de working tree sujo que atualizar-arquivos.js já usa --
  // ver o comentário lá (main(), início do try).
  const statusInicial = git(['status', '--porcelain']).trim();
  const precisaGuardar = statusInicial.length > 0;
  if (precisaGuardar) {
    console.log('\nHá mudanças não commitadas alheias a este script -- guardando com git stash antes de operar.');
    git(['stash', 'push', '-u', '-m', 'atualizar-diario-escalonado.js: mudanças pendentes guardadas antes da publicação automática']);
  }

  try {
    console.log('Buscando dados novos do sond.com.br -- exige Chrome aberto com --remote-debugging-port=9222, já logado.');
    const resultadosBuscas = await rodarBuscas();
    const { resultado, detalhe } = decidirResultado(resultadosBuscas);
    console.log(`Resultado desta execução: ${resultado}${detalhe ? ` (${detalhe})` : ''}.`);

    const maquina = process.env.COMPUTERNAME || 'desconhecida';
    gravarLinhaHeartbeat(formatarLinhaHeartbeat({ dataHora: new Date(), maquina, resultado, detalhe }));

    console.log('\n=== Reconstruindo a página (build-dashboard.js) ===');
    const { build } = require('./build-dashboard.js');
    await build();

    const horario = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const mensagem = `Atualização escalonada (${horario}, ${maquina}, ${resultado})`
      + (detalhe ? `\n\nFalha na busca de: ${detalhe}` : '');

    publicarArquivos([...ARQUIVOS_PUBLICAR, NOME_HEARTBEAT_VOLUME], mensagem);

    console.log(resultado === 'ok' ? '\n=== Concluído com sucesso ===' : '\n=== Concluído, mas todas as 5 buscas falharam (heartbeat registrado como "falhou" -- a próxima máquina da fila vai tentar) ===');
  } finally {
    if (precisaGuardar) {
      console.log('\nDevolvendo as mudanças pendentes guardadas no início (git stash pop).');
      git(['stash', 'pop']);
    }
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { main };
```

- [ ] **Step 2: Verificar que o módulo carrega sem erro de sintaxe/require**

Run: `node -e "require('./tools/semanal/atualizar-diario-escalonado.js')"`
Expected: sem erro, sem saída (só carrega o módulo, `require.main !== module` então
`main()` não roda)

- [ ] **Step 3: Rodar a suíte inteira**

Run: `node --test test/*.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tools/semanal/atualizar-diario-escalonado.js
git commit -m "Adiciona atualizar-diario-escalonado.js -- orquestra a checagem + buscas + publish"
```

---

### Task 6: Wrapper PowerShell com Chrome minimizado

**Files:**
- Create: `tools/semanal/atualizar-diario-escalonado.ps1`

Cópia de `tools/semanal/atualizar-diario.ps1` com 2 mudanças: abre o Chrome
minimizado quando precisa abrir do zero, e chama o script novo da Task 5 em vez de
`atualizar-arquivos.js`. Mesma ausência de acentos do arquivo original (PowerShell
5.1 sem BOM = mojibake).

- [ ] **Step 1: Criar o arquivo**

```powershell
# Wrapper para a atualizacao ESCALONADA (Task Scheduler, 2 horarios por dia --
# ver docs/setup-atualizacao-escalonada.md). Diferenca para atualizar-diario.ps1
# (que este arquivo substitui no agendamento das 3 maquinas):
#   1. Abre o Chrome MINIMIZADO quando precisa abrir do zero (--start-minimized)
#      -- nao deve aparecer na tela de quem estiver usando a maquina.
#   2. Chama atualizar-diario-escalonado.js, que decide via git se ja rodou
#      hoje ANTES de fazer qualquer coisa (nao abre Chrome se ja foi feito).
#
# Sem acento de proposito neste arquivo inteiro (mesmo motivo de
# atualizar-diario.ps1): PowerShell 5.1 le .ps1 sem BOM assumindo a codepage
# do sistema, nao UTF-8, e qualquer acento sai como mojibake no log.
#
# ORCAMENTO_SENHA precisa ja estar definida como variavel de ambiente
# PERSISTENTE do usuario nesta maquina -- ver SETUP-ATUALIZACAO-DIARIA.md.

$Raiz = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$PerfilDebug = Join-Path $env:USERPROFILE 'chrome-debug-profile'
$PastaLogs = Join-Path $env:USERPROFILE 'orcamento-dashboard-logs'
$PortaDebug = 9222

if (-not (Test-Path $PastaLogs)) { New-Item -ItemType Directory -Path $PastaLogs -Force -ErrorAction Stop | Out-Null }
$Carimbo = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$LogPath = Join-Path $PastaLogs "escalonado-$Carimbo.log"

function Escrever($linha) {
    $linhaComHora = "[$(Get-Date -Format 'HH:mm:ss')] $linha"
    Write-Host $linhaComHora
    Add-Content -Path $LogPath -Value $linhaComHora -ErrorAction Stop
}

function PortaResponde {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$PortaDebug/json/version" -UseBasicParsing -TimeoutSec 3
        return $r.StatusCode -eq 200
    } catch {
        return $false
    }
}

Escrever "=== Atualizacao escalonada -- $Carimbo ==="

if (-not $env:ORCAMENTO_SENHA) {
    Escrever "ERRO: ORCAMENTO_SENHA nao esta definida nesta sessao. Configure a variavel de ambiente persistente uma vez -- ver SETUP-ATUALIZACAO-DIARIA.md."
    exit 1
}

# Heartbeat diario de "Chrome alcancavel" (chrome_ok) -- mesmo mecanismo que
# atualizar-diario.ps1 ja tinha, preservado aqui porque este script assume o
# lugar dele no agendamento das 3 maquinas. So registra depois de confirmar
# que a porta responde (ou que acabamos de abrir com sucesso), mais abaixo.
function RegistrarHeartbeatChrome {
    $CaminhoCsv = Join-Path $Raiz 'docs\heartbeat-atualizacao-diaria.csv'
    $DataHoje = Get-Date -Format 'yyyy-MM-dd'
    $Linha = "$DataHoje,$env:COMPUTERNAME,true"
    try {
        Push-Location $Raiz
        if (-not (Test-Path $CaminhoCsv)) {
            Set-Content -Path $CaminhoCsv -Value 'data,maquina,chrome_ok' -ErrorAction Stop
        }
        Add-Content -Path $CaminhoCsv -Value $Linha -ErrorAction Stop
        & git add docs/heartbeat-atualizacao-diaria.csv 2>&1 | Out-Null
        $temMudanca = (& git status --porcelain -- docs/heartbeat-atualizacao-diaria.csv 2>&1)
        if (-not $temMudanca) {
            Escrever "Heartbeat de Chrome: linha de hoje ja estava registrada, nada a commitar."
            return
        }
        & git commit -m "Heartbeat: Chrome alcancavel em $env:COMPUTERNAME ($DataHoje)" 2>&1 | Out-Null
        & git fetch origin master 2>&1 | Out-Null
        & git rebase origin/master 2>&1 | Out-Null
        $pushOk = $false
        for ($t = 1; $t -le 3; $t++) {
            & git push origin HEAD:master 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) { $pushOk = $true; break }
            & git fetch origin master 2>&1 | Out-Null
            & git rebase origin/master 2>&1 | Out-Null
        }
        if ($pushOk) {
            Escrever "Heartbeat de Chrome registrado e publicado."
        } else {
            Escrever "AVISO: heartbeat de Chrome nao conseguiu publicar depois de 3 tentativas -- seguindo mesmo assim."
            & git rebase --abort 2>&1 | Out-Null
        }
    } catch {
        Escrever "AVISO: heartbeat de Chrome falhou ($($_.Exception.Message)) -- seguindo mesmo assim."
    } finally {
        Pop-Location
    }
}

if (-not (PortaResponde)) {
    Escrever "Chrome de depuracao nao esta respondendo na porta $PortaDebug -- tentando abrir MINIMIZADO com o perfil dedicado ($PerfilDebug)..."
    $ChromeExe = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1

    if (-not $ChromeExe) {
        Escrever "ERRO: nao achei chrome.exe em nenhum caminho padrao. Instale o Google Chrome ou ajuste este script."
        exit 1
    }

    Start-Process $ChromeExe -ArgumentList "--remote-debugging-port=$PortaDebug", "--user-data-dir=`"$PerfilDebug`"", '--start-minimized'

    $tentativas = 0
    while (-not (PortaResponde) -and $tentativas -lt 10) {
        Start-Sleep -Seconds 2
        $tentativas++
    }

    if (-not (PortaResponde)) {
        Escrever "ERRO: Chrome nao respondeu na porta $PortaDebug depois de abrir. Abortando sem rodar a busca."
        exit 1
    }
    Escrever "Chrome de depuracao no ar (minimizado)."
} else {
    Escrever "Chrome de depuracao ja estava no ar."
}

RegistrarHeartbeatChrome

Escrever "Rodando atualizar-diario-escalonado.js (saida completa vai so para o log, nao para o console)..."

$TranscriptPath = Join-Path $PastaLogs "escalonado-$Carimbo.transcript.log"
Push-Location $Raiz
try {
    Start-Transcript -Path $TranscriptPath -ErrorAction Stop | Out-Null
    & node "tools\semanal\atualizar-diario-escalonado.js"
    $codigoSaida = $LASTEXITCODE
} finally {
    Stop-Transcript | Out-Null
    Pop-Location
}

Get-Content $TranscriptPath | Add-Content -Path $LogPath
Remove-Item $TranscriptPath -ErrorAction SilentlyContinue

if ($codigoSaida -eq 0) {
    Escrever "=== Concluido com sucesso (ou pulado por ja ter sido feito hoje) ==="
} else {
    Escrever "=== FALHOU (codigo $codigoSaida) -- ver log completo acima ==="
}
exit $codigoSaida
```

- [ ] **Step 2: Validar sintaxe do script**

Run: `powershell -NoProfile -Command "$null = [System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw 'tools\semanal\atualizar-diario-escalonado.ps1'), [ref]$null); Write-Host 'sintaxe ok'"`
Expected: `sintaxe ok`, sem exceção

- [ ] **Step 3: Commit**

```bash
git add tools/semanal/atualizar-diario-escalonado.ps1
git commit -m "Adiciona wrapper PowerShell da atualização escalonada (Chrome minimizado)"
```

---

### Task 7: Configuração do Task Scheduler (2 horários por máquina)

**Files:**
- Create: `tools/semanal/configurar-tarefa-agendada-escalonada.ps1`
- Create: `docs/setup-atualizacao-escalonada.md`

- [ ] **Step 1: Criar o script de configuração**

```powershell
# Registra a tarefa da atualizacao ESCALONADA nesta maquina -- 2 disparos por
# dia (rodada normal + rodada de seguranca 1h depois), no minuto que a
# ordem desta maquina exige (ver docs/setup-atualizacao-escalonada.md):
#   Patrick (1a da fila)  -> -MinutoOffset 0   (dispara as 8:00 e 9:00)
#   Kairo   (2a da fila)  -> -MinutoOffset 15  (dispara as 8:15 e 9:15)
#   Americo (3a da fila)  -> -MinutoOffset 30  (dispara as 8:30 e 9:30)
#
# Desativa a tarefa antiga (OrcamentoDashboard-AtualizacaoDiaria), que este
# mecanismo substitui -- ver a secao "Descontinuado do Task Scheduler" do
# spec (docs/superpowers/specs/2026-08-18-atualizacao-diaria-escalonada-design.md).
#
# Sem acento de proposito (mesmo motivo dos outros .ps1 deste projeto).
#
# Uso: powershell -ExecutionPolicy Bypass -File configurar-tarefa-agendada-escalonada.ps1 -MinutoOffset 0

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(0, 15, 30)]
    [int]$MinutoOffset
)

$ErrorActionPreference = 'Stop'

$WrapperPath = Join-Path $PSScriptRoot 'atualizar-diario-escalonado.ps1'
if (-not (Test-Path $WrapperPath)) {
    throw "Nao achei atualizar-diario-escalonado.ps1 ao lado deste script ($WrapperPath) -- rode a partir do clone do repositorio."
}

if (-not $env:ORCAMENTO_SENHA) {
    Write-Warning "ORCAMENTO_SENHA nao esta definida nesta sessao. A tarefa vai FALHAR ate voce definir a variavel de ambiente PERSISTENTE do usuario -- ver SETUP-ATUALIZACAO-DIARIA.md."
}

$TarefaAntiga = 'OrcamentoDashboard-AtualizacaoDiaria'
if (Get-ScheduledTask -TaskName $TarefaAntiga -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TarefaAntiga -Confirm:$false
    Write-Host "Tarefa antiga '$TarefaAntiga' removida (substituida pelo mecanismo escalonado)."
}

$Trigger1 = New-ScheduledTaskTrigger -Daily -At (Get-Date -Hour 8 -Minute $MinutoOffset -Second 0)
$Trigger2 = New-ScheduledTaskTrigger -Daily -At (Get-Date -Hour 9 -Minute $MinutoOffset -Second 0)
$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$WrapperPath`""
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName 'OrcamentoDashboard-AtualizacaoEscalonada' -Action $Action -Trigger @($Trigger1, $Trigger2) -Settings $Settings -Principal $Principal -Description "Atualizacao escalonada do Planejamento Semanal (Patrick/Kairo/Americo) -- 2 disparos diarios, minuto $MinutoOffset." -Force | Out-Null

Write-Host "Tarefa 'OrcamentoDashboard-AtualizacaoEscalonada' registrada -- dispara as 8:$('{0:D2}' -f $MinutoOffset) e 9:$('{0:D2}' -f $MinutoOffset), todo dia."
Write-Host "Para testar agora: Start-ScheduledTask -TaskName 'OrcamentoDashboard-AtualizacaoEscalonada'"
Write-Host "Log de cada execucao fica em $env:USERPROFILE\orcamento-dashboard-logs\"
```

- [ ] **Step 2: Validar sintaxe do script**

Run: `powershell -NoProfile -Command "$null = [System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw 'tools\semanal\configurar-tarefa-agendada-escalonada.ps1'), [ref]$null); Write-Host 'sintaxe ok'"`
Expected: `sintaxe ok`, sem exceção

- [ ] **Step 3: Escrever o guia de setup**

```markdown
# Setup da atualização escalonada (Patrick → Kairo → Américo)

Substitui a tarefa `OrcamentoDashboard-AtualizacaoDiaria` (as 3 máquinas rodando
tudo às 8h ao mesmo tempo) por um mecanismo escalonado — cada máquina num horário
diferente, checando antes se alguém já publicou hoje. Ver o design completo em
`docs/superpowers/specs/2026-08-18-atualizacao-diaria-escalonada-design.md`.

## Pré-requisito (as 3 máquinas)

Mesmo de sempre — `ORCAMENTO_SENHA` definida como variável de ambiente
**persistente** do usuário (não só da sessão atual): ver
`SETUP-ATUALIZACAO-DIARIA.md`. Sem isso a tarefa falha todo dia.

## Configurar cada máquina

Rodar **uma vez** em cada máquina, com o offset que corresponde à posição dela na
fila:

| Máquina | Posição | Comando |
|---|---|---|
| Patrick (`COMPUTADOR053`) | 1ª (8:00 / 9:00) | `powershell -ExecutionPolicy Bypass -File tools\semanal\configurar-tarefa-agendada-escalonada.ps1 -MinutoOffset 0` |
| Kairo | 2ª (8:15 / 9:15) | `powershell -ExecutionPolicy Bypass -File tools\semanal\configurar-tarefa-agendada-escalonada.ps1 -MinutoOffset 15` |
| Américo (`COMP-074`) | 3ª (8:30 / 9:30) | `powershell -ExecutionPolicy Bypass -File tools\semanal\configurar-tarefa-agendada-escalonada.ps1 -MinutoOffset 30` |

O script remove a tarefa antiga (`OrcamentoDashboard-AtualizacaoDiaria`) sozinho,
se ela existir naquela máquina.

## Pendência: hostname do Kairo

`tools/semanal/coordenacao-volume.js` tem um mapa (`NOMES_AMIGAVEIS`) que traduz o
hostname de cada máquina pro nome que aparece no aviso da tela ("Atualizado às
08:15 por Kairo"). Hoje só `COMPUTADOR053` (Patrick) e `COMP-074` (Américo) estão
mapeados — **o hostname da máquina do Kairo ainda não foi confirmado**. Sem o mapa,
o aviso mostra o hostname cru dele (funciona, só não fica com o nome bonito). Pra
completar: rodar `echo %COMPUTERNAME%` na máquina dele, acrescentar a linha no mapa
e publicar.

## Testar sem esperar o horário

Em qualquer uma das 3 máquinas, depois de configurada:

```
Start-ScheduledTask -TaskName 'OrcamentoDashboard-AtualizacaoEscalonada'
```

Acompanhar o log mais recente em `%USERPROFILE%\orcamento-dashboard-logs\`. Se
outra máquina já publicou hoje, o log mostra "Já atualizado hoje por outra máquina
-- nada a fazer." e o Chrome nem chega a abrir.
```

- [ ] **Step 4: Commit**

```bash
git add tools/semanal/configurar-tarefa-agendada-escalonada.ps1 docs/setup-atualizacao-escalonada.md
git commit -m "Adiciona script de agendamento (2 horários) e guia de setup da atualização escalonada"
```

---

### Task 8: Aplicar e testar nesta máquina (Patrick), publicar

**Files:** nenhum arquivo novo — só execução e verificação.

- [ ] **Step 1: Rodar a suíte inteira uma última vez**

Run: `node --test test/*.js`
Expected: PASS, 100%

- [ ] **Step 2: Registrar a tarefa nesta máquina (Patrick = offset 0)**

Run: `powershell -ExecutionPolicy Bypass -File tools\semanal\configurar-tarefa-agendada-escalonada.ps1 -MinutoOffset 0`
Expected: confirma a remoção da tarefa antiga (se existia) e o registro da nova,
disparando às 8:00 e 9:00.

- [ ] **Step 3: Disparar manualmente e observar**

Run: `Start-ScheduledTask -TaskName 'OrcamentoDashboard-AtualizacaoEscalonada'`

Esperar ~1-2 min e conferir o log mais novo em
`%USERPROFILE%\orcamento-dashboard-logs\escalonado-*.log`: deve mostrar a checagem
via git, a abertura do Chrome **minimizado** (ou "já estava no ar"), as 5 buscas, o
build, e o commit/push. Confirmar visualmente que **nenhuma janela do Chrome
aparece na tela** durante a execução.

- [ ] **Step 4: Conferir o resultado publicado**

```bash
git log --oneline -3
git show --stat HEAD -- dist/heartbeat-atualizacao-volume.csv docs/heartbeat-atualizacao-volume.csv
grep -o 'Atualizado às [0-9:]* por [^<]*' dist/planejamento-semanal.html
```

Expected: o commit mais recente é da atualização escalonada; o heartbeat novo tem
uma linha de hoje; o `grep` no HTML gerado mostra o aviso com o horário e "Patrick"
(o texto do aviso fica em HTML puro, fora do blob cifrado — não precisa da senha
pra conferir).

- [ ] **Step 5: Disparar de novo e confirmar que pula**

Run: `Start-ScheduledTask -TaskName 'OrcamentoDashboard-AtualizacaoEscalonada'`

Esperar ~10s e checar o log mais novo: deve mostrar "Já atualizado hoje por outra
máquina -- nada a fazer." **sem abrir o Chrome** (nenhuma tentativa de
`PortaResponde` sendo tentada além da checagem git).

## Testes

Suíte inteira (`node --test test/*.js`) tem que fechar verde depois de cada task.
Contagem esperada: base atual + 16 (Task 1) + 2 (Task 2) = base + 18 testes novos.

## Fora de escopo

- Aplicar a configuração do Task Scheduler nas máquinas do Kairo e do Américo —
  fica documentado em `docs/setup-atualizacao-escalonada.md`, mas só quem tem
  acesso a cada máquina consegue rodar o comando lá.
- Descobrir o hostname da máquina do Kairo (pendência anotada no guia de setup).
- Qualquer mudança de regra de negócio nas abas do dashboard.
- Ciclo de hora em hora (descartado no brainstorm).
