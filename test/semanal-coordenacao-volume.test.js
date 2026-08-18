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
