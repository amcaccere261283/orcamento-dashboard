'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { agregarEquipesProdutivas } = require('../tools/semanal/compute-equipes-produtivas.js');

// Linhas modeladas a partir da tabela real de campo/fotos (capturada ao
// vivo em 2026-08-05) -- só os campos que a função lê.
const LINHAS_FIXTURE = [
  { 'Contrato Financeiro': 'SUP-7722-24', Data: '01/08/2026', Sondador: 'Evamar Fernandes de Macedo' },
  { 'Contrato Financeiro': 'SUP-7722-24', Data: '01/08/2026', Sondador: 'Evamar Fernandes de Macedo' }, // 2ª foto, mesmo dia/sondador -- não duplica
  { 'Contrato Financeiro': 'SUP-7722-24', Data: '01/08/2026', Sondador: 'Filipe Cosme Araujo Cunha' },
  { 'Contrato Financeiro': 'SUP-7722-24', Data: '02/08/2026', Sondador: 'Evamar Fernandes de Macedo' },
];

const TIPOLOGIA_POR_SONDADOR = {
  'Evamar Fernandes de Macedo': 'SP',
  'Filipe Cosme Araujo Cunha': 'SP',
};

test('agregarEquipesProdutivas conta Sondador distinto por dia e por (SUP, tipologia)', () => {
  const { porDia, semTipologia } = agregarEquipesProdutivas({
    linhas: LINHAS_FIXTURE,
    tipologiaPorSondador: TIPOLOGIA_POR_SONDADOR,
  });
  const chave = 'SUP-7722-24||SP';
  assert.ok(porDia[chave], 'chave SUP-7722-24||SP deveria existir');
  // 01/08/2026 -> dia-desde-epoca
  const dia1 = Math.floor(Date.UTC(2026, 7, 1) / 86400000);
  const dia2 = Math.floor(Date.UTC(2026, 7, 2) / 86400000);
  assert.equal(porDia[chave][dia1], 2, '01/08: Evamar + Filipe, sem duplicar Evamar (2 fotos)');
  assert.equal(porDia[chave][dia2], 1, '02/08: só Evamar');
  assert.equal(semTipologia, 0);
});

test('agregarEquipesProdutivas conta em semTipologia quando o sondador não tem tipologia conhecida', () => {
  const { porDia, semTipologia } = agregarEquipesProdutivas({
    linhas: [{ 'Contrato Financeiro': 'SUP-1', Data: '01/08/2026', Sondador: 'Alguem Desconhecido' }],
    tipologiaPorSondador: {},
  });
  assert.deepEqual(porDia, {});
  assert.equal(semTipologia, 1);
});

test('agregarEquipesProdutivas ignora linhas sem contrato, sem data ou sem sondador', () => {
  const { porDia, semTipologia } = agregarEquipesProdutivas({
    linhas: [
      { 'Contrato Financeiro': '', Data: '01/08/2026', Sondador: 'Alguem' },
      { 'Contrato Financeiro': 'SUP-1', Data: '', Sondador: 'Alguem' },
      { 'Contrato Financeiro': 'SUP-1', Data: '01/08/2026', Sondador: '' },
    ],
    tipologiaPorSondador: { Alguem: 'SP' },
  });
  assert.deepEqual(porDia, {});
  assert.equal(semTipologia, 0);
});

// --- semTipologia conta EQUIPE-DIA, não FOTO (correção de 2026-08-05) -------
// A tabela de campo/fotos tem uma linha por FOTO (~1.900/dia). Contar linhas
// fazia o log do build imprimir um número de 5 dígitos numa frase que diz
// "equipe-dia sem tipologia conhecida" -- que se lê como perda catastrófica de
// dado na primeira execução real, sendo só artefato da contagem de fotos.
test('agregarEquipesProdutivas deduplica semTipologia por (sondador, dia) -- 3 fotos do mesmo sondador no mesmo dia contam 1', () => {
  const { porDia, semTipologia } = agregarEquipesProdutivas({
    linhas: [
      { 'Contrato Financeiro': 'SUP-1', Data: '01/08/2026', Sondador: 'Alguem Desconhecido' },
      { 'Contrato Financeiro': 'SUP-1', Data: '01/08/2026', Sondador: 'Alguem Desconhecido' },
      { 'Contrato Financeiro': 'SUP-2', Data: '01/08/2026', Sondador: 'Alguem Desconhecido' },
    ],
    tipologiaPorSondador: {},
  });
  assert.deepEqual(porDia, {});
  assert.equal(semTipologia, 1, '3 fotos, 1 sondador, 1 dia -> 1 equipe-dia sem tipologia (era 3 antes da correção)');
});

test('agregarEquipesProdutivas conta semTipologia por dia distinto e por sondador distinto', () => {
  const { semTipologia } = agregarEquipesProdutivas({
    linhas: [
      { 'Contrato Financeiro': 'SUP-1', Data: '01/08/2026', Sondador: 'Fulano' },
      { 'Contrato Financeiro': 'SUP-1', Data: '02/08/2026', Sondador: 'Fulano' },  // outro dia
      { 'Contrato Financeiro': 'SUP-1', Data: '01/08/2026', Sondador: 'Beltrano' }, // outro sondador
    ],
    tipologiaPorSondador: {},
  });
  assert.equal(semTipologia, 3);
});

// --- resolverSup: par desconhecido vai pra "Diversos" (Fix 4, 2026-08-05) ---
// Produtivas é a fonte PRIMÁRIA do Δ equipes. Sem redirecionar, todo contrato
// que a MATRIZ não conhece sumia do número principal em silêncio -- enquanto
// furos e ensaios (as fontes de reserva) já passavam por
// redirecionarSupsDesconhecidos.
test('agregarEquipesProdutivas manda par (contrato, tipologia) desconhecido pro SUP que resolverSup devolver', () => {
  const conhecidos = new Set(['SUP-CONHECIDO||SP']);
  const resolverSup = (contrato, tipologia) => (conhecidos.has(contrato + '||' + tipologia) ? contrato : 'Diversos');
  const { porDia, redirecionados } = agregarEquipesProdutivas({
    linhas: [
      { 'Contrato Financeiro': 'SUP-CONHECIDO', Data: '01/08/2026', Sondador: 'Fulano' },
      { 'Contrato Financeiro': 'SUP-FORA-DA-MATRIZ', Data: '01/08/2026', Sondador: 'Beltrano' },
    ],
    tipologiaPorSondador: { Fulano: 'SP', Beltrano: 'SP' },
    resolverSup,
  });
  const dia1 = Math.floor(Date.UTC(2026, 7, 1) / 86400000);
  assert.equal(porDia['SUP-CONHECIDO||SP'][dia1], 1, 'o par conhecido fica onde está');
  assert.ok(porDia['Diversos||SP'], 'o par desconhecido precisa aparecer em Diversos, nunca desaparecer');
  assert.equal(porDia['Diversos||SP'][dia1], 1);
  assert.equal(redirecionados, 1, 'conta PARES distintos redirecionados, não linhas de foto');
});

// Esta é a razão de o redirecionamento acontecer ANTES do Set de sondadores, e
// não sobre o porDia já agregado: redirecionar depois somaria contagens
// fechadas, e o mesmo sondador em dois contratos desconhecidos no mesmo dia
// viraria 2 equipes. É o mesmo comportamento de compute-equipes-mobilizadas.js,
// que agrega furos JÁ redirecionados.
test('agregarEquipesProdutivas não duplica o sondador que trabalhou em DOIS contratos desconhecidos no mesmo dia', () => {
  const { porDia, redirecionados } = agregarEquipesProdutivas({
    linhas: [
      { 'Contrato Financeiro': 'SUP-FORA-A', Data: '01/08/2026', Sondador: 'Fulano' },
      { 'Contrato Financeiro': 'SUP-FORA-B', Data: '01/08/2026', Sondador: 'Fulano' },
    ],
    tipologiaPorSondador: { Fulano: 'SP' },
    resolverSup: () => 'Diversos',
  });
  const dia1 = Math.floor(Date.UTC(2026, 7, 1) / 86400000);
  assert.equal(
    porDia['Diversos||SP'][dia1], 1,
    'um sondador é UMA equipe naquele dia, mesmo caindo em Diversos por dois contratos diferentes'
  );
  assert.equal(redirecionados, 2, 'dois pares distintos foram redirecionados');
});

test('agregarEquipesProdutivas sem resolverSup mantém o contrato cru (retrocompatível) e não reporta redirecionamento', () => {
  const { porDia, redirecionados } = agregarEquipesProdutivas({
    linhas: [{ 'Contrato Financeiro': 'SUP-QUALQUER', Data: '01/08/2026', Sondador: 'Fulano' }],
    tipologiaPorSondador: { Fulano: 'SP' },
  });
  assert.ok(porDia['SUP-QUALQUER||SP']);
  assert.equal(redirecionados, 0);
});

// --- periodo: qual mês este porDia cobre (Fix 5, 2026-08-05) ----------------
// Alimenta foraDaCoberturaDeEquipes (compute-balanco.js). Sai do PRÓPRIO DADO,
// não de um relógio: o build pode rodar num dia diferente do da busca.
test('agregarEquipesProdutivas devolve o periodo {ano, mes} derivado dos dias contados', () => {
  const { periodo } = agregarEquipesProdutivas({
    linhas: LINHAS_FIXTURE,
    tipologiaPorSondador: TIPOLOGIA_POR_SONDADOR,
  });
  assert.deepEqual(periodo, { ano: 2026, mes: 8 }, 'a fixture é toda de agosto/2026');
});

test('agregarEquipesProdutivas devolve periodo null quando nenhum dia foi contado', () => {
  const { periodo } = agregarEquipesProdutivas({ linhas: [], tipologiaPorSondador: {} });
  assert.equal(periodo, null);
});

// REGRESSÃO (2026-08-06): tipologiaPorSondador já vem ROTULADA (parse-avancos.js
// chama rotularTipologia() ao montar cada furo) -- este módulo usa o valor
// direto, sem traduzir de novo. A versão anterior chamava rotularTipologia()
// aqui dentro, recebendo um rótulo JÁ traduzido como "SM / SM.F / SR" e
// tratando como se fosse cru; rotularTipologia lança em rótulo desconhecido,
// o catch virava null, e o sondador sumia pra semTipologia -- silenciosamente,
// porque a fixture anterior usava "SM" (cru) em vez do valor real que
// tipologiaPorSondador contém. Medido ao vivo em 01/08/2026: 53 sondadores
// produtivos, só 33 sobreviviam à segunda rotulação (a maioria era SM).
test('agregarEquipesProdutivas usa tipologiaPorSondador DIRETO, sem rotular de novo -- rótulos compostos como "SM / SM.F / SR" não podem sumir', () => {
  const { porDia, semTipologia } = agregarEquipesProdutivas({
    linhas: [{ 'Contrato Financeiro': 'SUP-1', Data: '01/08/2026', Sondador: 'Alguem' }],
    tipologiaPorSondador: { Alguem: 'SM / SM.F / SR' },
  });
  const dia1 = Math.floor(Date.UTC(2026, 7, 1) / 86400000);
  assert.equal(porDia['SUP-1||SM / SM.F / SR'][dia1], 1);
  assert.equal(semTipologia, 0);
});

test('agregarEquipesProdutivas: "Especiais" (outro rótulo composto/não-idêntico) também não pode sumir', () => {
  const { porDia, semTipologia } = agregarEquipesProdutivas({
    linhas: [{ 'Contrato Financeiro': 'SUP-1', Data: '01/08/2026', Sondador: 'Alguem' }],
    tipologiaPorSondador: { Alguem: 'Especiais' },
  });
  const dia1 = Math.floor(Date.UTC(2026, 7, 1) / 86400000);
  assert.equal(porDia['SUP-1||Especiais'][dia1], 1);
  assert.equal(semTipologia, 0);
});
