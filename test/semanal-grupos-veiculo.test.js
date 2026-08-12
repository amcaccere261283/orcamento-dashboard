'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalizarVeiculo, agruparPorVeiculo } = require('../tools/semanal/grupos-veiculo.js');

// Todos os casos abaixo são TEXTO REAL medido na aba EQ em 2026-08-12
// (117 equipes) -- ver a seção "Medição da fonte" do spec.

test('placa é reconhecida e normalizada: o descritivo entre parênteses e a caixa não contam', () => {
  assert.deepStrictEqual(normalizarVeiculo('UDU8J88 (D, 9p)'), { tipo: 'placa', chave: 'UDU8J88' });
  assert.deepStrictEqual(normalizarVeiculo('UDU8J88 (D, 9 p)'), { tipo: 'placa', chave: 'UDU8J88' });
  assert.deepStrictEqual(normalizarVeiculo('UFW3J85 (b, 2p)'), { tipo: 'placa', chave: 'UFW3J85' });
  // Placa antiga, com hífen e com espaço.
  assert.deepStrictEqual(normalizarVeiculo('SUH-6F44 (D, Munck, 2p)'), { tipo: 'placa', chave: 'SUH6F44' });
  assert.deepStrictEqual(normalizarVeiculo('EYX 4G65 (D, 9p)'), { tipo: 'placa', chave: 'EYX4G65' });
});

test('carona é reconhecida em qualquer caixa e com espaço sobrando', () => {
  assert.deepStrictEqual(normalizarVeiculo('Carona ID 171'), { tipo: 'carona', chave: '171' });
  assert.deepStrictEqual(normalizarVeiculo('carona ID 463'), { tipo: 'carona', chave: '463' });
  assert.deepStrictEqual(normalizarVeiculo('Carona  ID 477'), { tipo: 'carona', chave: '477' });
});

test('LISTA DE PERMISSÃO: todo o resto é "nenhum" -- Próprio, vazio e texto solto nunca vinculam', () => {
  // O inverso (agrupar tudo, com lista negra) prenderia duas equipes uma na
  // outra no dia em que alguém digitasse uma palavra nova. Ver Decisão 1.
  for (const texto of ['Próprio', 'próprio', 'PRÓPRIO', '', '   ', '-', 'afastado', 'D?', 'Suporte', null, undefined]) {
    assert.deepStrictEqual(normalizarVeiculo(texto), { tipo: 'nenhum', chave: null },
      'não pode vincular: ' + JSON.stringify(texto));
  }
});

test('cadeia de quatro vira UM grupo: três caronas apontando para a equipe da placa', () => {
  const r = agruparPorVeiculo([
    { id: '644', veiculo: 'carona ID 660' },
    { id: '651', veiculo: 'carona ID 660' },
    { id: '656', veiculo: 'Carona ID 660' },
    { id: '660', veiculo: 'ELE-8E91 (9 p)' },
  ]);
  const chave = r.grupoPorId['644'];
  assert.deepStrictEqual(r.membrosDoGrupo[chave], ['644', '651', '656', '660']);
  assert.strictEqual(r.grupoPorId['660'], chave);
  assert.strictEqual(r.rotuloDoGrupo[chave], 'ELE8E91');
});

test('placas iguais com pontuação diferente agrupam -- 3 grupos reais dependem disso', () => {
  const r = agruparPorVeiculo([
    { id: '479', veiculo: 'UDU8J88 (D, 9p)' },
    { id: '623', veiculo: 'UDU8J88 (D, 9 p)' },
  ]);
  assert.strictEqual(r.grupoPorId['479'], r.grupoPorId['623']);
  assert.deepStrictEqual(r.membrosDoGrupo[r.grupoPorId['479']], ['479', '623']);
});

test('16 equipes "Próprio" ficam SOLTEIRAS, e vazio não agrupa com vazio', () => {
  const r = agruparPorVeiculo([
    { id: '164', veiculo: 'Próprio' },
    { id: '223', veiculo: 'Próprio' },
    { id: '286', veiculo: 'próprio' },
    { id: '322', veiculo: '' },
    { id: '605', veiculo: '' },
  ]);
  const chaves = new Set(['164', '223', '286', '322', '605'].map((id) => r.grupoPorId[id]));
  assert.strictEqual(chaves.size, 5, 'cada uma no seu próprio grupo');
  ['164', '223', '286', '322', '605'].forEach((id) => {
    assert.deepStrictEqual(r.membrosDoGrupo[r.grupoPorId[id]], [id]);
  });
});

test('carona órfã (alvo fora do roster) fica solteira -- Carona ID 10 e Carona ID 477 existem de verdade', () => {
  const r = agruparPorVeiculo([
    { id: '366', veiculo: 'Carona ID 10' },
    { id: '478', veiculo: 'Carona  ID 477' },
  ]);
  assert.notStrictEqual(r.grupoPorId['366'], r.grupoPorId['478']);
  assert.deepStrictEqual(r.membrosDoGrupo[r.grupoPorId['366']], ['366']);
});

test('grupo SEM nenhuma placa é rotulado pela carona -- caso real {322, 635, 666}', () => {
  const r = agruparPorVeiculo([
    { id: '322', veiculo: '' },
    { id: '635', veiculo: 'Carona ID 322' },
    { id: '666', veiculo: 'Carona ID 322' },
  ]);
  const chave = r.grupoPorId['635'];
  assert.deepStrictEqual(r.membrosDoGrupo[chave], ['322', '635', '666']);
  assert.strictEqual(r.rotuloDoGrupo[chave], 'Carona ID 322');
});

test('ciclo de caronas não entra em laço infinito', () => {
  const r = agruparPorVeiculo([
    { id: '10', veiculo: 'Carona ID 20' },
    { id: '20', veiculo: 'Carona ID 10' },
  ]);
  assert.strictEqual(r.grupoPorId['10'], r.grupoPorId['20']);
});

test('carona apontando para si mesma não quebra nem cria grupo', () => {
  const r = agruparPorVeiculo([{ id: '660', veiculo: 'Carona ID 660' }]);
  assert.deepStrictEqual(r.membrosDoGrupo[r.grupoPorId['660']], ['660']);
});

test('membros saem em ordem numérica estável, não na ordem do CSV', () => {
  const r = agruparPorVeiculo([
    { id: '660', veiculo: 'ELE-8E91 (9 p)' },
    { id: '44', veiculo: 'carona ID 660' },
    { id: '651', veiculo: 'carona ID 660' },
  ]);
  assert.deepStrictEqual(r.membrosDoGrupo[r.grupoPorId['660']], ['44', '651', '660']);
});

// --- destinoDoGrupo ---------------------------------------------------------

const { destinoDoGrupo, conflitosDeVeiculo } = require('../tools/semanal/grupos-veiculo.js');

// Grupo de três (A, B, C) mais uma equipe solteira (Z). B é polivalente
// (ST | PI | BL), C só serve SP, e D é do grupo mas está INDISPONÍVEL.
function equipesDeTeste() {
  return [
    { id: 'A', colunas: ['SP'], disponivel: true, companheiros: ['B', 'C', 'D'] },
    { id: 'B', colunas: ['ST', 'PI', 'BL'], disponivel: true, companheiros: ['A', 'C', 'D'] },
    { id: 'C', colunas: ['SP'], disponivel: true, companheiros: ['A', 'B', 'D'] },
    { id: 'D', colunas: ['SP'], disponivel: false, companheiros: ['A', 'B', 'C'] },
    { id: 'Z', colunas: ['SP'], disponivel: true, companheiros: [] },
  ];
}

test('companheira alocada em OUTRO SUP vem junto', () => {
  const alocacao = { A: { sup: 'SUP-1', coluna: 'SP' }, C: { sup: 'SUP-2', coluna: 'SP' } };
  const movs = destinoDoGrupo(equipesDeTeste(), alocacao, 'A', 'SUP-3', 'SP');
  assert.deepStrictEqual(movs.find((m) => m.id === 'C'), { id: 'C', sup: 'SUP-3', coluna: 'SP' });
});

test('companheira NO POOL vem junto -- pool é destino igual ao SUP', () => {
  const movs = destinoDoGrupo(equipesDeTeste(), {}, 'A', 'SUP-1', 'SP');
  assert.deepStrictEqual(movs.map((m) => m.id).sort(), ['A', 'B', 'C']);
});

test('companheira INDISPONÍVEL nunca é tocada, nem no pool nem no quadro', () => {
  const alocacao = { D: { sup: 'SUP-9', coluna: 'SP' } };
  const movs = destinoDoGrupo(equipesDeTeste(), alocacao, 'A', 'SUP-1', 'SP');
  assert.ok(!movs.some((m) => m.id === 'D'), 'D está indisponível: fica onde está');
});

test('companheira JÁ no SUP de destino não gera movimento redundante', () => {
  const alocacao = { C: { sup: 'SUP-1', coluna: 'SP' } };
  const movs = destinoDoGrupo(equipesDeTeste(), alocacao, 'A', 'SUP-1', 'SP');
  assert.ok(!movs.some((m) => m.id === 'C'));
});

test('a coluna da companheira é PRESERVADA quando ela serve a mesma no destino', () => {
  const alocacao = { B: { sup: 'SUP-2', coluna: 'PI' } };
  const movs = destinoDoGrupo(equipesDeTeste(), alocacao, 'A', 'SUP-1', 'SP');
  assert.deepStrictEqual(movs.find((m) => m.id === 'B'), { id: 'B', sup: 'SUP-1', coluna: 'PI' });
});

test('companheira que não serve a coluna do gesto cai na primeira que ela serve', () => {
  // B não serve SP; do pool, sem coluna anterior, vai para ST (primeira dela).
  const movs = destinoDoGrupo(equipesDeTeste(), {}, 'A', 'SUP-1', 'SP');
  assert.deepStrictEqual(movs.find((m) => m.id === 'B'), { id: 'B', sup: 'SUP-1', coluna: 'ST' });
});

test('companheira do pool que SERVE a coluna do gesto cai nela', () => {
  const movs = destinoDoGrupo(equipesDeTeste(), {}, 'A', 'SUP-1', 'SP');
  assert.deepStrictEqual(movs.find((m) => m.id === 'C'), { id: 'C', sup: 'SUP-1', coluna: 'SP' });
});

test('soltar no POOL devolve o grupo inteiro -- e só quem estava no quadro', () => {
  const alocacao = { A: { sup: 'SUP-1', coluna: 'SP' }, C: { sup: 'SUP-1', coluna: 'SP' } };
  const movs = destinoDoGrupo(equipesDeTeste(), alocacao, 'A', '', '');
  assert.deepStrictEqual(movs.map((m) => m.id).sort(), ['A', 'C']);
  movs.forEach((m) => assert.strictEqual(m.sup, ''));
});

test('gesto RECUSADO não move ninguém: coluna fora do conjunto da equipe arrastada', () => {
  assert.deepStrictEqual(destinoDoGrupo(equipesDeTeste(), {}, 'A', 'SUP-1', 'ST'), []);
});

test('gesto RECUSADO não move ninguém: equipe arrastada indisponível', () => {
  assert.deepStrictEqual(destinoDoGrupo(equipesDeTeste(), {}, 'D', 'SUP-1', 'SP'), []);
});

test('equipe desconhecida devolve lista vazia', () => {
  assert.deepStrictEqual(destinoDoGrupo(equipesDeTeste(), {}, 'NAO-EXISTE', 'SUP-1', 'SP'), []);
});

test('equipe sem companheiras move só ela', () => {
  const movs = destinoDoGrupo(equipesDeTeste(), {}, 'Z', 'SUP-1', 'SP');
  assert.deepStrictEqual(movs, [{ id: 'Z', sup: 'SUP-1', coluna: 'SP' }]);
});

// --- conflitosDeVeiculo -----------------------------------------------------

test('conflito é grupo espalhado em 2+ SUPs, apontando quem está onde', () => {
  const alocacao = { A: { sup: 'SUP-1', coluna: 'SP' }, C: { sup: 'SUP-2', coluna: 'SP' } };
  const conflitos = conflitosDeVeiculo(equipesDeTeste(), alocacao);
  assert.deepStrictEqual(conflitos.A, [{ id: 'C', sup: 'SUP-2' }]);
  assert.deepStrictEqual(conflitos.C, [{ id: 'A', sup: 'SUP-1' }]);
});

test('grupo inteiro no MESMO SUP não é conflito, e equipe no pool nunca é conflito', () => {
  const alocacao = { A: { sup: 'SUP-1', coluna: 'SP' }, C: { sup: 'SUP-1', coluna: 'SP' } };
  assert.deepStrictEqual(conflitosDeVeiculo(equipesDeTeste(), alocacao), {});
  // B está no pool enquanto A está alocada: pool não é SUP.
  assert.deepStrictEqual(conflitosDeVeiculo(equipesDeTeste(), { A: { sup: 'SUP-1', coluna: 'SP' } }), {});
});
