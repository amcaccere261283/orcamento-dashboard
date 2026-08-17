'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  lerCsvExistente, linhasRosterDoMes, gravarRoster, lerRosterExistente, CABECALHO_ROSTER,
  mesesPendentes,
} = require('../tools/semanal/atualizar-equipes-online.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('lerCsvExistente lê o formato cru novo (IdEquipe,SUP,Tipo,DiaEpoch), dia na coluna 4', () => {
  const caminho = path.join(os.tmpdir(), `equipes-teste-${Date.now()}.csv`);
  fs.writeFileSync(caminho, 'IdEquipe,SUP,Tipo,DiaEpoch\n441,SUP-1,SP,19000\n442,SUP-2,SM,19001\n');
  const { porDia, ultimoDia } = lerCsvExistente(caminho);
  assert.deepEqual(Object.keys(porDia).sort(), ['19000', '19001']);
  assert.equal(porDia[19000].length, 1);
  assert.equal(porDia[19000][0], '441,SUP-1,SP,19000');
  assert.equal(ultimoDia, 19001);
  fs.unlinkSync(caminho);
});

test('lerCsvExistente devolve porDia vazio quando o arquivo não existe', () => {
  const { porDia, ultimoDia } = lerCsvExistente(path.join(os.tmpdir(), 'nao-existe-nunca.csv'));
  assert.deepEqual(porDia, {});
  assert.equal(ultimoDia, null);
});

// Achado da revisão final de branch (2026-08-10): lerCsvExistente não tinha a
// trava de formato que lerRosterExistente já tinha, e os arquivos publicados
// ainda estavam no formato pré-2026-08-10 ('SUP,Tipo,DiaEpoch,Fracao'), onde a
// coluna [3] é a FRAÇÃO. Sem a trava, "0.5" viraria um dia-desde-época e o
// arquivo publicado seria regravado com dias num mês bogus que nenhum
// re-fetch alcança.
test('lerCsvExistente descarta arquivo de produção no formato ANTIGO (SUP,Tipo,DiaEpoch,Fracao)', () => {
  const caminho = path.join(os.tmpdir(), `producao-antiga-${Date.now()}.csv`);
  fs.writeFileSync(caminho, 'SUP,Tipo,DiaEpoch,Fracao\nSUP-1,SP,19000,0.5\n');
  const { porDia, ultimoDia } = lerCsvExistente(caminho);
  assert.deepEqual(porDia, {});
  assert.equal(ultimoDia, null);
  fs.unlinkSync(caminho);
});

test('linhasRosterDoMes classifica cada dia de cada equipe e devolve linhas no formato de CABECALHO_ROSTER', () => {
  // Mesmo formato de tools/semanal/compute-equipes-ativas.js: cabeçalho na
  // linha 0 (colunas de dia), sub-cabeçalho na linha 1 (ignorada), dado a
  // partir da linha 2. Coluna 0 = ID, coluna 1 = Nome.
  const csv = [
    'ID,Nome,-,Serviços,1-Ago,2-Ago',
    '-,-,-,-,-,-',
    '441,João,-,SP,CCR RioSP (17851-26),Férias',
  ].join('\n');
  const linhas = linhasRosterDoMes(csv, 2026, 8);
  assert.deepEqual(linhas.sort(), [
    `441,${Math.floor(Date.UTC(2026, 7, 1) / 86400000)},mobilizada,0,17851-26,João,SP`,
    `441,${Math.floor(Date.UTC(2026, 7, 2) / 86400000)},fora,0,,João,SP`,
  ].sort());
});

// Regressão da rodada de correção (2026-08-10): o roster original só levava
// (IdEquipe, DiaEpoch, Estado) e descartava noDefault/OS/Nome/Serviços -- que o
// fetcher já tinha em mãos. Sem noDefault, a ponte no build sintetizava TODO
// campoSemFuro como texto CATALOGADO e "Equipes Não-produtivas" passava a
// contar os ~572 equipe-dia/mês de texto livre que descrevem trabalho real.
test('linhasRosterDoMes grava NoDefault=1 no campoSemFuro que caiu no default do classificador', () => {
  const csv = [
    'ID,Nome,-,Serviços,1-Ago,2-Ago',
    '-,-,-,-,-,-',
    // "Via Mineira" é texto livre não catalogado (trabalho real, noDefault);
    // "Chuva" é campoSemFuro CATALOGADO (regra explícita).
    '441,João,-,SP,Via Mineira,Chuva',
  ].join('\n');
  const [linha1, linha2] = linhasRosterDoMes(csv, 2026, 8);
  assert.equal(linha1.split(',')[2], 'campoSemFuro');
  assert.equal(linha1.split(',')[3], '1', 'texto não catalogado tem que sair com NoDefault=1');
  assert.equal(linha2.split(',')[2], 'campoSemFuro');
  assert.equal(linha2.split(',')[3], '0', 'texto catalogado tem que sair com NoDefault=0');
});

test('linhasRosterDoMes neutraliza vírgula em Nome/Serviços (o CSV é lido por split simples)', () => {
  const csv = [
    'ID,Nome,-,Serviços,1-Ago',
    '-,-,-,-,-',
    '"441","Silva, João","-","SP, SM","Chuva"',
  ].join('\n');
  const [linha] = linhasRosterDoMes(csv, 2026, 8);
  assert.equal(linha.split(',').length, 7, 'a linha tem que continuar com exatamente 7 colunas');
  assert.equal(linha.split(',')[5], 'Silva João');
  assert.equal(linha.split(',')[6], 'SP SM');
});

test('lerRosterExistente descarta arquivo no formato ANTIGO (3 colunas), forçando re-fetch', () => {
  const caminho = path.join(os.tmpdir(), `roster-antigo-${Date.now()}.csv`);
  fs.writeFileSync(caminho, 'IdEquipe,DiaEpoch,Estado\n441,19000,mobilizada\n');
  assert.deepEqual(lerRosterExistente(caminho).porDia, {});
  fs.writeFileSync(caminho, `${CABECALHO_ROSTER}\n441,19000,mobilizada,0,17851-26,João,SP\n`);
  assert.deepEqual(Object.keys(lerRosterExistente(caminho).porDia), ['19000']);
  fs.unlinkSync(caminho);
});

test('linhasRosterDoMes ignora célula vazia (dia ainda não preenchido)', () => {
  const csv = ['ID,Nome,-,Serviços,1-Ago', '-,-,-,-,-', '441,João,-,SP,'].join('\n');
  assert.deepEqual(linhasRosterDoMes(csv, 2026, 8), []);
});

test('gravarRoster preserva linhas de agosto de OUTRO ano ao regravar agosto do ano corrente (year-qualified month key)', () => {
  // Regressão: mesesBuscados/mesDoRegistro chaveados por mês bare (1-12)
  // faziam a regravação de agosto/2026 descartar também agosto/2025 -- o
  // check de pertencimento ignorava o ano por completo. Fix: as duas pontas
  // usam a mesma chave 'AAAA-MM' que o Link 7 (mesDoDia) já usa.
  const diaAgo2025 = Math.floor(Date.UTC(2025, 7, 15) / 86400000);
  const diaAgo2026Velho = Math.floor(Date.UTC(2026, 7, 10) / 86400000);
  const diaAgo2026Novo = Math.floor(Date.UTC(2026, 7, 20) / 86400000);

  // Destino temporário: este teste não pode escrever no dist/ publicado.
  const caminho = path.join(os.tmpdir(), `roster-gravar-${Date.now()}.csv`);
  try {
    const jaTemos = {
      [diaAgo2025]: [`111,${diaAgo2025},mobilizada,0,17851-26,João,SP`],
      [diaAgo2026Velho]: [`222,${diaAgo2026Velho},mobilizada,0,17851-26,João,SP`],
    };
    gravarRoster({
      linhasNovas: [`333,${diaAgo2026Novo},fora,0,,Maria,SM`],
      mesesBuscados: new Set(['2026-08']),
      jaTemos,
    }, caminho);
    const gravado = fs.readFileSync(caminho, 'utf8');
    assert.equal(gravado.split('\n')[0], CABECALHO_ROSTER);
    assert.ok(
      gravado.includes(`111,${diaAgo2025},mobilizada,0,17851-26,João,SP`),
      'linha de agosto/2025 deveria sobreviver à regravação de agosto/2026',
    );
    assert.ok(gravado.includes(`333,${diaAgo2026Novo},fora,0,,Maria,SM`), 'linha nova de agosto/2026 deveria ter sido gravada');
    assert.ok(
      !gravado.includes(`222,${diaAgo2026Velho},mobilizada`),
      'linha velha de agosto/2026 deveria ter sido substituída pelo re-fetch do mês',
    );
  } finally {
    fs.rmSync(caminho, { force: true });
  }
});

// Dia-desde-época de uma data do calendário, para montar as chaves de porDia.
// Mesma conta de diaEpoch (tools/comum/datas.js), repetida aqui para o teste
// não depender da ordem de import daquele módulo.
function diaEpochDe(ano, mes, dia) {
  return Math.floor(Date.UTC(ano, mes - 1, dia) / 86400000);
}

// O fetcher passou a gravar o dia CORRENTE (2026-08-17, ver
// docs/superpowers/specs/2026-08-17-realizado-ate-hoje-design.md), e o dia
// corrente é parcial: ele é capturado às 8h e só fica completo na captura do
// dia seguinte. O mês corrente já era rebuscado sempre, então o caso normal se
// resolve sozinho -- menos na virada do mês, onde o último dia ficaria
// congelado no retrato parcial para sempre. Por isso o mês ANTERIOR também
// entra.
test('mesesPendentes inclui o mês anterior mesmo quando ele já tem dado -- senão o último dia dele congela parcial', () => {
  // Todos os meses de jan a jul já têm dado; o mês corrente é julho (7).
  const porDia = {};
  [1, 2, 3, 4, 5, 6, 7].forEach((mes) => {
    porDia[String(diaEpochDe(2026, mes, 10))] = ['441,SUP-1,SP,0'];
  });
  const pendentes = mesesPendentes(porDia, 2026, 7);
  assert.deepEqual(pendentes, [6, 7], 'o mês corrente (7) e o anterior (6), nada mais');
});

test('mesesPendentes em JANEIRO não inventa mês 0 -- o mês anterior cruzaria o ano, que está fora do backfill', () => {
  const porDia = { [String(diaEpochDe(2026, 1, 10))]: ['441,SUP-1,SP,0'] };
  assert.deepEqual(mesesPendentes(porDia, 2026, 1), [1]);
});

test('mesesPendentes continua trazendo os meses SEM dado nenhum, que é o backfill original', () => {
  // Maio E junho têm dado; o mês corrente é julho. Junho precisa ter dado para
  // este teste discriminar: sem dado ele entraria pelo backfill de qualquer
  // jeito, e a regra do "mês anterior" ficaria sem prova. Com dado, só a regra
  // nova o traz -- antes dela o esperado era [1, 2, 3, 4, 7].
  const porDia = {
    [String(diaEpochDe(2026, 5, 10))]: ['441,SUP-1,SP,0'],
    [String(diaEpochDe(2026, 6, 10))]: ['441,SUP-1,SP,0'],
  };
  assert.deepEqual(mesesPendentes(porDia, 2026, 7), [1, 2, 3, 4, 6, 7],
    'maio sai (tem dado e não é corrente nem anterior); junho entra por ser o anterior, apesar de ter dado');
});
