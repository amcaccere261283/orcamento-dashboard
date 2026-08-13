'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  parseAbaEq, tokensDoNome, casarSondador, tipologiaDireta,
} = require('../tools/semanal/compute-equipes-ativas.js');
const { rotularTipologia } = require('../tools/comum/tipologias-avancos.js');

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

test('parseAbaEq aceita a coluna de dia no formato da Sheet ESPELHO ("01/08/2026")', () => {
  // O Apps Script copia VALORES, então o cabeçalho de data chega como data de
  // verdade e o CSV publicado a serializa por extenso -- diferente do export
  // direto da planilha, que traz "1-Aug". Descoberto ao ligar a URL publicada
  // em 2026-08-03. Sem isso nenhuma coluna era reconhecida no live-refresh, e
  // o efeito seria mudo: equipe sem dias é equipe sem equipe-dia, não um erro.
  const csv = [
    ' ,,Habilitação,Serviços,Líderes,x,y,z,z,z,z,z,Tomador,3P,01/08/2026,02/08/2026',
    ',,,,,,,,,,,,,,SÁBADO,DOMINGO',
    '4,José,D,SM,Amaral,,,,,,,,CCR RioSP,,Férias,OK',
  ].join('\n');
  const equipes = parseAbaEq(csv);
  assert.deepStrictEqual(equipes[0].dias, [
    { dia: 1, texto: 'Férias' }, { dia: 2, texto: 'OK' },
  ]);
});

test('parseAbaEq aceita a variante pt-BR com PONTO final ("1-ago.") -- achado ao vivo em 2026-08-13', () => {
  // A aba "2026 - AGOSTO (EQ)" trocou de "1-Aug" pra "1-ago." (abreviação
  // pt-BR com ponto) e RE_COLUNA_DIA original não aceitava o ponto -- 0
  // colunas de dia reconhecidas, roster de agosto inteiro ficando de fora
  // em silêncio (mesmo efeito mudo do formato ESPELHO acima).
  const csv = [
    ' ,,,Serviços,,,,,,,,,,,1-ago.,2-ago.',
    ',,,,,,,,,,,,,,SÁBADO,DOMINGO',
    '9,,,SP,,,,,,,,,,,OK,Férias',
  ].join('\n');
  const equipes = parseAbaEq(csv);
  assert.deepStrictEqual(equipes[0].dias, [
    { dia: 1, texto: 'OK' }, { dia: 2, texto: 'Férias' },
  ]);
});

test('os dois formatos de cabeçalho de dia convivem no mesmo parser', () => {
  const comHifen = parseAbaEq([' ,,,Serviços,,,,,,,,,,,1-Aug', ',,,,,,,,,,,,,,x', '9,,,SP,,,,,,,,,,,OK'].join('\n'));
  const comBarra = parseAbaEq([' ,,,Serviços,,,,,,,,,,,01/08/2026', ',,,,,,,,,,,,,,x', '9,,,SP,,,,,,,,,,,OK'].join('\n'));
  assert.deepStrictEqual(comHifen[0].dias, comBarra[0].dias);
});

test('cabeçalho que não é dia continua fora -- o \d{4} do ano impede casar "10/2026"', () => {
  const csv = [' ,,,Serviços,,,,,,,,,,,Tomador,10/2026,1-Aug', ',,,,,,,,,,,,,,x,y,z', '9,,,SP,,,,,,,,,,,a,b,OK'].join('\n');
  const equipes = parseAbaEq(csv);
  assert.deepStrictEqual(equipes[0].dias, [{ dia: 1, texto: 'OK' }], 'só a coluna 1-Aug é dia');
});

// --- agregarEquipesAtivas --------------------------------------------------

const { agregarEquipesAtivas, juntarPorDia } = require('../tools/semanal/compute-equipes-ativas.js');

const diaEp = (d) => Math.floor(Date.UTC(2026, 7, d) / 86400000); // agosto/2026

function equipe(id, servicos, textos, nome) {
  return { id, nome: nome || ('Lider ' + id), servicos, dias: textos.map((t, i) => ({ dia: i + 1, texto: t })) };
}

test('a OS do dia dá o SUP, e o equipe-dia entra em (SUP, tipologia)', () => {
  const r = agregarEquipesAtivas({
    equipes: [equipe('1', 'SM', ['CCR RioSP (16925-25)', 'OK'])],
    osParaSup: { '16925-25': 'SUP-7285-24' },
    ano: 2026, mes: 8,
  });
  // Dia 1 tem OS; dia 2 é "OK" (mobilizada sem OS) e herda o mesmo SUP.
  assert.deepStrictEqual(r.porDia['SUP-7285-24||SM'], { [diaEp(1)]: 1, [diaEp(2)]: 1 });
});

test('dia ativo sem OS herda a ÚLTIMA OS -- baixada não rompe o vínculo com o contrato', () => {
  const r = agregarEquipesAtivas({
    equipes: [equipe('1', 'SP', ['EPR (17739-26)', 'Mobilização', 'chuva'])],
    osParaSup: { '17739-26': 'SUP-7128-24' },
    ano: 2026, mes: 8,
  });
  assert.deepStrictEqual(r.porDia['SUP-7128-24||SP'], { [diaEp(1)]: 1, [diaEp(2)]: 1, [diaEp(3)]: 1 });
});

test('férias e baixada NÃO entram, mesmo entre dias mobilizados', () => {
  const r = agregarEquipesAtivas({
    equipes: [equipe('1', 'SP', ['EPR (17739-26)', 'Baixada', 'Férias', 'OK'])],
    osParaSup: { '17739-26': 'SUP-7128-24' },
    ano: 2026, mes: 8,
  });
  assert.deepStrictEqual(r.porDia['SUP-7128-24||SP'], { [diaEp(1)]: 1, [diaEp(4)]: 1 });
  assert.strictEqual(r.diasPorEstado.fora, 2);
});

test('equipe que nunca teve OS no mês vai para naoApropriadas, nunca rateada', () => {
  const r = agregarEquipesAtivas({
    equipes: [equipe('1', 'SP', ['Mobilização', 'chuva'])],
    osParaSup: {},
    ano: 2026, mes: 8,
  });
  assert.deepStrictEqual(r.porDia, {});
  assert.strictEqual(r.naoApropriadas, 2);
});

test('"ST | PI | BL" resolve a tipologia pelo sondador que lidera a equipe', () => {
  const r = agregarEquipesAtivas({
    equipes: [equipe('353', 'ST | PI | BL', ['CCR RioSP (16925-25)'], 'Lucas Oliveira')],
    osParaSup: { '16925-25': 'SUP-7285-24' },
    nomesSondadores: ['Lucas de Oliveira Silva'],
    tipologiaPorSondador: { 'Lucas de Oliveira Silva': 'ST' },
    ano: 2026, mes: 8,
  });
  assert.deepStrictEqual(r.porDia['SUP-7285-24||ST'], { [diaEp(1)]: 1 });
});

test('sem conseguir resolver a tipologia, o equipe-dia é contado à parte -- não vira Especiais nem some', () => {
  const r = agregarEquipesAtivas({
    equipes: [equipe('629', 'ST | PI | BL', ['CCR RioSP (16925-25)'], 'Wanderson Silvestre')],
    osParaSup: { '16925-25': 'SUP-7285-24' },
    nomesSondadores: ['Lucas de Oliveira Silva'],
    ano: 2026, mes: 8,
  });
  assert.deepStrictEqual(r.porDia, {});
  assert.strictEqual(r.semTipologia, 1);
});

test('duas equipes no mesmo SUP, tipologia e dia contam 2', () => {
  // OS com o formato REAL (5 dígitos): o padrão exige \d{3,6}-\d{2}, então
  // um "(1-26)" inventado não seria reconhecido como OS.
  const r = agregarEquipesAtivas({
    equipes: [equipe('1', 'SM', ['A (17851-26)']), equipe('2', 'SM', ['B (17851-26)'])],
    osParaSup: { '17851-26': 'SUP-X' },
    ano: 2026, mes: 8,
  });
  assert.strictEqual(r.porDia['SUP-X||SM'][diaEp(1)], 2);
});

test('juntarPorDia soma vários meses sem perder dia nenhum', () => {
  const a = { 'SUP-X||SM': { 100: 2 } };
  const b = { 'SUP-X||SM': { 100: 1, 131: 3 }, 'SUP-Y||SP': { 131: 1 } };
  assert.deepStrictEqual(juntarPorDia([a, b]), {
    'SUP-X||SM': { 100: 3, 131: 3 },
    'SUP-Y||SP': { 131: 1 },
  });
});

test('equipe CPTu | VT | SH é apropriada, não cai em semTipologia', () => {
  // Regressão de 2026-08-10: TIPOLOGIA_DIRETA devolvia 'Especiais',
  // rotularTipologia lançava, o try/catch engolia, e as 7 equipes de Especiais
  // sumiam da conta sem nenhum aviso.
  const equipes = [{
    id: '175', nome: 'João dos Santos', servicos: 'CPTu | VT | SH',
    dias: [{ dia: 1, texto: 'CCR RioSP (16925-25)' }, { dia: 2, texto: 'OK' }],
  }];
  const r = agregarEquipesAtivas({
    equipes, osParaSup: { '16925-25': 'SUP-7128-24' },
    rotularTipologia, ano: 2026, mes: 8,
  });
  assert.strictEqual(r.semTipologia, 0, 'nenhuma equipe pode sobrar sem tipologia aqui');
  const chaves = Object.keys(r.porDia);
  assert.deepStrictEqual(chaves, ['SUP-7128-24||Especiais']);
  const dias = r.porDia['SUP-7128-24||Especiais'];
  assert.strictEqual(Object.values(dias).reduce((a, b) => a + b, 0), 2);
});
