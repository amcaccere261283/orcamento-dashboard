'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  COLUNAS_ALOCACAO, colunasDaEquipe, equipesDoQuadro,
} = require('../tools/semanal/equipes-alocaveis.js');

test('as 6 colunas do quadro, na ordem canônica, com as tipologias da MATRIZ que cada uma cobre', () => {
  assert.deepStrictEqual(COLUNAS_ALOCACAO.map((c) => c.id),
    ['SP', 'SM / SM.F / SR', 'ST', 'PI', 'BL', 'Especiais']);
  const especiais = COLUNAS_ALOCACAO.find((c) => c.id === 'Especiais');
  assert.deepStrictEqual(especiais.tipologias, ['CPTu', 'SH', 'VT']);
  const bl = COLUNAS_ALOCACAO.find((c) => c.id === 'BL');
  assert.deepStrictEqual(bl.tipologias, ['BL'], 'BL é coluna própria, não entra em Especiais');
});

test('serviço simples resolve para uma coluna só', () => {
  assert.deepStrictEqual(colunasDaEquipe('SM'), { colunas: ['SM / SM.F / SR'], motivoFora: null });
  assert.deepStrictEqual(colunasDaEquipe('SP'), { colunas: ['SP'], motivoFora: null });
});

test('CPTu | VT | SH vira a coluna Especiais -- uma só, não três', () => {
  assert.deepStrictEqual(colunasDaEquipe('CPTu | VT | SH'), { colunas: ['Especiais'], motivoFora: null });
});

test('ST | PI | BL e SP/SM são polivalentes: aceitam mais de uma coluna', () => {
  assert.deepStrictEqual(colunasDaEquipe('ST | PI | BL').colunas, ['ST', 'PI', 'BL']);
  assert.deepStrictEqual(colunasDaEquipe('SP/SM').colunas, ['SP', 'SM / SM.F / SR']);
});

test('Lab, TST e SN ficam fora do quadro COM motivo -- nunca somem calados', () => {
  for (const servico of ['Lab', 'TST', 'SN']) {
    const r = colunasDaEquipe(servico);
    assert.deepStrictEqual(r.colunas, []);
    assert.ok(r.motivoFora && r.motivoFora.length > 0, `${servico} precisa de motivo`);
  }
});

test('serviço NOVO não derruba nada: fica fora do quadro com o texto cru no motivo', () => {
  // Diferente de rotularTipologia (tools/comum/tipologias-avancos.js), que
  // LANÇA em rótulo desconhecido. Aqui um texto novo na coluna Serviços não
  // pode matar a página inteira -- mas tem de aparecer.
  const r = colunasDaEquipe('SONDAGEM AQUATICA');
  assert.deepStrictEqual(r.colunas, []);
  assert.match(r.motivoFora, /SONDAGEM AQUATICA/);
});

// --- equipesDoQuadro -------------------------------------------------------

// Cabeçalho REAL da aba EQ (medido em 2026-08-10): ID | Equipe | Habilitação |
// Serviços | Líderes | Veículo | Proprietário | Equipamento x5 | Tenda |
// Tomador | sinalização 3P | <dias>. A linha 1 é sub-cabeçalho.
const CSV_EQ = [
  'ID,Equipe,Habilitação,Serviços,Líderes,Veículo,Proprietário,Equipamento,Equipamento,Equipamento,Equipamento,Equipamento,Tenda - nova estrutura,Tomador,sinalização 3P,10/08/2026,11/08/2026,12/08/2026,13/08/2026,14/08/2026',
  ',,do condutor,-,-,-,-,Kit Especiais,Kit BL e PI,Kit ST,Kit SP,Kit SR,Nova estrutura,-,,SEGUNDA,TERÇA,QUARTA,QUINTA,SEXTA',
  '4,José I. Amaral,D,SM,Amaral,SUH-6F44 (D9p),Suporte,N/A,N/A,N/A,Próprio,Próprio,,CCR RioSP,RioSP,RioSP (16925-25),OK,OK,OK,OK',
  '59,Paulo S. Lima,D,SP,Paulo S.,EYX 4G65,Suporte,N/A,N/A,Hilf-019,Próprio,Próprio,,Quadrante,OK,Férias,Férias,Férias,Férias,Férias',
  '88,Edy I. Gomes,D,ST | PI | BL,Edy I.,ABC 1234,Próprio,N/A,Kit,N/A,N/A,N/A,,Sorocabana,,Baixada,Baixada,Sorocabana (17746-26),OK,OK',
  '200,Ana L. Souza,D,Lab,Ana L.,-,-,N/A,N/A,N/A,N/A,N/A,,-,,OK,OK,OK,OK,OK',
].join('\n');

const SEMANA = { inicio: diaEpochDe(2026, 8, 10), fim: diaEpochDe(2026, 8, 16) };
function diaEpochDe(ano, mes, dia) { return Math.floor(Date.UTC(ano, mes - 1, dia) / 86400000); }

const OS_PARA_SUP = { '16925-25': 'SUP-7128-24', '17746-26': 'SUP-7133-24' };

test('equipesDoQuadro monta as equipes com colunas, disponibilidade e popup', () => {
  const { equipes } = equipesDoQuadro(CSV_EQ, {
    ano: 2026, mes: 8, semana: SEMANA, osParaSup: OS_PARA_SUP,
  });
  const porId = Object.fromEntries(equipes.map((e) => [e.id, e]));

  assert.strictEqual(porId['4'].lider, 'Amaral', 'o rótulo do cartão é a coluna Líderes (curta), não Equipe');
  assert.deepStrictEqual(porId['4'].colunas, ['SM / SM.F / SR']);
  assert.strictEqual(porId['4'].polivalente, false);
  assert.strictEqual(porId['4'].disponivel, true);
  assert.strictEqual(porId['4'].diasDisponiveis, 5, 'os 5 dias da semana estão ativos');
  assert.strictEqual(porId['4'].popup.veiculo, 'SUH-6F44 (D9p)');
  assert.strictEqual(porId['4'].popup.proprietario, 'Suporte');
  assert.strictEqual(porId['4'].popup.tomador, 'CCR RioSP');
});

test('equipe de férias a semana inteira não é arrastável', () => {
  const { equipes } = equipesDoQuadro(CSV_EQ, { ano: 2026, mes: 8, semana: SEMANA, osParaSup: OS_PARA_SUP });
  const eq59 = equipes.find((e) => e.id === '59');
  assert.strictEqual(eq59.diasDisponiveis, 0);
  assert.strictEqual(eq59.disponivel, false);
});

test('disponibilidade PARCIAL conta só os dias em campo', () => {
  // Equipe 88: 2 dias Baixada + 3 dias em campo.
  const { equipes } = equipesDoQuadro(CSV_EQ, { ano: 2026, mes: 8, semana: SEMANA, osParaSup: OS_PARA_SUP });
  const eq88 = equipes.find((e) => e.id === '88');
  assert.strictEqual(eq88.diasDisponiveis, 3);
  assert.strictEqual(eq88.disponivel, true);
  assert.strictEqual(eq88.polivalente, true);
});

test('supRealizado sai da ÚLTIMA OS vista, e o dia ativo sem OS herda a anterior', () => {
  const { equipes } = equipesDoQuadro(CSV_EQ, { ano: 2026, mes: 8, semana: SEMANA, osParaSup: OS_PARA_SUP });
  const porId = Object.fromEntries(equipes.map((e) => [e.id, e]));
  // Equipe 4: OS só na segunda, OK nos outros 4 dias -- o vínculo não se rompe.
  assert.strictEqual(porId['4'].supRealizado, 'SUP-7128-24');
  assert.strictEqual(porId['4'].colunaRealizada, 'SM / SM.F / SR');
  // Equipe 88: OS na quarta -- polivalente, cai numa das colunas dela.
  assert.strictEqual(porId['88'].supRealizado, 'SUP-7133-24');
  assert.ok(porId['88'].colunas.indexOf(porId['88'].colunaRealizada) !== -1);
});

test('equipe sem OS nenhuma nasce no pool -- supRealizado null, nunca chutado', () => {
  const csv = CSV_EQ.split('\n').filter((l) => !l.startsWith('4,') && !l.startsWith('88,')).join('\n');
  const { equipes } = equipesDoQuadro(csv, { ano: 2026, mes: 8, semana: SEMANA, osParaSup: OS_PARA_SUP });
  const eq59 = equipes.find((e) => e.id === '59');
  assert.strictEqual(eq59.supRealizado, null);
  assert.strictEqual(eq59.colunaRealizada, null);
});

test('Lab sai do quadro e aparece em foraDoQuadro com o motivo', () => {
  const { equipes, foraDoQuadro } = equipesDoQuadro(CSV_EQ, {
    ano: 2026, mes: 8, semana: SEMANA, osParaSup: OS_PARA_SUP,
  });
  assert.strictEqual(equipes.find((e) => e.id === '200'), undefined);
  const fora = foraDoQuadro.find((e) => e.id === '200');
  assert.ok(fora, 'a equipe de Lab tem de aparecer na lista de fora');
  assert.match(fora.motivo, /[Ll]aborat/);
});

// --- grupos de veículo ------------------------------------------------------

// Mesmo cabeçalho do CSV_EQ acima. A 4 tem placa; a 91 caroneia nela; a 92 tem
// 'Próprio'; a 93 é Lab (fora do quadro) e a 94 caroneia NA 93 -- a ponte por
// equipe não alocável.
const CSV_EQ_VEICULO = [
  'ID,Equipe,Habilitação,Serviços,Líderes,Veículo,Proprietário,Equipamento,Equipamento,Equipamento,Equipamento,Equipamento,Tenda - nova estrutura,Tomador,sinalização 3P,10/08/2026,11/08/2026,12/08/2026,13/08/2026,14/08/2026',
  ',,do condutor,-,-,-,-,Kit Especiais,Kit BL e PI,Kit ST,Kit SP,Kit SR,Nova estrutura,-,,SEGUNDA,TERÇA,QUARTA,QUINTA,SEXTA',
  '4,José I. Amaral,D,SM,Amaral,SUH-6F44 (D9p),Suporte,N/A,N/A,N/A,Próprio,Próprio,,CCR RioSP,RioSP,OK,OK,OK,OK,OK',
  '91,Carona Um,D,SM,Um,Carona ID 4,Suporte,N/A,N/A,N/A,N/A,N/A,,-,,OK,OK,OK,OK,OK',
  '92,Sozinha,D,SP,Sozinha,Próprio,Suporte,N/A,N/A,N/A,N/A,N/A,,-,,OK,OK,OK,OK,OK',
  '93,Lab Ponte,D,Lab,Ponte,TKF3E96 (D9p),Suporte,N/A,N/A,N/A,N/A,N/A,,-,,OK,OK,OK,OK,OK',
  '94,Carona Lab,D,SP,Lab Dois,carona ID 93,Suporte,N/A,N/A,N/A,N/A,N/A,,-,,OK,OK,OK,OK,OK',
].join('\n');

const OPCOES_VEICULO = {
  ano: 2026, mes: 8, semana: { inicio: 20675, fim: 20679 }, osParaSup: {},
};

test('equipe com carona ganha companheiros, rótulo do grupo e chave', () => {
  const { equipes } = equipesDoQuadro(CSV_EQ_VEICULO, OPCOES_VEICULO);
  const quatro = equipes.find((e) => e.id === '4');
  const noventaEUm = equipes.find((e) => e.id === '91');
  assert.deepStrictEqual(quatro.companheiros, ['91']);
  assert.deepStrictEqual(noventaEUm.companheiros, ['4']);
  assert.strictEqual(quatro.veiculoGrupo, noventaEUm.veiculoGrupo);
  assert.strictEqual(quatro.veiculoRotulo, 'SUH6F44');
});

test('equipe "Próprio" fica sem companheiros', () => {
  const { equipes } = equipesDoQuadro(CSV_EQ_VEICULO, OPCOES_VEICULO);
  assert.deepStrictEqual(equipes.find((e) => e.id === '92').companheiros, []);
});

test('a equipe FORA DO QUADRO serve de ponte mas não aparece em companheiros', () => {
  // A 94 caroneia na 93 (Lab). O veículo é o mesmo, então o grupo existe -- mas
  // a 93 não é alocável e não pode virar cartão arrastável nenhum.
  const { equipes } = equipesDoQuadro(CSV_EQ_VEICULO, OPCOES_VEICULO);
  const noventaEQuatro = equipes.find((e) => e.id === '94');
  assert.ok(noventaEQuatro, '94 é SP, tem de estar no quadro');
  assert.deepStrictEqual(noventaEQuatro.companheiros, []);
  assert.strictEqual(noventaEQuatro.veiculoRotulo, 'TKF3E96');
});
