'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ordenarPorDesvio, calcularLinhas } = require('../tools/semanal/compute-balanco.js');
const { DIAS_PREMISSA_MES, mediaEquipesPonderada } = require('../tools/comum/calculo-equipes.js');
const { diaEpoch } = require('../tools/semanal/compute-semanal.js');

test('ordena por desvio com sinal, positivos antes dos negativos', () => {
  const linhas = [
    { sup: 'A', desvio: -50 }, { sup: 'B', desvio: 100 },
    { sup: 'C', desvio: -72 }, { sup: 'D', desvio: 15 }, { sup: 'E', desvio: 70 },
  ];
  assert.deepStrictEqual(ordenarPorDesvio(linhas).map(l => l.sup), ['B', 'E', 'D', 'A', 'C']);
});

test('desvio é realizado menos base', () => {
  const linhas = calcularLinhas(cenario({ previstoVol: 105, realizadoVol: 205 }));
  assert.strictEqual(linhas[0].desvio, 100);
});

test('SUP sem movimento no período fica marcado como inativo', () => {
  const linhas = calcularLinhas(cenario({ previstoVol: 0, realizadoVol: 0 }));
  assert.strictEqual(linhas[0].ativo, false);
});

test('SUP com previsto e sem realizado continua ativo', () => {
  const linhas = calcularLinhas(cenario({ previstoVol: 300, realizadoVol: 0 }));
  assert.strictEqual(linhas[0].ativo, true);
});

test('base Previsto Inicial ausente marca semBase, nunca desvio zero', () => {
  const linhas = calcularLinhas(cenario({ previstoVol: 100, realizadoVol: 100, base: 'previstoInicial', baseline: [] }));
  assert.strictEqual(linhas[0].semBase, true);
  assert.strictEqual(linhas[0].desvio, null);
});

// --- Correções da rodada de revisão (achados 1-3 sobre o commit d209db4) ---

// Achado 2: o fixture original deste teste (herdado do brief) usava
// `{sup, tipologia, volume}` solto na linha de base, mas o formato REAL que
// tools/semanal/build-dashboard.js produz (baselineParaCliente, sobre o Map
// de tools/orcamento/parse-baseline.js) é `{chave: "sup||tipologia", ...}`
// -- mesma convenção `${sup}||${tipologia}` que parseBaseline já usa como
// chave do Map. Com o fixture antigo, ligar isto a dados reais faria TODA
// linha cair em semBase:true (nada bateria), indistinguível de "contrato
// novo sem linha na linha de base" -- falha silenciosa. calcularLinhas foi
// corrigido pra casar por 'chave'; os testes abaixo provam os dois lados.
test('base Previsto Inicial casa por "chave" (formato real de baselineParaCliente), não por sup/tipologia soltos', () => {
  const linhas = calcularLinhas(cenario({
    previstoVol: 100, realizadoVol: 130, base: 'previstoInicial',
    baseline: [mkBaseline('SUP-0001-24||ST', 80, 2)],
  }));
  assert.strictEqual(linhas[0].semBase, false);
  assert.strictEqual(linhas[0].valorBase, 80);
  assert.strictEqual(linhas[0].desvio, 50); // 130 - 80
});

test('base Previsto Inicial com baseline não vazio mas sem chave pra este SUP/tipologia também marca semBase, nunca desvio zero', () => {
  const linhas = calcularLinhas(cenario({
    previstoVol: 100, realizadoVol: 100, base: 'previstoInicial',
    // baseline tem dado de verdade, só que pra outro SUP -- não pode ser
    // confundido com "linha de base vazia".
    baseline: [mkBaseline('SUP-9999-24||PB', 999, 9)],
  }));
  assert.strictEqual(linhas[0].semBase, true);
  assert.strictEqual(linhas[0].valorBase, null);
  assert.strictEqual(linhas[0].desvio, null);
});

// --- Revisão final da branch: "base ausente != desvio zero" também na base
// 'previsto' (que é o DEFAULT da aba, não a exceção) ---
//
// A regra só valia no ramo 'previstoInicial'. Com a base 'previsto' e o
// intervalo inteiro em branco, saía desvio:null com semBase:false -- e o
// gráfico caía no ramo normal, onde `linha.desvio || 0` desenha uma barra de
// comprimento zero e o rótulo vira '—'. Na tela isso é idêntico a "o
// realizado bateu a base exatamente", que é o oposto do que aconteceu.
// É alcançável com dado real: parse-matriz.js emite null para célula em
// branco, e um SUP com Realizado e sem Previsto fica ativo:true -- ou seja, o
// filtro "somente ativos" (ligado por padrão) NÃO o esconde.
test('base Previsto com o intervalo inteiro em branco marca semBase -- nunca desvio zero, que na tela é "o realizado bateu a base"', () => {
  const mensalNulo = () => new Array(12).fill(null);
  const previsto = { volume: mensalNulo(), equipes: mensalNulo(), financeiro: mensalNulo() };
  const realizado = { volume: new Array(12).fill(0), equipes: new Array(12).fill(0), financeiro: new Array(12).fill(0) };
  realizado.volume[6] = 120; realizado.equipes[6] = 3;

  const linhas = calcularLinhas({
    registros: [{ sup: 'SUP-0007-26', tipologia: 'ST', previsto, realizado, total: previsto }],
    indices: [0], tipologia: 'ST', base: 'previsto', dimensao: 'volume', periodo: 'mesVigente',
    vigenteIdx: 6, baseline: [],
  });

  assert.strictEqual(linhas[0].ativo, true, 'pré-condição: com realizado > 0 a linha é ativa, então o filtro padrão NÃO a esconde -- é por isso que o caso chega ao gráfico');
  assert.strictEqual(linhas[0].semBase, true);
  assert.strictEqual(linhas[0].valorBase, null);
  assert.strictEqual(linhas[0].desvio, null);
  assert.strictEqual(linhas[0].equipesBase, null);
  assert.strictEqual(linhas[0].desvioEquipes, null);
});

// O contraste que impede a regra acima de virar grosseira demais: previsto
// LANÇADO como zero é base de verdade (o contrato estava previsto para não
// produzir nada), e aí desvio zero é a resposta certa, não "sem base".
// somarIntervalo só devolve null quando NENHUM mês do intervalo tem valor.
test('base Previsto igual a zero (lançada, não em branco) continua sendo base -- semBase false e desvio real', () => {
  const linhas = calcularLinhas(cenario({ previstoVol: 0, realizadoVol: 40 }));
  assert.strictEqual(linhas[0].semBase, false);
  assert.strictEqual(linhas[0].valorBase, 0);
  assert.strictEqual(linhas[0].desvio, 40);
});

// Achado 3: equipesBase/equipesRealizado/desvioEquipes não tinham asserção
// própria -- só apareciam por leitura do brief. Cobertos agora, inclusive
// no caso multi-mês que prova a média PONDERADA por dias (não a soma, nem a
// média simples), que é a premissa que mediaEquipesPonderada (Task 4)
// existe pra garantir.
test('equipesBase e equipesRealizado vêm de mediaEquipesPonderada, desvioEquipes é a diferença', () => {
  const linhas = calcularLinhas(cenario({ previstoVol: 105, realizadoVol: 205 }));
  // cenario() fixa equipes previsto=2, realizado=3 num único mês -- média
  // ponderada de um mês só devolve o próprio valor (peso 1).
  assert.strictEqual(linhas[0].equipesBase, 2);
  assert.strictEqual(linhas[0].equipesRealizado, 3);
  assert.strictEqual(linhas[0].desvioEquipes, 1);
});

test('acumuladoAteMes: equipes usa média ponderada por dias entre jan (15d) e fev (30d), não soma nem média simples', () => {
  const previsto = { volume: new Array(12).fill(0), equipes: new Array(12).fill(0), financeiro: new Array(12).fill(0) };
  const realizado = { volume: new Array(12).fill(0), equipes: new Array(12).fill(0), financeiro: new Array(12).fill(0) };
  previsto.equipes[0] = 2; previsto.equipes[1] = 4; // jan=2, fev=4
  realizado.volume[0] = 10; realizado.volume[1] = 10; // só pra 'ativo' ficar true

  const linhas = calcularLinhas({
    registros: [{ sup: 'SUP-0002-24', tipologia: 'ST', previsto, realizado, total: previsto }],
    indices: [0], tipologia: 'ST', base: 'previsto', dimensao: 'volume', periodo: 'acumuladoAteMes',
    vigenteIdx: 1, baseline: [],
  });

  const pesoJan = DIAS_PREMISSA_MES[0], pesoFev = DIAS_PREMISSA_MES[1];
  const esperado = (2 * pesoJan + 4 * pesoFev) / (pesoJan + pesoFev);
  // Trava contra qualquer troca de mediaEquipesPonderada por outra conta:
  // usa a própria função (Task 4) como oráculo, em vez de um número fixo.
  assert.strictEqual(esperado, mediaEquipesPonderada(previsto.equipes, 0, 2));
  assert.strictEqual(linhas[0].equipesBase, esperado);
  assert.ok(linhas[0].equipesBase !== 3, 'não pode ser a média simples (2+4)/2=3 -- jan e fev não pesam igual');
  assert.ok(linhas[0].equipesBase < 6, 'não pode ser a soma (2+4=6)');
});

// helper que monta uma entrada de linha de base no formato real
// (baselineParaCliente): {chave, volume, equipes, financeiro}, com o valor
// de interesse só no mês 6 (mesmo mês vigente que cenario() usa).
function mkBaseline(chave, volMes6, eqMes6) {
  const volume = new Array(12).fill(0), equipes = new Array(12).fill(0);
  volume[6] = volMes6; equipes[6] = eqMes6;
  return { chave, volume, equipes, financeiro: new Array(12).fill(0) };
}

// helper que monta o cenário mínimo de 1 SUP × 1 tipologia no mês 6
function cenario({ previstoVol, realizadoVol, base = 'previsto', baseline = null, tomador = 'Tomador-Padrao' }) {
  const mk = (vol, eq) => { const v = new Array(12).fill(0), e = new Array(12).fill(0);
    v[6] = vol; e[6] = eq; return { volume: v, equipes: e, financeiro: new Array(12).fill(0) }; };
  return {
    registros: [{ sup: 'SUP-0001-24', tipologia: 'ST', tomador, previsto: mk(previstoVol, 2), realizado: mk(realizadoVol, 3), total: mk(0, 0) }],
    indices: [0], tipologia: 'ST', base, dimensao: 'volume', periodo: 'mesVigente',
    vigenteIdx: 6, baseline: baseline === null ? [{ chave: 'SUP-0001-24||ST', volume: new Array(12).fill(0) }] : baseline,
  };
}

test('tomador chega em cada linha, direto do registro', () => {
  const linhas = calcularLinhas(cenario({ previstoVol: 100, realizadoVol: 100, tomador: 'Concessionária Exemplo S.A' }));
  assert.strictEqual(linhas[0].tomador, 'Concessionária Exemplo S.A');
});

// --- Mês Vigente usa o Realizado do Avanço Sond (achado de 2026-08-01) -----
//
// A coluna Realizado da MATRIZ só é preenchida depois que o mês fecha --
// pra Mês Vigente (o mês em andamento) ela vem SEMPRE em branco, mesmo
// havendo furos reais concluídos (confirmado nos dados reais: SUP-7133-24,
// SP, julho -- 100 Previsto, Realizado da MATRIZ nulo, mas 115 furos já
// concluídos no Avanço Sond). Decisão do dono do projeto: usar o dado do
// Avanço Sond SOMENTE pra Mês Vigente -- Acumulado até o mês continua na
// coluna da MATRIZ, sem mudança (ver os testes acima, nenhum passa
// 'demandas').

var ANO_TESTE = 2026;
var VIGENTE_JULHO = 6;

function diaJul(dia) { return diaEpoch(new Date(Date.UTC(ANO_TESTE, 6, dia))); }

function demandasComEventos(chave, dias) {
  var porRegistroEventos = {};
  porRegistroEventos[chave] = { chegada: [], saidaEstoque: [], sondagemRealizada: dias };
  return { porRegistroEventos: porRegistroEventos };
}

test('Mês Vigente com demandas: Realizado de Volume conta os furos concluídos no Avanço Sond, ignora a coluna Realizado da MATRIZ', () => {
  var linhas = calcularLinhas(Object.assign(
    cenario({ previstoVol: 100, realizadoVol: 999 }), // 999 na MATRIZ -- tem que ser IGNORADO
    { demandas: demandasComEventos('SUP-0001-24||ST', [diaJul(1), diaJul(8), diaJul(15)]), ano: ANO_TESTE }
  ));
  assert.strictEqual(linhas[0].valorRealizado, 3, '3 furos concluídos em julho, não os 999 da MATRIZ');
  assert.strictEqual(linhas[0].desvio, -97); // 3 - 100
});

test('Mês Vigente com demandas: Realizado de Financeiro pesa cada furo pelo ticket médio do registro, mesma lógica de render-aba-semanal.js', () => {
  var base = cenario({ previstoVol: 100, realizadoVol: 999 });
  base.dimensao = 'financeiro';
  base.registros[0].previsto.volumeResumo = { total: 0, totalInicial: 0, ticket: 250 };
  var linhas = calcularLinhas(Object.assign(base, {
    demandas: demandasComEventos('SUP-0001-24||ST', [diaJul(1), diaJul(8)]), ano: ANO_TESTE,
  }));
  assert.strictEqual(linhas[0].valorRealizado, 500); // 2 furos x 250
});

test('Mês Vigente com demandas: (sup,tipologia) sem entrada em porRegistroEventos conta 0, nunca null -- ausência é zero, não "sem dado"', () => {
  var linhas = calcularLinhas(Object.assign(
    cenario({ previstoVol: 100, realizadoVol: 999 }),
    { demandas: demandasComEventos('SUP-OUTRO||ST', [diaJul(1)]), ano: ANO_TESTE } // chave de OUTRO sup
  ));
  assert.strictEqual(linhas[0].valorRealizado, 0);
  assert.notStrictEqual(linhas[0].valorRealizado, null);
  assert.strictEqual(linhas[0].desvio, -100); // 0 - 100, número real, não null
});

test('Mês Vigente com demandas: furo fora do intervalo do mês (junho) não conta em julho', () => {
  var diaJun30 = diaEpoch(new Date(Date.UTC(ANO_TESTE, 5, 30)));
  var linhas = calcularLinhas(Object.assign(
    cenario({ previstoVol: 100, realizadoVol: 0 }),
    { demandas: demandasComEventos('SUP-0001-24||ST', [diaJun30, diaJul(1)]), ano: ANO_TESTE }
  ));
  assert.strictEqual(linhas[0].valorRealizado, 1, 'só o furo de 01/07 conta -- 30/06 é de junho');
});

test('Mês Vigente com demandas: equipesRealizado continua vindo da MATRIZ -- Avanço Sond não rastreia equipes por furo', () => {
  var linhas = calcularLinhas(Object.assign(
    cenario({ previstoVol: 100, realizadoVol: 999 }),
    { demandas: demandasComEventos('SUP-0001-24||ST', [diaJul(1), diaJul(2)]), ano: ANO_TESTE }
  ));
  assert.strictEqual(linhas[0].equipesRealizado, 3, 'mesmo valor de sempre -- cenario() fixa equipesRealizado=3 na MATRIZ');
});

test('Acumulado até o mês IGNORA demandas -- continua lendo a coluna Realizado da MATRIZ, mesmo com demandas presente', () => {
  var base = cenario({ previstoVol: 100, realizadoVol: 50 });
  base.periodo = 'acumuladoAteMes';
  var linhas = calcularLinhas(Object.assign(base, {
    demandas: demandasComEventos('SUP-0001-24||ST', [diaJul(1), diaJul(8), diaJul(15)]), ano: ANO_TESTE,
  }));
  assert.strictEqual(linhas[0].valorRealizado, 50, 'os 3 furos do Avanço Sond não podem influenciar Acumulado até o mês');
});

test('Mês Vigente SEM demandas (undefined) cai no comportamento de sempre -- coluna Realizado da MATRIZ', () => {
  var linhas = calcularLinhas(cenario({ previstoVol: 100, realizadoVol: 42 })); // sem 'demandas' no objeto
  assert.strictEqual(linhas[0].valorRealizado, 42);
});

test('Mês Vigente com demandas mas SEM ano cai no comportamento de sempre -- ano é obrigatório pra converter mês em dia-desde-época', () => {
  var linhas = calcularLinhas(Object.assign(
    cenario({ previstoVol: 100, realizadoVol: 42 }),
    { demandas: demandasComEventos('SUP-0001-24||ST', [diaJul(1)]) } // sem 'ano'
  ));
  assert.strictEqual(linhas[0].valorRealizado, 42, 'sem ano não dá pra converter o intervalo de mês em dia-desde-época -- cai no fallback');
});
