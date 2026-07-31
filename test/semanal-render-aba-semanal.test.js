'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderAbaSemanal, rotuloColunaFechamento } = require('../tools/semanal/render-aba-semanal.js');
const { diaEpoch } = require('../tools/comum/datas.js');

const ANO = 2026;
const VIGENTE_JULHO = 6; // julho tem 5 semanas (S27..S31) -- cenário principal
const VIGENTE_AGOSTO = 7; // agosto tem 4 semanas (S32..S36) -- confirma que N=4 também funciona

function registro(volumeMes) {
  const zeros = new Array(12).fill(0);
  const vol = new Array(12).fill(0); vol[VIGENTE_JULHO] = volumeMes;
  const bloco = (v) => ({ equipes: new Array(12).fill(2), volume: v, financeiro: zeros,
    equipesResumo: { pico: 2, media: 2, prod: 8, dias: 25 },
    volumeResumo: { total: volumeMes, totalInicial: volumeMes, ticket: 1 },
    financeiroResumo: { total: 0, totalInicial: 0 } });
  return { sup: 'SUP-0001-24', grupo: 'G', tomador: 'T', tipologia: 'ST',
           previsto: bloco(vol), realizado: bloco(zeros), total: bloco(zeros) };
}

test('mostra as 5 semanas de julho (mês com 5 semanas ISO) com P, R e T', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO);
  for (const s of ['S1', 'S2', 'S3', 'S4', 'S5']) assert.match(html, new RegExp(s));
  assert.doesNotMatch(html, /S6/);
  assert.match(html, /Previsto/); assert.match(html, /Realizado/); assert.match(html, /Tend/);
});

test('mostra as 4 semanas de agosto (mês com 4 semanas ISO)', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_AGOSTO, ANO);
  for (const s of ['S1', 'S2', 'S3', 'S4']) assert.match(html, new RegExp(s));
  assert.doesNotMatch(html, /S5/);
});

test('previsto de volume divide pelo número REAL de semanas do mês -- 1000/5 em julho, 800/4 em agosto', () => {
  const htmlJulho = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO);
  assert.match(htmlJulho, /<td class="num">200,00<\/td>/);

  const registroAgosto = registro(0);
  registroAgosto.previsto.volume[VIGENTE_AGOSTO] = 800;
  const htmlAgosto = renderAbaSemanal([registroAgosto], [0], ['volume'], VIGENTE_AGOSTO, ANO);
  assert.match(htmlAgosto, /<td class="num">200,00<\/td>/);
});

test('a coluna de fechamento muda de rótulo conforme a dimensão', () => {
  assert.strictEqual(rotuloColunaFechamento('volume'), 'Total');
  assert.strictEqual(rotuloColunaFechamento('financeiro'), 'Total');
  assert.strictEqual(rotuloColunaFechamento('equipes'), 'Média');
});

test('realizado e tendência ficam vazios sem demandas', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO);
  assert.match(html, /class="[^"]*sem-dado/);
});

test('com uma dimensão só, renderiza exatamente 1 bloco/tabela', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO);
  assert.equal((html.match(/<div class="bloco-dimensao-semanal">/g) || []).length, 1);
  assert.equal((html.match(/<table class="tabela-semanal">/g) || []).length, 1);
});

test('com várias dimensões marcadas, renderiza um bloco por dimensão, na ordem recebida', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['equipes', 'volume', 'financeiro'], VIGENTE_JULHO, ANO);
  const blocos = html.split('<div class="bloco-dimensao-semanal">').slice(1);
  assert.equal(blocos.length, 3);
  assert.match(blocos[0], /<div class="tabela-semanal-titulo">Equipes<\/div>/);
  assert.match(blocos[1], /<div class="tabela-semanal-titulo">Volume<\/div>/);
  assert.match(blocos[2], /<div class="tabela-semanal-titulo">Financeiro<\/div>/);
  assert.match(blocos[0], />Média<\/th>/);
  assert.match(blocos[1], />Total<\/th>/);
  assert.match(blocos[2], />Total<\/th>/);
});

test('título do bloco escapa o rótulo da dimensão', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO);
  assert.match(html, /<div class="tabela-semanal-titulo">Volume<\/div>/);
});

test('sem o 6º parâmetro, o comportamento é o mesmo de sem demandas -- Realizado/Tendência sem-dado, sem linha de Pendentes', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO);
  assert.doesNotMatch(html, /Demandas Pendentes/);
  const linhasSemDado = (html.match(/class="num sem-dado"/g) || []).length;
  assert.strictEqual(linhasSemDado, 10, '5 semanas (julho) x 2 linhas (Realizado + Tendência)');
});

test('com demandas SEM a chave porRegistroEventos, o comportamento fica idêntico ao de sem demandas', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO,
    { demandas: { tipologias: [], totais: {} }, hojeEpoch: diaEpoch(new Date(Date.UTC(2026, 6, 15))) });
  assert.doesNotMatch(html, /Demandas Pendentes/, 'demandas.porRegistroEventos é undefined -- diferente de {} vazio, que é um agregado real');
});

test('com demandas.porRegistroEventos presente mas vazio ({}), a linha Demandas Pendentes aparece com zero, não fica escondida', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO,
    { demandas: { porRegistroEventos: {} }, hojeEpoch: diaEpoch(new Date(Date.UTC(2026, 6, 15))) });
  assert.match(html, /Demandas Pendentes/, 'porRegistroEventos:{} é um agregado real (zero furos casaram) -- a linha aparece, mostrando 0');
  const linhaPendentes = html.match(/<tr class="linha-serie-semanal linha-pendentes-demandas">[\s\S]*?<\/tr>/)[0];
  assert.match(linhaPendentes, /celula-total-linha">0,00/);
});

// --- Cenário principal: julho de 2026 (5 semanas: S27 29/06-05/07, S28
// 06/07-12/07, S29 13/07-19/07, S30 20/07-26/07, S31 27/07-02/08), hoje =
// 15/07 (dentro de S29 -- semana em curso, índice 2 0-based). -----------

function diaJul(dia) { return diaEpoch(new Date(Date.UTC(2026, 6, dia))); }
const HOJE_15_JUL = diaJul(15);

test('Realizado semanal: semana fechada soma o intervalo inteiro, semana em curso soma só até hoje, semana futura é 0 -- valores exatos [2,3,1,0,0] e fechamento 6', () => {
  const eventos = {
    sondagemRealizada: [
      diaJul(1), diaJul(1),
      diaJul(8), diaJul(8), diaJul(8),
      diaJul(14),
      diaJul(18),
      diaJul(22), diaJul(22), diaJul(22), diaJul(22), diaJul(22),
      diaJul(28), diaJul(28), diaJul(28), diaJul(28),
    ],
    saidaEstoque: [], chegada: [],
  };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  const html = renderAbaSemanal([registro(0)], [0], ['volume'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL });
  const linhaRealizado = html.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
  const numeros = linhaRealizado.match(/<td class="num[^"]*">([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  assert.deepStrictEqual(numeros, ['2,00', '3,00', '1,00', '0,00', '0,00', '6,00']);
});

test('Realizado/Tendência de Financeiro pesa cada furo pelo ticket médio do registro -- mesmos furos do teste de Volume acima, multiplicados pelo ticket', () => {
  const eventos = {
    sondagemRealizada: [
      diaJul(1), diaJul(1),
      diaJul(8), diaJul(8), diaJul(8),
      diaJul(14),
      diaJul(18),
      diaJul(22), diaJul(22), diaJul(22), diaJul(22), diaJul(22),
      diaJul(28), diaJul(28), diaJul(28), diaJul(28),
    ],
    saidaEstoque: [], chegada: [],
  };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  const registroTicket250 = registro(0);
  registroTicket250.previsto.volumeResumo.ticket = 250;
  const html = renderAbaSemanal([registroTicket250], [0], ['financeiro'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL });
  const linhaRealizado = html.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
  const numeros = linhaRealizado.match(/<td class="num[^"]*">([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  // Furos [2,3,1,0,0] (fechamento 6) x ticket 250 = [500,750,250,0,0], fechamento 1.500.
  assert.deepStrictEqual(numeros, ['500,00', '750,00', '250,00', '0,00', '0,00', '1.500,00']);
});

test('Realizado de Financeiro soma por registro (furos daquele registro x SEU ticket), não soma os furos todos e multiplica por uma média geral', () => {
  const eventosAlfa = { sondagemRealizada: [diaJul(1), diaJul(1)], saidaEstoque: [], chegada: [] }; // 2 furos
  const eventosBeta = { sondagemRealizada: [diaJul(1)], saidaEstoque: [], chegada: [] }; // 1 furo
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventosAlfa, 'SUP-0002-24||SP': eventosBeta } };
  const registroAlfa = registro(0);
  registroAlfa.previsto.volumeResumo.ticket = 100; // 2 furos x 100 = 200
  const registroBeta = registro(0);
  registroBeta.sup = 'SUP-0002-24'; registroBeta.tipologia = 'SP';
  registroBeta.previsto.volumeResumo.ticket = 1000; // 1 furo x 1000 = 1.000
  const html = renderAbaSemanal([registroAlfa, registroBeta], [0, 1], ['financeiro'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL });
  const linhaRealizado = html.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
  // Soma correta por registro: 200 (Alfa) + 1.000 (Beta) = 1.200 na 1ª semana.
  // Se fosse "somar furos (3) x ticket médio ((100+1000)/2=550)" daria 1.650 -- errado.
  assert.match(linhaRealizado, /<td class="num">1\.200,00<\/td>/);
});

test('registro sem TICKET cadastrado (0 ou ausente) não contribui R$ nenhum em Financeiro, mesmo com furos reais -- mesma regra do orçamento', () => {
  const eventos = { sondagemRealizada: [diaJul(1), diaJul(1)], saidaEstoque: [], chegada: [] };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  const registroSemTicket = registro(0);
  registroSemTicket.previsto.volumeResumo.ticket = 0;
  const html = renderAbaSemanal([registroSemTicket], [0], ['financeiro'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL });
  const linhaRealizado = html.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
  assert.doesNotMatch(linhaRealizado, /sem-dado/, 'ainda é dado real (zero R$), não ausência de dado');
  assert.match(linhaRealizado, /<td class="num">0,00<\/td>/);
});

test('Tendência: semanas fechada/em-curso usam o Realizado real, futuras dividem igualmente o saldo restante do Previsto', () => {
  const eventos = {
    sondagemRealizada: [diaJul(1), diaJul(1), diaJul(8), diaJul(8), diaJul(8), diaJul(14)],
    saidaEstoque: [], chegada: [],
  };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  // Previsto do mês = 1000. Realizado até agora (S27+S28+S29 parcial) = 2+3+1 = 6.
  // 2 semanas futuras (S30, S31): saldoRestante = 1000 - 6 = 994, /2 = 497 cada.
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL });
  const linhaTendencia = html.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
  const numeros = linhaTendencia.match(/<td class="num[^"]*">([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  assert.deepStrictEqual(numeros, ['2,00', '3,00', '1,00', '497,00', '497,00', '1.000,00']);
});

test('Tendência nunca fica negativa quando o Realizado já passou o Previsto -- continua no ritmo já realizado', () => {
  const eventos = {
    // 20 furos concentrados em S27+S28: realizado até agora bem acima do Previsto.
    sondagemRealizada: new Array(10).fill(diaJul(1)).concat(new Array(10).fill(diaJul(8))),
    saidaEstoque: [], chegada: [],
  };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  const html = renderAbaSemanal([registro(5)], [0], ['volume'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL });
  const linhaTendencia = html.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
  assert.doesNotMatch(linhaTendencia, />-/, 'nenhum valor negativo -- ">-" isola número negativo dos hífens em nomes de classe');
  // realizadoAteAgora (S27+S28+S29) = 10+10+0 = 20; ritmo = 20/3 semanas elapsadas.
  const ritmo = (20 / 3).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const numeros = linhaTendencia.match(/<td class="num[^"]*">([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  assert.strictEqual(numeros[3], ritmo, 'semana futura S30 continua no ritmo médio já realizado');
  assert.strictEqual(numeros[4], ritmo, 'semana futura S31 idem');
});

test('Tendência: na última semana do mês (sem semana futura), os números batem exatamente com Realizado', () => {
  const eventos = {
    sondagemRealizada: [diaJul(1), diaJul(8), diaJul(14), diaJul(22), diaJul(29)],
    saidaEstoque: [], chegada: [],
  };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: diaJul(31) }); // dentro de S31, a última
  const linhaTendencia = html.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
  const linhaRealizado = html.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
  const numerosTendencia = linhaTendencia.match(/<td class="num[^"]*">[^<]*<\/td>/g);
  const numerosRealizado = linhaRealizado.match(/<td class="num[^"]*">[^<]*<\/td>/g);
  assert.deepStrictEqual(numerosTendencia, numerosRealizado);
});

test('Demandas Pendentes: semana fechada mostra o saldo no domingo daquela semana, semana em curso mostra o saldo de hoje, semana futura fica sem-dado', () => {
  const eventos = {
    chegada: new Array(10).fill(diaJul(-30)), // 10 furos, todos chegados antes de julho
    saidaEstoque: [diaJul(2), diaJul(2), diaJul(9)], // 2 saem durante S27, 1 durante S28
    sondagemRealizada: [],
  };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  const html = renderAbaSemanal([registro(0)], [0], ['volume'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL });
  const linhaPendentes = html.match(/<tr class="linha-serie-semanal linha-pendentes-demandas">[\s\S]*?<\/tr>/)[0];
  const celulas = linhaPendentes.match(/<td class="num[^"]*"[^>]*>([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  // S27 fim (05/07): 10 chegaram - 2 saíram = 8. S28 fim (12/07): 10-3=7.
  // S29 (em curso, hoje 15/07): 10-3=7 (nenhuma saída nova entre 09/07 e 15/07).
  // S30/S31 (futuras): sem-dado (célula vazia). 6º elemento é o fechamento
  // (celula-total-linha também casa com o regex "num[^\"]*") -- sempre o
  // saldo de hoje, 7,00.
  assert.deepStrictEqual(celulas, ['8,00', '7,00', '7,00', '', '', '7,00']);
  assert.match(linhaPendentes, /celula-total-linha">7,00/, 'fechamento é sempre o saldo de hoje, calculado direto');
});

test('registro cuja combinação (sup, tipologia) não existe em demandas.porRegistroEventos contribui 0, não é excluído da soma', () => {
  const demandas = { porRegistroEventos: { 'SUP-0002-24||ST': { sondagemRealizada: [diaJul(1)], saidaEstoque: [], chegada: [] } } };
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL }); // registro é SUP-0001-24, não bate
  const linhaRealizado = html.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
  assert.doesNotMatch(linhaRealizado, /sem-dado/, '"sem furo" é uma contagem real (0), não uma lacuna');
  assert.match(linhaRealizado, /<td class="num">0,00<\/td>/);
});

test('Realizado/Tendência aparecem em Volume E Financeiro (Financeiro pesado pelo ticket médio); Equipes nunca ativa; Demandas Pendentes continua exclusivo do Volume', () => {
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': { sondagemRealizada: [diaJul(1)], saidaEstoque: [], chegada: [] } } };
  const html = renderAbaSemanal([registro(1000)], [0], ['equipes', 'financeiro'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL });
  assert.doesNotMatch(html, /Demandas Pendentes/, 'Pendentes é estoque de furos, sem análogo em R$ -- exclusivo do Volume');
  const blocoEquipes = html.split('<div class="bloco-dimensao-semanal">')[1];
  const blocoFinanceiro = html.split('<div class="bloco-dimensao-semanal">')[2];
  const semDadoEquipes = (blocoEquipes.match(/class="num sem-dado"/g) || []).length;
  assert.strictEqual(semDadoEquipes, 10, 'Equipes: 5 semanas x 2 linhas (Realizado + Tendência), nunca ativa -- não é furo, não tem ticket');
  assert.doesNotMatch(blocoFinanceiro, /sem-dado/, 'Financeiro: Realizado/Tendência ativos (ticket médio 1 na fixture registro(), mesmos números de furos que Volume mostraria)');
});

test('Tendência não fabrica projeção nos dias de "fim de mês" -- quando as semanas do mês já fecharam e hoje já caiu numa semana de fronteira do mês seguinte, Tendência continua igual a Realizado', () => {
  // Setembro de 2026 (mesIndex=8) tem 4 semanas próprias: 31/08-06/09,
  // 07-13/09, 14-20/09, 21-27/09 -- a última termina no domingo 27/09.
  // Achado da revisão final: indiceSemanaAtual devolve -1 tanto no INÍCIO
  // do mês (nenhuma semana começou) quanto no FIM (todas já fecharam, hoje
  // já é 28+/09, que pertence à 1ª semana de outubro pela regra da
  // maioria) -- calcularTendenciaSemanal tratava os dois como "nenhuma
  // semana elapsada", fabricando uma projeção sobre um mês que já acabou.
  function diaSet(dia) { return diaEpoch(new Date(Date.UTC(2026, 8, dia))); }
  const eventos = [].concat(
    new Array(50).fill(diaSet(2)), new Array(50).fill(diaSet(9)),
    new Array(50).fill(diaSet(16)), new Array(50).fill(diaSet(23))
  ); // 200 furos reais, 50/semana -- Previsto do mês = 1000
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': { chegada: [], sondagemRealizada: eventos, saidaEstoque: [] } } };
  const registroSetembro = registro(0);
  registroSetembro.previsto.volume[8] = 1000;

  for (const hojeDia of [28, 30]) { // 28 e 30/09: depois que a 4ª semana já fechou (27/09)
    const html = renderAbaSemanal([registroSetembro], [0], ['volume'], 8, ANO, { demandas, hojeEpoch: diaSet(hojeDia) });
    const linhaRealizado = html.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
    const linhaTendencia = html.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
    const numerosRealizado = linhaRealizado.match(/<td class="num[^"]*">[^<]*<\/td>/g);
    const numerosTendencia = linhaTendencia.match(/<td class="num[^"]*">[^<]*<\/td>/g);
    assert.deepStrictEqual(numerosTendencia, numerosRealizado,
      `dia ${hojeDia}/09: com o mês inteiro já fechado, Tendência precisa mostrar os mesmos números que Realizado (200,00 no total), não fabricar 1.000,00`);
  }
});

test('vigenteIdx fora do intervalo do ano (12 ou -1): Realizado/Tendência ficam sem-dado, mas Demandas Pendentes ainda mostra o fechamento -- saldo de hoje independe do mês sendo exibido', () => {
  const eventos = { chegada: [diaJul(1)], saidaEstoque: [], sondagemRealizada: [diaJul(10)] };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], 12, ANO, { demandas, hojeEpoch: HOJE_15_JUL });

  const linhaRealizado = html.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
  assert.match(linhaRealizado, /class="num sem-dado"/, 'Realizado sem-dado quando vigenteIdx é inválido');

  const linhaPendentes = html.match(/<tr class="linha-serie-semanal linha-pendentes-demandas">[\s\S]*?<\/tr>/)[0];
  const semDadoNaLinha = (linhaPendentes.match(/class="num sem-dado"/g) || []).length;
  assert.strictEqual(semDadoNaLinha, 4, 'sem mês vigente válido não há semanas reais -- cai no fallback de 4 colunas, todas sem-dado');
  assert.match(linhaPendentes, /celula-total-linha">1,00/, 'fechamento continua mostrando o saldo de hoje: 1 chegada, 0 saídas até 15/07');
});
