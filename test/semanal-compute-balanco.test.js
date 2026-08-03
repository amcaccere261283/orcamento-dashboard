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

// --- Filtro de semanas no Balanço (2026-08-03) -----------------------------
//
// Pedido do dono do projeto: poder recortar o Balanço de massa por semana do
// mês vigente, cada semana marcável de forma independente. Duas grandezas
// respondem de formas DIFERENTES ao recorte, e é isso que estes testes travam:
//
//   - Realizado: os furos têm data, então o recorte é exato -- conta só o que
//     caiu dentro das semanas marcadas.
//   - Base (Previsto/Previsto Inicial): é um número MENSAL. Reparte pelos dias
//     de cada semana, exatamente como dividirEmSemanas já faz na Tabela
//     Semanal -- nunca em fatias iguais por semana.
//   - Equipes: é FOTO, não fluxo. Não se reparte: 2 equipes no mês são 2
//     equipes em qualquer recorte de semana.

const { semanasDoMes } = require('../tools/semanal/compute-semanal.js');

function cenarioSemanas({ semanasSelecionadas, previstoVol = 310, eventos = [] }) {
  const mk = (vol, eq) => { const v = new Array(12).fill(0), e = new Array(12).fill(0);
    v[6] = vol; e[6] = eq; return { volume: v, equipes: e, financeiro: new Array(12).fill(0) }; };
  return {
    registros: [{ sup: 'SUP-0001-24', tipologia: 'ST', tomador: 'T', previsto: mk(previstoVol, 2), realizado: mk(0, 0), total: mk(0, 0) }],
    indices: [0], tipologia: 'ST', base: 'previsto', dimensao: 'volume', periodo: 'mesVigente',
    vigenteIdx: VIGENTE_JULHO, baseline: [],
    demandas: { porRegistroEventos: { 'SUP-0001-24||ST': { sondagemRealizada: eventos } } },
    ano: ANO_TESTE,
    semanas: semanasDoMes(ANO_TESTE, VIGENTE_JULHO),
    semanasSelecionadas: semanasSelecionadas,
  };
}

test('semanas: o Realizado conta só os furos que caíram nas semanas marcadas', () => {
  // Julho/2026: S1 = 01..05, S2 = 06..12 (segunda a domingo, cortadas dentro
  // do mês -- ver semanasDoMes).
  const eventos = [diaJul(2), diaJul(3), diaJul(8), diaJul(9), diaJul(10)];

  const soS1 = calcularLinhas(cenarioSemanas({ semanasSelecionadas: [0], eventos }));
  const soS2 = calcularLinhas(cenarioSemanas({ semanasSelecionadas: [1], eventos }));
  const ambas = calcularLinhas(cenarioSemanas({ semanasSelecionadas: [0, 1], eventos }));

  assert.strictEqual(soS1[0].valorRealizado, 2, 'S1 tem 2 furos (02 e 03/07)');
  assert.strictEqual(soS2[0].valorRealizado, 3, 'S2 tem 3 furos (08, 09 e 10/07)');
  assert.strictEqual(ambas[0].valorRealizado, 5, 'as semanas marcadas somam, não se substituem');
});

test('semanas: as semanas são independentes -- marcar S1 e S3 pula o meio', () => {
  const eventos = [diaJul(2), diaJul(8), diaJul(15)]; // S1, S2, S3
  const linhas = calcularLinhas(cenarioSemanas({ semanasSelecionadas: [0, 2], eventos }));
  assert.strictEqual(linhas[0].valorRealizado, 2, 'o furo de S2 fica de fora');
});

test('semanas: a base mensal se reparte pelos DIAS da semana, não em fatias iguais', () => {
  // Julho/2026 tem 31 dias; S1 (01..05) tem 5. Com base 310 no mês, S1 leva
  // 310 * 5/31 = 50. Em fatias iguais por semana (5 semanas) daria 62 -- 24%
  // a mais, o erro que dividirEmSemanas já corrigiu na Tabela Semanal.
  const linhas = calcularLinhas(cenarioSemanas({ semanasSelecionadas: [0], previstoVol: 310 }));
  assert.ok(Math.abs(linhas[0].valorBase - 50) < 0.0001, `S1 devia levar 50, levou ${linhas[0].valorBase}`);
});

test('semanas: marcar todas devolve exatamente o mês inteiro', () => {
  const semanas = semanasDoMes(ANO_TESTE, VIGENTE_JULHO);
  const todas = semanas.map((_, i) => i);
  const comTodas = calcularLinhas(cenarioSemanas({ semanasSelecionadas: todas, previstoVol: 310 }));
  const semFiltro = calcularLinhas(cenarioSemanas({ semanasSelecionadas: null, previstoVol: 310 }));
  assert.ok(Math.abs(comTodas[0].valorBase - 310) < 0.0001, 'a repartição por dias tem que somar o mês de volta');
  assert.strictEqual(semFiltro[0].valorBase, 310);
});

test('semanas: nenhuma marcada = todas, mesma convenção dos filtros da barra', () => {
  const eventos = [diaJul(2), diaJul(8)];
  const vazio = calcularLinhas(cenarioSemanas({ semanasSelecionadas: [], eventos }));
  const nulo = calcularLinhas(cenarioSemanas({ semanasSelecionadas: null, eventos }));
  assert.strictEqual(vazio[0].valorRealizado, nulo[0].valorRealizado);
  assert.strictEqual(vazio[0].valorBase, nulo[0].valorBase);
});

test('semanas: Equipes é foto -- o recorte por semana não reparte a base de equipes', () => {
  const cfg = cenarioSemanas({ semanasSelecionadas: [0] });
  cfg.dimensao = 'equipes';
  const linhas = calcularLinhas(cfg);
  // 2 equipes mobilizadas em julho continuam 2 em S1: um sétimo de equipe não
  // existe. Mesma premissa de dividirEmSemanas/mediaEquipesPonderada.
  assert.strictEqual(linhas[0].equipesBase, 2);
});

test('semanas: o recorte só vale para Mês Vigente -- Acumulado até o mês ignora a seleção', () => {
  // As semanas são do mês vigente; num acumulado de 7 meses elas não têm
  // significado. A UI desabilita o controle, e o cálculo ignora por garantia.
  const cfg = cenarioSemanas({ semanasSelecionadas: [0], previstoVol: 310 });
  cfg.periodo = 'acumuladoAteMes';
  const linhas = calcularLinhas(cfg);
  assert.strictEqual(linhas[0].valorBase, 310, 'o acumulado continua somando o mês inteiro');
});

// --- Equipes mobilizadas do Avanço Sond (2026-08-03) -----------------------

test('equipes: com equipesPorDia, o Realizado vem do Avanço Sond e não da coluna morta da MATRIZ', () => {
  // A MATRIZ traz 0 em equipes no mês corrente (medido: 349 de 350 registros
  // em agosto/2026), o que desenhava um déficit igual ao previsto inteiro.
  const cfg = cenarioSemanas({ semanasSelecionadas: null });
  cfg.dimensao = 'equipes';
  const semanas = semanasDoMes(ANO_TESTE, VIGENTE_JULHO);
  const primeiroDia = semanas[0].inicio;
  // 2 equipes em todos os 31 dias de julho = 2,0 equivalentes.
  const porDia = {};
  for (let d = primeiroDia; d <= semanas[semanas.length - 1].fim; d++) porDia[d] = 2;
  cfg.equipesPorDia = { 'SUP-0001-24||ST': porDia };

  const linhas = calcularLinhas(cfg);
  assert.ok(Math.abs(linhas[0].equipesRealizado - 2) < 0.0001,
    `esperava 2,0 equipes equivalentes, veio ${linhas[0].equipesRealizado}`);
  assert.strictEqual(linhas[0].equipesBase, 2, 'a base continua sendo o Previsto da MATRIZ');
  assert.ok(Math.abs(linhas[0].desvioEquipes) < 0.0001, 'mobilizado igual ao previsto = desvio zero');
});

test('equipes: sem equipesPorDia, cai no comportamento antigo (coluna da MATRIZ) -- retrocompatível', () => {
  const cfg = cenarioSemanas({ semanasSelecionadas: null });
  cfg.dimensao = 'equipes';
  const linhas = calcularLinhas(cfg);
  // A fixture tem realizado.equipes zerado; o importante é não quebrar quem
  // ainda não passa equipesPorDia.
  assert.strictEqual(linhas[0].equipesRealizado, 0);
});

test('equipes: o Realizado respeita o recorte semanal -- é ocupação por dia, não foto', () => {
  // Este é o ponto em que equipes deixa de ser foto: a BASE continua sem se
  // repartir (2 equipes no mês são 2 em qualquer semana), mas o MOBILIZADO é
  // medido dia a dia, então marcar só S1 mostra o que rodou em S1.
  const semanas = semanasDoMes(ANO_TESTE, VIGENTE_JULHO);
  const porDia = {};
  // 4 equipes só nos dias da semana 1; nada no resto do mês.
  for (let d = semanas[0].inicio; d <= semanas[0].fim; d++) porDia[d] = 4;

  const soS1 = cenarioSemanas({ semanasSelecionadas: [0] });
  soS1.dimensao = 'equipes';
  soS1.equipesPorDia = { 'SUP-0001-24||ST': porDia };
  assert.ok(Math.abs(calcularLinhas(soS1)[0].equipesRealizado - 4) < 0.0001,
    'em S1 rodaram 4 equipes em todos os dias da semana');

  const soS2 = cenarioSemanas({ semanasSelecionadas: [1] });
  soS2.dimensao = 'equipes';
  soS2.equipesPorDia = { 'SUP-0001-24||ST': porDia };
  assert.strictEqual(calcularLinhas(soS2)[0].equipesRealizado, 0, 'em S2 não rodou ninguém');

  // E a base NÃO se repartiu em nenhum dos dois -- continua a foto do mês.
  assert.strictEqual(calcularLinhas(soS1)[0].equipesBase, 2);
});

test('equipes: em Acumulado até o mês a janela cobre janeiro..mês, não só o mês vigente', () => {
  const cfg = cenarioSemanas({ semanasSelecionadas: null });
  cfg.dimensao = 'equipes';
  cfg.periodo = 'acumuladoAteMes';
  // 1 equipe todo dia de janeiro a julho (212 dias) -> 1,0 equivalente.
  const porDia = {};
  const ini = diaEpoch(new Date(Date.UTC(ANO_TESTE, 0, 1)));
  const fim = diaEpoch(new Date(Date.UTC(ANO_TESTE, 6, 31)));
  for (let d = ini; d <= fim; d++) porDia[d] = 1;
  cfg.equipesPorDia = { 'SUP-0001-24||ST': porDia };

  assert.ok(Math.abs(calcularLinhas(cfg)[0].equipesRealizado - 1) < 0.0001,
    'a janela do acumulado tem que ser o intervalo inteiro, senão a média sai diluída');
});

test('equipes: a janela para em HOJE -- média do mês corrente não é diluída pelos dias que faltam', () => {
  // Medido em 03/08/2026: sem isso, agosto dava 3,5 equipes equivalentes
  // contra 52,8 de julho -- não porque a operação parou, mas porque 3 dias de
  // ocupação eram divididos por 31. A barra mostraria um déficit falso, que é
  // exatamente o defeito que trocar a fonte veio corrigir.
  const semanas = semanasDoMes(ANO_TESTE, VIGENTE_JULHO);
  const primeiro = semanas[0].inicio;
  const hoje = primeiro + 2; // 3 dias decorridos (dias 0, 1 e 2)
  const porDia = {};
  for (let d = primeiro; d <= hoje; d++) porDia[d] = 3;

  const cfg = cenarioSemanas({ semanasSelecionadas: null });
  cfg.dimensao = 'equipes';
  cfg.equipesPorDia = { 'SUP-0001-24||ST': porDia };
  cfg.hojeEpoch = hoje;

  assert.ok(Math.abs(calcularLinhas(cfg)[0].equipesRealizado - 3) < 0.0001,
    'com a janela até hoje, 3 equipes em todos os dias decorridos = 3,0');

  // Sem hojeEpoch (chamador antigo), volta a dividir pelo mês inteiro.
  delete cfg.hojeEpoch;
  assert.ok(calcularLinhas(cfg)[0].equipesRealizado < 1,
    'pré-condição: sem o corte a média cai, é essa a diluição que o teste acima previne');
});

test('equipes: mês inteiramente no futuro fica sem dado, não zero', () => {
  const semanas = semanasDoMes(ANO_TESTE, VIGENTE_JULHO);
  const cfg = cenarioSemanas({ semanasSelecionadas: null });
  cfg.dimensao = 'equipes';
  cfg.equipesPorDia = { 'SUP-0001-24||ST': {} };
  cfg.hojeEpoch = semanas[0].inicio - 10; // hoje é antes do mês começar
  assert.strictEqual(calcularLinhas(cfg)[0].equipesRealizado, null,
    'nada aconteceu ainda: sem-dado, não uma medição de zero');
});

test('equipes: fora do mês coberto pela aba EQ, fica SEM DADO -- nunca zero', () => {
  // A Sheet espelho carrega UM mês. Escolher outro mês não pode virar "zero
  // equipes" (indistinguível de "a operação parou"): tem que ser sem-dado,
  // com aviso na tela. Decisão do dono do projeto em 2026-08-03.
  const cfg = cenarioSemanas({ semanasSelecionadas: null });
  cfg.dimensao = 'equipes';
  cfg.equipesPorDia = { 'SUP-0001-24||ST': {} };
  cfg.equipesAtivasPeriodo = { ano: ANO_TESTE, mes: 8 }; // espelho traz agosto
  // ...mas o Balanço está em julho (VIGENTE_JULHO = 6).
  assert.strictEqual(calcularLinhas(cfg)[0].equipesRealizado, null);
});

test('equipes: no mês coberto, o dado aparece normalmente', () => {
  const cfg = cenarioSemanas({ semanasSelecionadas: null });
  cfg.dimensao = 'equipes';
  const semanas = semanasDoMes(ANO_TESTE, VIGENTE_JULHO);
  const porDia = {};
  for (let d = semanas[0].inicio; d <= semanas[semanas.length - 1].fim; d++) porDia[d] = 2;
  cfg.equipesPorDia = { 'SUP-0001-24||ST': porDia };
  cfg.equipesAtivasPeriodo = { ano: ANO_TESTE, mes: 7 }; // julho, o mês do cenário
  assert.ok(Math.abs(calcularLinhas(cfg)[0].equipesRealizado - 2) < 0.0001);
});

test('equipes: "Acumulado até o mês" nunca é coberto por um mapa de um mês só', () => {
  // Somaria janeiro..julho contra um mapa que só tem julho, dando um número
  // menor sem nenhum aviso.
  const cfg = cenarioSemanas({ semanasSelecionadas: null });
  cfg.dimensao = 'equipes';
  cfg.periodo = 'acumuladoAteMes';
  cfg.equipesPorDia = { 'SUP-0001-24||ST': {} };
  cfg.equipesAtivasPeriodo = { ano: ANO_TESTE, mes: 7 };
  assert.strictEqual(calcularLinhas(cfg)[0].equipesRealizado, null);
});

// --- Dimensão "Demandas" no Balanço de massa (2026-08-03) -----------------
//
// Pedido do dono do projeto: o seletor Dimensão da aba ganha uma terceira
// opção, ao lado de Financeiro/Volumetria. A pergunta que ela responde é
// diferente das outras duas: Volumetria compara o que foi EXECUTADO (furos
// concluídos, evento sondagemRealizada) contra o previsto; Demandas compara o
// que CHEGOU (evento chegada) contra o mesmo previsto de volume -- "estamos
// recebendo mais ou menos demanda do que planejamos atender?".
//
// Duas consequências que a implementação tem de respeitar:
//   - a base é o previsto de VOLUME (furos), não uma coluna própria: a MATRIZ
//     não tem previsão de demanda separada, e furo previsto é a grandeza
//     comparável;
//   - o Realizado vem SEMPRE do Avanço Sond, em qualquer período -- ao
//     contrário de volume/financeiro, que só usam a planilha em Mês Vigente.
//     Não existe coluna de demandas na MATRIZ pra servir de fallback em
//     Acumulado até o mês; cair nela devolveria o número de outra grandeza.

function demandasComChegadas(chave, dias) {
  var porRegistroEventos = {};
  porRegistroEventos[chave] = { chegada: dias, saidaEstoque: [], sondagemRealizada: [] };
  return { porRegistroEventos: porRegistroEventos };
}

test('dimensão demandas: Realizado conta as CHEGADAS do Avanço Sond, não os furos concluídos', () => {
  const cfg = Object.assign(cenario({ previstoVol: 100, realizadoVol: 999 }), {
    dimensao: 'demandas',
    demandas: {
      porRegistroEventos: {
        'SUP-0001-24||ST': {
          chegada: [diaJul(2), diaJul(9), diaJul(16), diaJul(23)],
          saidaEstoque: [],
          sondagemRealizada: [diaJul(3)], // executado -- NÃO pode entrar nesta dimensão
        },
      },
    },
    ano: ANO_TESTE,
  });
  const linhas = calcularLinhas(cfg);
  assert.strictEqual(linhas[0].valorRealizado, 4, '4 chegadas em julho -- o furo concluído e os 999 da MATRIZ ficam de fora');
  assert.strictEqual(linhas[0].valorBase, 100, 'a base é o Previsto de VOLUME da MATRIZ');
  assert.strictEqual(linhas[0].desvio, -96);
});

test('dimensão demandas em "Acumulado até o mês": continua contando as chegadas do Avanço Sond, nunca cai na coluna da MATRIZ', () => {
  // Volume/financeiro caem na coluna Realizado da MATRIZ fora de Mês Vigente.
  // Demandas não pode: não existe coluna de demandas lá, e a de volume
  // responderia outra pergunta.
  const cfg = Object.assign(cenario({ previstoVol: 100, realizadoVol: 999 }), {
    dimensao: 'demandas', periodo: 'acumuladoAteMes',
    demandas: demandasComChegadas('SUP-0001-24||ST', [
      diaEpoch(new Date(Date.UTC(ANO_TESTE, 2, 10))), // março
      diaJul(9),
      diaEpoch(new Date(Date.UTC(ANO_TESTE, 9, 1))),  // outubro -- fora do acumulado até julho
    ]),
    ano: ANO_TESTE,
  });
  const linhas = calcularLinhas(cfg);
  assert.strictEqual(linhas[0].valorRealizado, 2, 'março e julho entram; outubro está depois do mês selecionado');
});

test('dimensão demandas respeita o recorte por semana igual às outras dimensões', () => {
  const semanas = semanasDoMes(ANO_TESTE, VIGENTE_JULHO); // S1 = 01-05/07
  const cfg = {
    registros: [{
      sup: 'SUP-0001-24', tipologia: 'ST', tomador: 'T',
      previsto: { volume: (() => { const v = new Array(12).fill(0); v[6] = 310; return v; })(), equipes: new Array(12).fill(0), financeiro: new Array(12).fill(0) },
      realizado: { volume: new Array(12).fill(0), equipes: new Array(12).fill(0), financeiro: new Array(12).fill(0) },
      total: { volume: new Array(12).fill(0), equipes: new Array(12).fill(0), financeiro: new Array(12).fill(0) },
    }],
    indices: [0], tipologia: 'ST', base: 'previsto', dimensao: 'demandas', periodo: 'mesVigente',
    vigenteIdx: VIGENTE_JULHO, baseline: [], ano: ANO_TESTE,
    demandas: demandasComChegadas('SUP-0001-24||ST', [diaJul(2), diaJul(3), diaJul(20)]),
    semanas: semanas, semanasSelecionadas: [0],
  };
  const linhas = calcularLinhas(cfg);
  assert.strictEqual(linhas[0].valorRealizado, 2, 'só as 2 chegadas de S1 (01-05/07); a de 20/07 fica fora');
  // A base mensal (310 furos em 31 dias = 10/dia) recortada nos 5 dias de S1.
  assert.ok(Math.abs(linhas[0].valorBase - 50) < 1e-9, `esperava 50 de base em S1, veio ${linhas[0].valorBase}`);
});

test('dimensão demandas com base Previsto Inicial usa o volume do estudo, não uma coluna inexistente', () => {
  const cfg = Object.assign(cenario({
    previstoVol: 100, realizadoVol: 0, base: 'previstoInicial',
    baseline: [mkBaseline('SUP-0001-24||ST', 80, 2)],
  }), {
    dimensao: 'demandas',
    demandas: demandasComChegadas('SUP-0001-24||ST', [diaJul(4), diaJul(5)]),
    ano: ANO_TESTE,
  });
  const linhas = calcularLinhas(cfg);
  assert.strictEqual(linhas[0].semBase, false);
  assert.strictEqual(linhas[0].valorBase, 80);
  assert.strictEqual(linhas[0].desvio, -78); // 2 - 80
});

test('dimensão demandas sem o agregado de demandas fica sem dado, nunca zero -- zero seria lido como "nenhuma demanda chegou"', () => {
  const cfg = Object.assign(cenario({ previstoVol: 100, realizadoVol: 50 }), { dimensao: 'demandas', ano: ANO_TESTE });
  const linhas = calcularLinhas(cfg);
  assert.strictEqual(linhas[0].valorRealizado, null);
  assert.strictEqual(linhas[0].desvio, null);
});
