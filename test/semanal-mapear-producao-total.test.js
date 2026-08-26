'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mapearProducaoTotal, COLUNAS_LINK1 } = require('../tools/semanal/mapear-producao-total.js');
const { locateColunasAvancos } = require('../tools/semanal/parse-avancos.js');

function linhaLink1(over = {}) {
  return Object.assign({
    Tomador: 'EPR Litoral Pioneiro',
    'ID Contrato': 'SUP-7722-24',
    Sondador: 'Evamar Fernandes de Macedo',
    Tipo: 'SP',
    OS: '16744-25',
    'Criação da OS': '18/09/2025',
    Identificação: 'ELP-SP-PR092-A-5-1067',
    Obra: 'Projetos do Ano 05',
    'Observações de campo': '',
    Deslocamento: 'Não',
    'Executado Dia': '01/08/2026',
    'Tags de Serviço': 'SP.Instal (1)',
    'Status Atual': 'EXECUTADO',
    'Data Status Atual': '01/08/2026',
  }, over);
}

test('o cabeçalho de saída é exatamente o que parseAvancos exige, sem lançar', () => {
  const { header } = mapearProducaoTotal([linhaLink1()]);
  assert.doesNotThrow(() => locateColunasAvancos(header));
});

test('Contrato, Tipo, OS, Sondador e Status vêm direto das colunas homônimas do Link 1', () => {
  const { header, rows } = mapearProducaoTotal([linhaLink1()]);
  const cols = locateColunasAvancos(header);
  assert.strictEqual(rows[0][cols.sup], 'SUP-7722-24');
  assert.strictEqual(rows[0][cols.tipo], 'SP');
  assert.strictEqual(rows[0][cols.os], '16744-25');
  assert.strictEqual(rows[0][cols.sondador], 'Evamar Fernandes de Macedo');
  assert.strictEqual(rows[0][cols.status], 'EXECUTADO');
});

// 2026-08-10: o Link 1 tem UMA data de execução, e ela sai numa coluna só,
// com o nome do link. A versão anterior deste mapeador gravava o mesmo
// "Executado Dia" também numa coluna "Inicio Sondagem" -- que o Link 1 não
// tem. O dono do projeto confirmou que é o mesmo campo, e a regra "não
// alterar nenhuma informação que venha dos links" mandou tirar a duplicata.
test('Executado Dia sai numa coluna só, com o nome do link -- não existe mais "Inicio Sondagem" fabricada', () => {
  const { header, rows } = mapearProducaoTotal([linhaLink1()]);
  const cols = locateColunasAvancos(header);
  assert.strictEqual(rows[0][cols.executadoDia], '01/08/2026');
  assert.ok(!header.includes('Inicio Sondagem'), 'o cabeçalho não pode reintroduzir a coluna inventada');
  assert.ok(!header.includes('Termino Sondagem'), 'nem o par dela');
});

test('a coluna Deslocamento do Link 1 é carregada para a saída, sem transformação', () => {
  const { header, rows } = mapearProducaoTotal([linhaLink1({ Deslocamento: 'Sim' })]);
  const cols = locateColunasAvancos(header);
  assert.strictEqual(rows[0][cols.deslocamento], 'Sim');
});

test('Criação da OS alimenta Criação da OS sem transformação', () => {
  const { header, rows } = mapearProducaoTotal([linhaLink1()]);
  const cols = locateColunasAvancos(header);
  assert.strictEqual(rows[0][cols.criacaoOS], '18/09/2025');
});

// 2026-08-10: Cancelamento/Conclusão/Atualizado deixaram de ser fabricadas
// como colunas vazias. O Link 1 não tem essas datas, e inventar coluna vazia
// é o mesmo vício de inventar coluna duplicada -- quem consome descobre a
// ausência pelo campo null que parse-avancos.js entrega.
test('Cancelamento, Conclusão e Atualizado não são fabricadas -- o Link 1 não tem essas datas', () => {
  const { header } = mapearProducaoTotal([linhaLink1()]);
  assert.ok(!header.includes('Cancelamento'));
  assert.ok(!header.includes('Conclusão'));
  assert.ok(!header.includes('Atualizado'));
});

test('Observações de campo do Link 1 vira Observações de Campo -- continua carregada, agora só como informação', () => {
  const { header, rows } = mapearProducaoTotal([linhaLink1({ 'Observações de campo': 'Deslocamento A' })]);
  const cols = locateColunasAvancos(header);
  assert.strictEqual(rows[0][cols.observacoesCampo], 'Deslocamento A');
});

test('linha sem ID Contrato ainda gera uma linha (parseAvancos decide o que descartar, este mapeador não filtra)', () => {
  const { rows } = mapearProducaoTotal([linhaLink1({ 'ID Contrato': '' })]);
  assert.strictEqual(rows.length, 1);
});

test('múltiplas linhas mantêm a ordem', () => {
  const { rows } = mapearProducaoTotal([linhaLink1({ OS: '1' }), linhaLink1({ OS: '2' })]);
  const cols = locateColunasAvancos(mapearProducaoTotal([linhaLink1()]).header);
  assert.strictEqual(rows[0][cols.os], '1');
  assert.strictEqual(rows[1][cols.os], '2');
});

// Exclusão de Tomador/SEG-SN (achado da revisão final de branch, 2026-08-08):
// a spec exige a mesma regra que mapear-demandas-lab.js já implementa,
// também pro Link 1 (Realizado).
test('linha com Tomador "Suporte Sondagens - Filial Lapa" é excluída, não entra em rows', () => {
  const { rows, excluidos } = mapearProducaoTotal([linhaLink1({ Tomador: 'Suporte Sondagens - Filial Lapa' })]);
  assert.strictEqual(rows.length, 0);
  assert.strictEqual(excluidos, 1);
});

test('linha com Tipo contendo SEG (ex.: "SEG.A") é excluída', () => {
  const { rows, excluidos } = mapearProducaoTotal([linhaLink1({ Tipo: 'SEG.A' })]);
  assert.strictEqual(rows.length, 0);
  assert.strictEqual(excluidos, 1);
});

test('linha com Tipo "SN" é excluída', () => {
  const { rows, excluidos } = mapearProducaoTotal([linhaLink1({ Tipo: 'SN' })]);
  assert.strictEqual(rows.length, 0);
  assert.strictEqual(excluidos, 1);
});

test('exclusão de Tipo é case-insensitive', () => {
  const { rows, excluidos } = mapearProducaoTotal([linhaLink1({ Tipo: 'seg.v' })]);
  assert.strictEqual(rows.length, 0);
  assert.strictEqual(excluidos, 1);
});

test('linhas normais (sem Tomador excluído nem Tipo SEG/SN) continuam entrando, contadas fora de excluidos', () => {
  const { rows, excluidos } = mapearProducaoTotal([linhaLink1(), linhaLink1({ Tomador: 'Suporte Sondagens - Filial Lapa' })]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(excluidos, 1);
});

// O Link 1 (produção/realizado) NÃO traz coordenadas na fonte -- só o Link 2
// (furos pendentes) tem. As duas colunas existem no HEADER_SAIDA compartilhado
// e saem SEMPRE vazias por aqui. Trava o contrato: se um dia alguém preencher
// isto sem que a fonte tenha o dado, é invenção de coordenada.
test('Latitude/Longitude saem sempre vazias no Link 1 -- a fonte de produção não tem coordenada', () => {
  const { mapearProducaoTotal, HEADER_SAIDA } = require('../tools/semanal/mapear-producao-total.js');
  const colLat = HEADER_SAIDA.indexOf('Latitude');
  const colLon = HEADER_SAIDA.indexOf('Longitude');
  assert.notStrictEqual(colLat, -1);
  assert.notStrictEqual(colLon, -1);
  assert.strictEqual(HEADER_SAIDA.length, 12, 'Latitude/Longitude entram no FIM, sem deslocar as 10 originais');

  const linha = { Tipo: 'SP', 'ID Contrato': 'SUP-A', 'Criação da OS': '', 'Status Atual': '', 'Executado Dia': '', Deslocamento: '', 'Total (m)': '', 'Observações de campo': '', OS: '1', Sondador: '' };
  const { rows } = mapearProducaoTotal([linha]);
  assert.strictEqual(rows[0][colLat], '');
  assert.strictEqual(rows[0][colLon], '');
  assert.strictEqual(rows[0].length, HEADER_SAIDA.length, 'a linha tem que ter exatamente uma célula por coluna do header');
});
