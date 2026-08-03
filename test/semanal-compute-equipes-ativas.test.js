'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  parseAbaEq, tokensDoNome, casarSondador, tipologiaDireta,
} = require('../tools/semanal/compute-equipes-ativas.js');

// --- parseAbaEq ------------------------------------------------------------

const CSV_EQ = [
  ' ,,Habilitação,Serviços,Líderes,Veículo,Proprietário,Equipamento,Equipamento,Equipamento,Equipamento,Equipamento,Tomador,sinalização 3P,1-Aug,2-Aug,3-Aug',
  ',,do condutor,-,-,-,-,Kit Especiais,Kit BL e PI,Kit ST,Kit SP,Kit SR,-,,SÁBADO,DOMINGO,SEGUNDA',
  '4,José I. Amaral,D,SM,Amaral,SUH-6F44,Suporte,N/A,N/A,N/A,Próprio,Próprio,CCR RioSP,RioSP,Férias,Férias,CCR RioSP (16925-25)',
  '175,João dos Santos,D,CPTu | VT | SH,João,Carro,Próprio,N/A,N/A,N/A,N/A,N/A,CCR RioSP,,Baixada,OK,Mobilização',
].join('\n');

test('parseAbaEq lê ID, nome, Serviços e uma entrada por coluna de dia', () => {
  const equipes = parseAbaEq(CSV_EQ);
  assert.strictEqual(equipes.length, 2);
  assert.strictEqual(equipes[0].id, '4');
  assert.strictEqual(equipes[0].nome, 'José I. Amaral');
  assert.strictEqual(equipes[0].servicos, 'SM');
  assert.deepStrictEqual(equipes[0].dias.map((d) => d.dia), [1, 2, 3]);
  assert.deepStrictEqual(equipes[0].dias.map((d) => d.texto), ['Férias', 'Férias', 'CCR RioSP (16925-25)']);
});

test('parseAbaEq acha as colunas de dia por REGEX, não por posição fixa', () => {
  // O offset da 1ª coluna de dia varia de 13 a 15 conforme colunas opcionais
  // do mês (mesmo achado de tools/matriz/parse-eq.js). Aqui a coluna de dia
  // começa 2 posições antes do CSV acima.
  const csv = [
    'ID,Serviços,x,y,1-Jul,2-Jul',
    ',,,,SEGUNDA,TERÇA',
    '99,SP,,,OK,Baixada',
  ].join('\n');
  const equipes = parseAbaEq(csv);
  assert.deepStrictEqual(equipes[0].dias, [{ dia: 1, texto: 'OK' }, { dia: 2, texto: 'Baixada' }]);
});

test('parseAbaEq aceita mês em inglês OU português -- a planilha mistura os dois', () => {
  const csv = ['ID,,,,1-Ago,2-Aug', ',,,,,', '7,,,,OK,OK'].join('\n');
  assert.deepStrictEqual(parseAbaEq(csv)[0].dias.map((d) => d.dia), [1, 2]);
});

test('parseAbaEq ignora linha sem ID', () => {
  const csv = ['ID,,,,1-Aug', ',,,,', ',,,,OK', '5,,,,OK'].join('\n');
  assert.deepStrictEqual(parseAbaEq(csv).map((e) => e.id), ['5']);
});

// --- casamento de nome -----------------------------------------------------

test('tokensDoNome remove acento, pontuação, preposições e sufixo de geração', () => {
  assert.deepStrictEqual(tokensDoNome('João dos Santos Gomes Filho'), ['joao', 'santos', 'gomes']);
  assert.deepStrictEqual(tokensDoNome('Marinaldo A. Oliveira'), ['marinaldo', 'a', 'oliveira']);
});

test('casarSondador acha o nome completo a partir do nome curto da EQ', () => {
  // Casos REAIS de agosto/2026. Casar por igualdade falharia nos dois; casar
  // por prefixo falharia em "Lucas Oliveira", por causa do "de" no meio.
  const sondadores = [
    'Lucas de Oliveira Silva', 'Edy Itallo Fernandes Gomes',
    'Ronielho Wallison Fernandes de Sousa', 'Gabriel de Oliveira Pereira',
  ];
  assert.strictEqual(casarSondador('Lucas Oliveira', sondadores), 'Lucas de Oliveira Silva');
  assert.strictEqual(casarSondador('Edy Itallo', sondadores), 'Edy Itallo Fernandes Gomes');
  assert.strictEqual(casarSondador('Ronielho Wallison', sondadores), 'Ronielho Wallison Fernandes de Sousa');
  assert.strictEqual(casarSondador('Gabriel de Pereira', sondadores), 'Gabriel de Oliveira Pereira');
});

test('casarSondador devolve null quando MAIS DE UM casa -- escolher seria inventar', () => {
  // "Carlos Junior" (ID 575) casa com 4 sondadores diferentes na planilha real.
  const sondadores = [
    'Silvio Carlos Dantas da Silva', 'Luiz Carlos Araujo da Silva',
    'Carlos Alberto Santos da Silva', 'Adones Carlos da Silva Ferreira',
  ];
  assert.strictEqual(casarSondador('Carlos Junior', sondadores), null);
});

test('casarSondador devolve null quando nenhum casa', () => {
  assert.strictEqual(casarSondador('Wanderson Silvestre', ['Lucas de Oliveira Silva']), null);
  assert.strictEqual(casarSondador('', ['Lucas de Oliveira Silva']), null);
});

// --- tipologia -------------------------------------------------------------

test('valor simples na coluna Serviços é a própria tipologia', () => {
  assert.strictEqual(tipologiaDireta('SM'), 'SM');
  assert.strictEqual(tipologiaDireta('SP'), 'SP');
  assert.strictEqual(tipologiaDireta('ST'), 'ST');
  assert.strictEqual(tipologiaDireta('PI'), 'PI');
});

test('CPTu | VT | SH é Especiais, e SP/SM é SP -- decisões do dono do projeto', () => {
  assert.strictEqual(tipologiaDireta('CPTu | VT | SH'), 'Especiais');
  assert.strictEqual(tipologiaDireta('SP/SM'), 'SP');
});

test('SEG.A e SEG.V são segurança, NUNCA Especiais', () => {
  // Correção explícita do dono do projeto: o balde "Especiais" não pode virar
  // depósito de tudo que não é sondagem comum.
  assert.strictEqual(tipologiaDireta('SEG.A'), 'SEG.A');
  assert.strictEqual(tipologiaDireta('SEG.V'), 'SEG.V');
});

test('"ST | PI | BL" fica sem tipologia direta -- depende do cruzamento por sondador', () => {
  assert.strictEqual(tipologiaDireta('ST | PI | BL'), null);
});

test('Lab, TST e SN não entram no Balanço por SUP de sondagem', () => {
  assert.strictEqual(tipologiaDireta('Lab'), null);
  assert.strictEqual(tipologiaDireta('TST'), null);
  assert.strictEqual(tipologiaDireta('SN'), null);
});
