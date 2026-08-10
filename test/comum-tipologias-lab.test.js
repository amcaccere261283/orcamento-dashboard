'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { classificarEnsaioLab, MAPA_TIPO_ENSAIO_LAB, fonteParaCliente, trechosParaCliente } = require('../tools/comum/tipologias-lab.js');

test('todo destino do mapa é LAB.C ou LAB.E, nunca outra coisa', () => {
  for (const destino of Object.values(MAPA_TIPO_ENSAIO_LAB)) {
    assert.ok(destino === 'LAB.C' || destino === 'LAB.E', `destino inesperado: "${destino}"`);
  }
});

// 125 pares do Frcst Novo 2.xlsx menos 19 de tipologia de avanço (escopo de
// tipologias-avancos.js), mais MCT-INFILT achado ao vivo em produção = 107 em
// 2026-08-08. Em 2026-08-10 subiu para 109: RES.CT e T.PULV apareceram quando
// o Realizado de Lab passou a cobrir desde 2025-01 em vez de só o mês
// corrente -- são 18 e 13 ensaios, todos de 2025, e por isso nunca tinham
// chegado ao build. Classificados como LAB.E pelo dono do projeto.
test('mapa consolidado tem 109 tipos de ensaio', () => {
  assert.strictEqual(Object.keys(MAPA_TIPO_ENSAIO_LAB).length, 109);
});

test('COMP.EN.3 (achado na primeira busca online de Lab Realizado) classifica como Convencional, mesmo padrão da variante ".3" já mapeada em COMP.EM.3 (após consolidação 2026-08-08)', () => {
  assert.strictEqual(classificarEnsaioLab('COMP.EN.3'), 'LAB.C');
});

test('TRI.UU (sem número de estágio) classifica igual à família TRI2.UU/TRI3.UU/TRI4.UU -- LAB.E', () => {
  assert.strictEqual(classificarEnsaioLab('TRI.UU'), 'LAB.E');
});

test('amostra de Convencional: caracterização básica', () => {
  for (const t of ['LL', 'LP', 'SED', 'M.ESP', 'PEN', 'CBR.5', 'MCT.P']) {
    assert.strictEqual(classificarEnsaioLab(t), 'LAB.C', `esperava LAB.C pra "${t}"`);
  }
});

test('amostra de Especial: ensaios mecânicos/avançados', () => {
  for (const t of ['MR.S', 'TRI3.CU', 'ADENS.I.9', 'PERM.V', 'DURAB', 'LOAD.TEST', 'DOSAG.']) {
    assert.strictEqual(classificarEnsaioLab(t), 'LAB.E', `esperava LAB.E pra "${t}"`);
  }
});

test('os 3 tipos sem classificação confiável (EQ.A, E.CAN, IND.F.P) vão pra Especial por padrão', () => {
  for (const t of ['EQ.A', 'E.CAN', 'IND.F.P']) {
    assert.strictEqual(classificarEnsaioLab(t), 'LAB.E');
  }
});

test('espaço em volta e caixa não decidem nada', () => {
  assert.strictEqual(classificarEnsaioLab('  ll  '), 'LAB.C');
  assert.strictEqual(classificarEnsaioLab('tri3.cu'), 'LAB.E');
});

test('tipo de ensaio desconhecido LANÇA citando o rótulo -- nunca cai calado em Convencional ou Especial', () => {
  assert.throws(() => classificarEnsaioLab('XYZ.NOVO'), /XYZ\.NOVO/);
});

test('tipo de ensaio vazio LANÇA -- linha sem "Tipo de Ensaio" é descartada antes, não classificada', () => {
  assert.throws(() => classificarEnsaioLab(''), /vazi/i);
  assert.throws(() => classificarEnsaioLab(null), /vazi/i);
});

test('o recorte não devolve CR nenhum', () => {
  assert.doesNotMatch(fonteParaCliente(), /\r/);
  trechosParaCliente().forEach((trecho, i) => assert.doesNotMatch(trecho, /\r/, `trecho ${i} tem CR`));
});

test('fonteParaCliente() avalia pros mesmos MAPA_TIPO_ENSAIO_LAB/classificarEnsaioLab que os exports do Node', () => {
  const fonte = fonteParaCliente();
  const cliente = new Function(`${fonte}
return { MAPA_TIPO_ENSAIO_LAB: MAPA_TIPO_ENSAIO_LAB, classificarEnsaioLab: classificarEnsaioLab };`)();

  assert.deepStrictEqual(cliente.MAPA_TIPO_ENSAIO_LAB, MAPA_TIPO_ENSAIO_LAB);
  assert.strictEqual(cliente.classificarEnsaioLab('LL'), classificarEnsaioLab('LL'));
  assert.strictEqual(cliente.classificarEnsaioLab('TRI2.UU'), classificarEnsaioLab('TRI2.UU'));
  assert.throws(() => cliente.classificarEnsaioLab('ENSAIO-INEXISTENTE'), /Tipo de Ensaio desconhecido/);
});

test('9 rótulos que divergiam do Frcst Novo 2.xlsx agora seguem o Frcst (decidido com o usuário em 2026-08-08)', () => {
  const esperado = {
    'M.ESP.A': 'LAB.E', 'COMP.D.3': 'LAB.E', 'COMP.R': 'LAB.E', 'MCT.C': 'LAB.E',
    DP: 'LAB.E', PH: 'LAB.E', 'T.ORG': 'LAB.E', 'COMP.EM.3': 'LAB.C', 'COMP.EN.3': 'LAB.C',
  };
  for (const [tipo, destino] of Object.entries(esperado)) {
    assert.strictEqual(classificarEnsaioLab(tipo), destino, tipo);
  }
});

test('pares do Frcst ausentes do mapa antigo entram sem quebrar os já existentes', () => {
  // Amostra dos pares novos (Frcst tem 125, o mapa antigo tinha ~60).
  assert.strictEqual(classificarEnsaioLab('CBR.1'), 'LAB.C');
  assert.strictEqual(classificarEnsaioLab('DSS'), 'LAB.E');
  assert.strictEqual(classificarEnsaioLab('LWD'), 'LAB.E');
  assert.strictEqual(classificarEnsaioLab('RES.COMP.SIM'), 'LAB.E');
  // Rótulos já existentes que NÃO mudaram continuam iguais.
  assert.strictEqual(classificarEnsaioLab('LL'), 'LAB.C');
  assert.strictEqual(classificarEnsaioLab('TRI4.CD'), 'LAB.E');
});

// Regressão de 2026-08-10: classificarEnsaioLab faz .toUpperCase() na chave
// antes de consultar o mapa, mas SETE chaves do mapa tinham "d" minúsculo
// ('COMP.S.28d', 'COMP.D.7d', ...). Elas eram inalcançáveis por construção --
// nenhuma entrada da fonte jamais casaria com elas -- e o efeito só apareceu
// quando o Realizado de Lab passou a cobrir 20 meses em vez de 1, trazendo
// ensaios desses tipos e derrubando o build com "tipo desconhecido".
//
// O build falhar foi o comportamento CERTO (fail-loud). O defeito era o mapa
// prometer uma classificação que nunca seria usada.
test('toda chave do mapa está em CAIXA ALTA -- o lookup normaliza, então chave com minúscula é inalcançável', () => {
  const inalcancaveis = Object.keys(MAPA_TIPO_ENSAIO_LAB).filter((k) => k !== k.toUpperCase());
  assert.deepStrictEqual(inalcancaveis, [],
    'estas chaves nunca casariam: o lookup faz .toUpperCase() e elas têm minúscula');
});

test('os 7 tipos que estavam inalcançáveis agora classificam', () => {
  for (const tipo of ['COMP.D.28D', 'COMP.D.7D', 'COMP.S.28D', 'COMP.S.3D', 'COMP.S.3D.2', 'COMP.S.3D.3', 'COMP.S.7D']) {
    assert.strictEqual(classificarEnsaioLab(tipo), 'LAB.E', tipo);
  }
});

test('a classificação continua insensível à caixa da FONTE -- é o lookup que normaliza', () => {
  assert.strictEqual(classificarEnsaioLab('comp.s.28d'), 'LAB.E');
  assert.strictEqual(classificarEnsaioLab(' COMP.S.28D '), 'LAB.E');
});
