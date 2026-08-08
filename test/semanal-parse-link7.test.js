'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseLinhasLink7, acharAbaEq } = require('../tools/semanal/atualizar-equipes-online.js');
const { diaEpoch } = require('../tools/semanal/compute-semanal.js');

function linhaLink7Cru(over = {}) {
  return Object.assign({
    'Ordem de Serviço (OS)': '16744-25',
    Tipo: 'SP',
    'Contrato Financeiro': 'SUP-7722-24',
    'Data / Hora Primeira Foto': '08/08/2026 07:54',
    'ID Sondador': '3275',
    Líder: 'Evamar Fernandes de Macedo',
  }, over);
}

// Link por NOME (Líder), não por ID Sondador -- achado rodando o pipeline de
// verdade em 2026-08-08: o "ID" do roster do Link 6 é ID de EQUIPE, e "ID
// Sondador" do Link 7 é ID de PESSOA -- sistemas diferentes, sem interseção
// real (medido: 1 em 105 IDs). Ver comentário em compute-equipes-fracao.js.
test('extrai lider, sup, tipo e diaEpoch da data/hora da primeira foto', () => {
  const [linha] = parseLinhasLink7([linhaLink7Cru()]);
  assert.strictEqual(linha.lider, 'Evamar Fernandes de Macedo');
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

test('duas linhas da mesma OS+dia (múltiplas fotos) viram duas entradas -- a deduplicação de combinação acontece em compute-equipes-fracao.js, não aqui', () => {
  const linhas = parseLinhasLink7([linhaLink7Cru(), linhaLink7Cru()]);
  assert.strictEqual(linhas.length, 2);
});

test('acharAbaEq: casa mês abreviado (ex.: "2026 - OUT (EQ)")', () => {
  const nomes = ['CRONOGRAMAS', '2026 - SET (EQ)', '2026 - OUT (EQ)', '2026 - NOV (EQ)'];
  assert.strictEqual(acharAbaEq(nomes, 2026, 9), '2026 - OUT (EQ)'); // outubro = índice 9
});

test('acharAbaEq: casa mês completo (ex.: "2026 - AGOSTO (EQ)")', () => {
  const nomes = ['CRONOGRAMAS', '2026 - AGOSTO (EQ)', '2026 - SETEMBRO (EQ)'];
  assert.strictEqual(acharAbaEq(nomes, 2026, 7), '2026 - AGOSTO (EQ)'); // agosto = índice 7
});

test('acharAbaEq: NÃO casa "(EQ e SUP.)" nem "(EQP)" -- só a aba "(EQ)" exata', () => {
  const nomes = ['2026 - AGOSTO (EQ e SUP.)', '2026 - AGOSTO (EQP)', '2026 - AGOSTO (EQ)'];
  assert.strictEqual(acharAbaEq(nomes, 2026, 7), '2026 - AGOSTO (EQ)');
});

test('acharAbaEq: nenhuma aba encontrada lança erro claro em vez de cair calado numa aba errada', () => {
  const nomes = ['CRONOGRAMAS', '2026 - SETEMBRO (EQ)'];
  assert.throws(() => acharAbaEq(nomes, 2026, 7), /Nenhuma aba "\(EQ\)" encontrada/);
});
