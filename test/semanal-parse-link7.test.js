'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseLinhasLink7 } = require('../tools/semanal/atualizar-equipes-online.js');
const { diaEpoch } = require('../tools/semanal/compute-semanal.js');

function linhaLink7Cru(over = {}) {
  return Object.assign({
    'Ordem de Serviço (OS)': '16744-25',
    Tipo: 'SP',
    'Contrato Financeiro': 'SUP-7722-24',
    'Data / Hora Primeira Foto': '08/08/2026 07:54',
    'ID Sondador': '3275',
  }, over);
}

// Equipes PRODUTIVAS (2026-08-09): direto do Link 7, ID Sondador como chave
// -- não precisa mais casar com o roster do Link 6 (o link por nome via
// "Líder" foi um ajuste temporário só cobria ~20%; a discussão de Equipes
// ATIVAS via roster fica pra depois, ver compute-equipes-fracao.js).
test('extrai idEquipe, sup, tipo e diaEpoch da data/hora da primeira foto', () => {
  const [linha] = parseLinhasLink7([linhaLink7Cru()]);
  assert.strictEqual(linha.idEquipe, '3275');
  assert.strictEqual(linha.sup, 'SUP-7722-24');
  assert.strictEqual(linha.tipo, 'SP');
  assert.strictEqual(linha.diaEpoch, diaEpoch(new Date('2026-08-08T00:00:00Z')));
});

// Achado rodando o pipeline de verdade em 2026-08-08: o cabeçalho REAL desta
// coluna no site tem espaço DUPLO ("Data / Hora  Primeira Foto"), diferente
// da fixture original acima (espaço simples) -- toda linha era descartada em
// silêncio (0 sondagem-dia, sem erro), porque o acesso por chave exata dava
// undefined. colunaTolerante ignora a variação de espaçamento.
test('cabeçalho real com espaço DUPLO ("Data / Hora  Primeira Foto") ainda é lido -- não fica preso ao espaçamento exato do site', () => {
  const linhaEspacoDuplo = {
    'Ordem de Serviço (OS)': '16744-25', Tipo: 'SP', 'Contrato Financeiro': 'SUP-7722-24',
    'Data / Hora  Primeira Foto': '08/08/2026 07:54', 'ID Sondador': '3275',
  };
  const [linha] = parseLinhasLink7([linhaEspacoDuplo]);
  assert.ok(linha, 'linha não deveria ter sido descartada');
  assert.strictEqual(linha.diaEpoch, diaEpoch(new Date('2026-08-08T00:00:00Z')));
});

test('linha com data ilegível é descartada, não quebra', () => {
  const linhas = parseLinhasLink7([linhaLink7Cru({ 'Data / Hora Primeira Foto': '' })]);
  assert.strictEqual(linhas.length, 0);
});

// Achado da revisão final de branch (2026-08-08): o Tipo do Link 7 é BRUTO
// (alfabeto de 21 rótulos da aba Avanços), não o rótulo de 10 tipologias da
// MATRIZ -- sem traduzir aqui, resolverSupConhecido nunca acha o par na
// MATRIZ e o Realizado de Equipes fica 0,0 pra essas tipologias, em
// silêncio. rotularTipologia (tools/comum/tipologias-avancos.js) é a MESMA
// tradução que parse-avancos.js já aplica.
test('Tipo bruto "SM" é traduzido pro rótulo da MATRIZ "SM / SM.F / SR"', () => {
  const [linha] = parseLinhasLink7([linhaLink7Cru({ Tipo: 'SM' })]);
  assert.strictEqual(linha.tipo, 'SM / SM.F / SR');
});

test('Tipo bruto "CPTU" é traduzido pro rótulo da MATRIZ "CPTu" (note a troca de maiúscula/minúscula)', () => {
  const [linha] = parseLinhasLink7([linhaLink7Cru({ Tipo: 'CPTU' })]);
  assert.strictEqual(linha.tipo, 'CPTu');
});

test('Tipo desconhecido lança erro (fail-loud) em vez de cair calado em algum balde', () => {
  assert.throws(() => parseLinhasLink7([linhaLink7Cru({ Tipo: 'ALGO-NUNCA-VISTO' })]), /Tipologia desconhecida/);
});

test('duas linhas da mesma OS+dia (múltiplas fotos) viram duas entradas -- a deduplicação de combinação acontece em compute-equipes-produtivas-link7.js, não aqui', () => {
  const linhas = parseLinhasLink7([linhaLink7Cru(), linhaLink7Cru()]);
  assert.strictEqual(linhas.length, 2);
});

// --- renomeação de coluna na fonte (2026-08-10) ----------------------------
//
// O sond.com.br renomeou a coluna que identifica a equipe: o spec de
// 2026-08-08 registrou "ID Sondador", e dois dias depois a tabela veio com
// "Nº Equipe". O modo de falha foi o pior possível -- silencioso: toda linha
// saía com id vazio, agregarEquipesProdutivas descartava as 8.618 linhas por
// "sem id", o CSV era gravado só com cabeçalho, o fetcher relatava "119 dias
// novos" e o build caía na fonte de reserva sem avisar ninguém.

test('aceita a grafia NOVA "Nº Equipe"', () => {
  const l = parseLinhasLink7([linhaLink7Cru({ 'Nº Equipe': '441', 'ID Sondador': undefined })])[0];
  assert.strictEqual(l.idEquipe, '441');
});

test('aceita a grafia ANTIGA "ID Sondador" -- a fonte pode voltar atrás', () => {
  const l = parseLinhasLink7([linhaLink7Cru({ 'ID Sondador': '3275' })])[0];
  assert.strictEqual(l.idEquipe, '3275');
});

test('sem NENHUMA das grafias, LANÇA citando as colunas recebidas -- nunca devolve lista vazia em silêncio', () => {
  const semColuna = linhaLink7Cru();
  delete semColuna['ID Sondador'];
  assert.throws(() => parseLinhasLink7([semColuna]), /Nenhuma coluna de identificação de equipe/);
  assert.throws(() => parseLinhasLink7([semColuna]), /Contrato Financeiro/, 'a mensagem lista o que chegou, pra dar o nome novo de graça');
});

test('a checagem de coluna não confunde valor VAZIO com coluna AUSENTE', () => {
  // Coluna presente e vazia é dado ruim de uma linha só -- a linha é
  // ignorada pelo agregador, mas não derruba o fetch inteiro.
  const vazia = parseLinhasLink7([linhaLink7Cru({ 'ID Sondador': '' })]);
  assert.strictEqual(vazia.length, 1);
  assert.strictEqual(vazia[0].idEquipe, '');
});
