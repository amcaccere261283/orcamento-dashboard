'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderAbaSemanal, rotuloColunaFechamento, calcularSeriesSemanaisDimensao } = require('../tools/semanal/render-aba-semanal.js');
const { diaEpoch } = require('../tools/comum/datas.js');
const { semanasDoMes, indiceSemanaAtual } = require('../tools/semanal/compute-semanal.js');

const ANO = 2026;
const VIGENTE_JULHO = 6; // julho tem 5 semanas (S1..S5, corte sempre dentro do mês) -- cenário principal
const VIGENTE_AGOSTO = 7; // agosto tem 6 semanas (S1..S6, mês começa num sábado) -- confirma que N != 5 também funciona

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

test('mostra as 5 semanas de julho (mês com corte sempre dentro do mês) com P, R e T', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO);
  for (const s of ['S1', 'S2', 'S3', 'S4', 'S5']) assert.match(html, new RegExp(s));
  assert.doesNotMatch(html, /S6/);
  assert.match(html, /Previsto/); assert.match(html, /Realizado/); assert.match(html, /Tend/);
});

test('cabeçalho mostra o intervalo de datas de cada semana ao lado do rótulo -- "S1 (01/07 a 05/07)"', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO);
  assert.match(html, /<th>S1 \(01\/07 a 05\/07\)<\/th>/);
  assert.match(html, /<th>S2 \(06\/07 a 12\/07\)<\/th>/);
  assert.match(html, /<th>S3 \(13\/07 a 19\/07\)<\/th>/);
  assert.match(html, /<th>S4 \(20\/07 a 26\/07\)<\/th>/);
  assert.match(html, /<th>S5 \(27\/07 a 31\/07\)<\/th>/);
});

test('sem mês vigente válido, o cabeçalho cai no fallback "Sn" puro -- não há semana real pra descrever', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], 12, ANO); // vigenteIdx inválido
  assert.match(html, /<th>S1<\/th>/);
  assert.doesNotMatch(html, /S1 \(/);
});

test('mostra as 6 semanas de agosto (mês que começa num sábado -- confirma que N != 5 também funciona)', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_AGOSTO, ANO);
  for (const s of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']) assert.match(html, new RegExp(s));
  assert.doesNotMatch(html, /S7/);
});

test('previsto de volume reparte proporcionalmente aos DIAS de cada semana, não em fatias iguais por número de semana -- julho (5+7+7+7+5=31 dias) e agosto (2+7+7+7+7+1=31 dias)', () => {
  // Julho: 1000 / 31 dias x [5,7,7,7,5] = [161,29; 225,81; 225,81; 225,81; 161,29],
  // arredondado pro inteiro pelo maior resto (2026-08-03) -> [161, 226, 226, 226, 161],
  // que soma 1000 exatamente. S1 e S5 (semanas de borda, 5 dias) recebem menos que
  // S2-S4 (semana cheia, 7 dias) -- ao contrário da divisão igual antiga, que dava
  // 200 pras 5.
  const htmlJulho = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO);
  const linhaPrevistoJulho = htmlJulho.match(/<tr class="linha-serie-semanal linha-previsto">[\s\S]*?<\/tr>/)[0];
  const numerosJulho = linhaPrevistoJulho.match(/<td class="num[^"]*">([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  assert.deepStrictEqual(numerosJulho, ['161', '226', '226', '226', '161', '1.000']);

  // Agosto: 1200 / 31 dias x [2,7,7,7,7,1] -- S1 (2 dias) e S6 (1 dia) recebem
  // bem menos que as 4 semanas cheias -- é o exemplo que motivou o ajuste
  // (S1 tinha 2 dias e S6 só 1, mas as duas recebiam a mesma fatia que uma
  // semana cheia de 7 dias na divisão igual antiga).
  const registroAgosto = registro(0);
  registroAgosto.previsto.volume[VIGENTE_AGOSTO] = 1200;
  const htmlAgosto = renderAbaSemanal([registroAgosto], [0], ['volume'], VIGENTE_AGOSTO, ANO);
  const linhaPrevistoAgosto = htmlAgosto.match(/<tr class="linha-serie-semanal linha-previsto">[\s\S]*?<\/tr>/)[0];
  const numerosAgosto = linhaPrevistoAgosto.match(/<td class="num[^"]*">([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  assert.deepStrictEqual(numerosAgosto, ['77', '271', '271', '271', '271', '39', '1.200']);
});

// Pedido do dono do projeto (2026-08-03): "no previsto semanal, sempre deixar
// numeros inteiros e ajustar semanalmente para nao superar o total do mês".
test('a linha Previsto nunca mostra casa decimal nem soma mais que o total do mês, em qualquer mês e com total quebrado', () => {
  for (const mesIdx of [0, 1, 6, 7, 11]) {
    for (const total of [1000.9, 7, 12345.67]) {
      const reg = registro(0);
      reg.previsto.volume[mesIdx] = total;
      const html = renderAbaSemanal([reg], [0], ['volume'], mesIdx, ANO);
      const linha = html.match(/<tr class="linha-serie-semanal linha-previsto">[\s\S]*?<\/tr>/)[0];
      const celulas = linha.match(/<td class="num[^"]*">([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
      celulas.forEach((c) => assert.ok(!c.includes(','), `mês ${mesIdx}, total ${total}: "${c}" tem casa decimal`));
      const semanas = celulas.slice(0, -1).map((c) => Number(c.replace(/\./g, '')));
      const soma = semanas.reduce((a, b) => a + b, 0);
      assert.ok(soma <= total, `mês ${mesIdx}, total ${total}: a soma das semanas (${soma}) superou o mês`);
      // A coluna de fechamento mostra a soma que está na tela, não o total
      // cru -- a linha fecha na conta que dá pra conferir somando as células.
      assert.strictEqual(Number(celulas[celulas.length - 1].replace(/\./g, '')), soma);
    }
  }
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

// --- Cenário principal: julho de 2026 (5 semanas, corte sempre dentro do
// mês: S1 01/07-05/07, S2 06/07-12/07, S3 13/07-19/07, S4 20/07-26/07, S5
// 27/07-31/07), hoje = 15/07 (dentro de S3 -- semana em curso, índice 2
// 0-based). --------------------------------------------------------------

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
  // Desde 2026-08-04, financeiro sai inteiro (sem casa decimal).
  assert.deepStrictEqual(numeros, ['500', '750', '250', '0', '0', '1.500']);
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
  // Desde 2026-08-04, financeiro sai inteiro (sem casa decimal).
  assert.match(linhaRealizado, /<td class="num">1\.200<\/td>/);
});

test('registro sem TICKET cadastrado (0 ou ausente) não contribui R$ nenhum em Financeiro, mesmo com furos reais -- mesma regra do orçamento', () => {
  const eventos = { sondagemRealizada: [diaJul(1), diaJul(1)], saidaEstoque: [], chegada: [] };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  const registroSemTicket = registro(0);
  registroSemTicket.previsto.volumeResumo.ticket = 0;
  const html = renderAbaSemanal([registroSemTicket], [0], ['financeiro'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL });
  const linhaRealizado = html.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
  assert.doesNotMatch(linhaRealizado, /sem-dado/, 'ainda é dado real (zero R$), não ausência de dado');
  // Desde 2026-08-04, financeiro sai inteiro (sem casa decimal).
  assert.match(linhaRealizado, /<td class="num">0<\/td>/);
});

test('Tendência: só semanas TOTALMENTE fechadas ficam sem-dado (o Realizado já mostra o fato, não precisa duplicar); a semana VIGENTE projeta seu próprio total, e as futuras dividem o saldo restante do Previsto PROPORCIONALMENTE AOS DIAS de cada uma', () => {
  const eventos = {
    sondagemRealizada: [diaJul(1), diaJul(1), diaJul(8), diaJul(8), diaJul(8), diaJul(14)],
    saidaEstoque: [], chegada: [],
  };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  // Previsto do mês = 1000. Realizado até agora (S1+S2+S3 parcial) = 2+3+1 = 6.
  // S1/S2 estão TOTALMENTE fechadas (fim < hoje=15/07) e ficam sem-dado na
  // linha Tendência -- mostrar o mesmo número que a linha Realizado já
  // mostra só duplicaria. S3 é a semana VIGENTE (hoje, 15/07, está dentro
  // dela, ainda em curso): projeta o TOTAL da semana = seu Realizado
  // parcial (1) + o ritmo médio nos 4 dias que ainda faltam dela
  // (achado de 2026-08-03 -- mostrar só o Realizado parcial da vigente
  // criava um degrau irreal no 1º dia de uma semana nova). dias restantes:
  // S1 fechada (5d), S2 fechada (7d), S3 elapsados=3d de 7 (15-13+1) ->
  // restam 4d; diasElapsados=5+7+3=15, diasFuturos=4(resto de S3)+7(S4)+5(S5)=16;
  // ritmoPorDia = 6/15 = 0,4. saldoRestante = 1000-6 = 994.
  // S3 = 1 + 994*4/16 = 1 + 248,5 = 249,50.
  // S4 = 994*7/16 = 434,875 -> 434,88; S5 = 994*5/16 = 310,625 -> 310,63.
  // Soma (Fechamento) continua batendo com o mês inteiro: 1.000,00.
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL });
  const linhaTendencia = html.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
  const numeros = linhaTendencia.match(/<td class="num[^"]*">([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  assert.deepStrictEqual(numeros, ['', '', '249,50', '434,88', '310,63', '1.000,00']);
});

test('Tendência nunca fica negativa quando o Realizado já passou o Previsto -- continua no ritmo já realizado POR DIA, multiplicado pelos dias de cada semana futura', () => {
  const eventos = {
    // 20 furos concentrados em S27+S28: realizado até agora bem acima do Previsto.
    sondagemRealizada: new Array(10).fill(diaJul(1)).concat(new Array(10).fill(diaJul(8))),
    saidaEstoque: [], chegada: [],
  };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  const html = renderAbaSemanal([registro(5)], [0], ['volume'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL });
  const linhaTendencia = html.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
  assert.doesNotMatch(linhaTendencia, />-/, 'nenhum valor negativo -- ">-" isola número negativo dos hífens em nomes de classe');
  // Ramo R > P (realizadoAcumulado 20 muito acima do previstoAcumulado das
  // semanas fechadas). Desde a Task 2 (compute-tendencia-semanal.js, ver
  // Decisão 3/"O que muda em relação a hoje" da spec de 2026-08-04) o ritmo
  // sai só das semanas TOTALMENTE FECHADAS (S1+S2 = 10+10 = 20 furos, em
  // 5+7 = 12 dias), não mais incluindo os dias já passados da semana em
  // curso (S3) -- ritmoPorDia = 20/12, não mais 20/15. S4 (7 dias) =
  // 20/12*7 = 11,67; S5 (5 dias) = 20/12*5 = 8,33 -- maiores que antes
  // (9,33/6,67) porque o mesmo Realizado agora se divide por menos dias.
  const ritmoPorDia = 20 / 12;
  const fmt = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const numeros = linhaTendencia.match(/<td class="num[^"]*">([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  assert.strictEqual(numeros[3], fmt(ritmoPorDia * 7), 'semana futura S4 (7 dias) continua no ritmo médio já realizado por dia');
  assert.strictEqual(numeros[4], fmt(ritmoPorDia * 5), 'semana futura S5 (5 dias) idem, proporcional aos seus próprios dias');
});

test('Tendência: no último dia do mês (semana vigente = a última, sem dias restantes nela e sem semana futura), as 4 semanas fechadas ficam sem-dado e a última mostra sua projeção -- que coincide com seu próprio Realizado (nada mais a distribuir); o Fechamento continua batendo', () => {
  const eventos = {
    sondagemRealizada: [diaJul(1), diaJul(8), diaJul(14), diaJul(22), diaJul(29)],
    saidaEstoque: [], chegada: [],
  };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: diaJul(31) }); // dentro de S5, a última
  const linhaTendencia = html.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
  const linhaRealizado = html.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
  const numerosTendencia = linhaTendencia.match(/<td class="num[^"]*">([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  const numerosRealizado = linhaRealizado.match(/<td class="num[^"]*">([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  // S1..S4 estão TOTALMENTE fechadas (fim < 31/07) e ficam sem-dado. S5 é a
  // semana vigente (31/07 é o próprio último dia dela, fim == hoje, ainda
  // não "fechou" pela regra fim < hoje) -- mas não sobra nenhum dia pra
  // projetar (diasRestantesSemanaVigente = 0, sem semana futura), então sua
  // Tendência coincide com seu Realizado (1,00). O Fechamento (6º elemento)
  // continua igual ao do Realizado -- calculado antes da supressão, e aqui
  // nada foi projetado a mais.
  assert.deepStrictEqual(numerosTendencia, ['', '', '', '', numerosRealizado[4], numerosRealizado[5]]);
});

test('Tendência: 1º dia de uma semana nova (Realizado dela ainda zerado) não cria "degrau" -- projeta o total da semana vigente com o ritmo já visto, sem sobrecarregar as semanas seguintes', () => {
  // Cenário relatado pelo usuário em 2026-08-03: ele está no 1º dia da 2ª
  // semana de Agosto/2026 (S2, 03/08 a 09/08 -- agosto tem 6 semanas, mês
  // começa num sábado), e o Realizado desse dia ainda não chegou (fonte
  // real só atualiza depois). Sem a correção, S2 cairia no ramo das semanas
  // elapsadas e mostraria 0 (Realizado parcial), um degrau irreal -- e os 6
  // dias que faltam dela sumiam do cálculo, sobrecarregando S3/S4/S5 (acima
  // do que os 7 dias de cada uma justificam).
  const registroAgosto = registro(0);
  registroAgosto.previsto.volume[VIGENTE_AGOSTO] = 620; // Previsto do mês
  const diaAgo = (dia) => diaEpoch(new Date(Date.UTC(2026, 7, dia)));
  const eventos = {
    // 20 furos em S1 (01 e 02/08, semana TOTALMENTE fechada) -- ritmo de 10/dia.
    sondagemRealizada: new Array(20).fill(diaAgo(1)),
    saidaEstoque: [], chegada: [],
  };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  const html = renderAbaSemanal([registroAgosto], [0], ['volume'], VIGENTE_AGOSTO, ANO, { demandas, hojeEpoch: diaAgo(3) }); // 1º dia de S2

  const linhaRealizado = html.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
  const linhaTendencia = html.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
  const numerosRealizado = linhaRealizado.match(/<td class="num[^"]*">([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  const numerosTendencia = linhaTendencia.match(/<td class="num[^"]*">([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);

  // Realizado: S1 fechada mostra 20; S2 (vigente, só o 1º dia) mostra 0 --
  // é fato, não deveria mudar. S3..S6 (futuras) mostram 0 (nada aconteceu
  // ainda -- é dado real, não ausência de dado).
  assert.deepStrictEqual(numerosRealizado.slice(0, 6), ['20,00', '0,00', '0,00', '0,00', '0,00', '0,00']);

  // Tendência: S1 sem-dado (totalmente fechada, duplicaria o Realizado).
  // S2 (vigente) NÃO fica em branco nem em 0,00 -- projeta o total da
  // semana: realizadoAteAgora (20) já é fato; o saldo restante do mês
  // (620 - 20 = 600) se reparte proporcionalmente aos dias que SOBRAM (6
  // dias que faltam de S2 + 7+7+7+1 das semanas futuras = 28 dias). S2
  // fica com 0 (seu Realizado até agora) + 600 x 6/28 = 128,57. S3/S4/S5
  // (7 dias cada) ficam com 600 x 7/28 = 150,00 cada; S6 (1 dia) com
  // 600 x 1/28 = 21,43 -- nunca as 190,91 que S3/S4/S5 teriam se os 6 dias
  // de S2 tivessem sumido do cálculo (600/22 x 7), prova de que elas não
  // ficam sobrecarregadas.
  assert.deepStrictEqual(numerosTendencia.slice(0, 6), ['', '128,57', '150,00', '150,00', '150,00', '21,43']);
  assert.strictEqual(numerosTendencia[6], '620,00', 'Fechamento continua batendo com o Previsto do mês inteiro');
});

test('Tendência: indiceAtual === -1 (nenhuma semana do mês começou -- hoje antes do mês inteiro) cai no ramo "igual" (R_ac = P_ac = 0) e reproduz o Previsto inteiro, semana a semana', () => {
  const registroAgosto = registro(0);
  registroAgosto.previsto.volume[VIGENTE_AGOSTO] = 1200;
  const hojeAntesDeAgosto = diaEpoch(new Date(Date.UTC(2026, 6, 20))); // 20/07 -- antes de agosto começar (01/08)
  const demandas = { porRegistroEventos: {} }; // agregado real vazio -- ativa Realizado/Tendência, tudo fecha em 0
  const html = renderAbaSemanal([registroAgosto], [0], ['volume'], VIGENTE_AGOSTO, ANO, { demandas, hojeEpoch: hojeAntesDeAgosto });
  const linhaTendencia = html.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
  const numerosTendencia = linhaTendencia.match(/<td class="num[^"]*">([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  // Nenhuma semana fechada -> realizadoAcumulado = previstoAcumulado = 0,
  // que escolherRamo trata como 'igual' de propósito (ver
  // compute-tendencia-semanal.js e a Decisão 2 da spec de 2026-08-04: "mês
  // inteiramente no futuro... cai no ramo R = P... é o resultado certo: sem
  // passado, a melhor projeção é o plano"). No ramo 'igual' a Tendência
  // reproduz a fatia INTEIRA que a linha Previsto já mostra
  // (dividirEmSemanasInteiras), não mais a repartição fracionária crua por
  // dia -- as duas linhas têm de exibir o mesmo número ("mantém o P na T").
  // Agosto: 1200 repartido em [2,7,7,7,7,1] dias vira [77,271,271,271,271,39]
  // pelo maior resto (mesma conta que a linha Previsto já faz).
  assert.deepStrictEqual(numerosTendencia, ['77,00', '271,00', '271,00', '271,00', '271,00', '39,00', '1.200,00'],
    'sem nenhuma semana fechada, o ramo é "igual" e a Tendência reproduz exatamente a fatia inteira do Previsto em cada semana');
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
  // S1 fim (05/07): 10 chegaram - 2 saíram = 8. S2 fim (12/07): 10-3=7.
  // S3 (em curso, hoje 15/07): 10-3=7 (nenhuma saída nova entre 09/07 e 15/07).
  // S4/S5 (futuras): sem-dado (célula vazia). 6º elemento é o fechamento
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
  const linhaRealizadoFinanceiro = blocoFinanceiro.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
  const linhaTendenciaFinanceiro = blocoFinanceiro.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
  assert.doesNotMatch(linhaRealizadoFinanceiro, /sem-dado/, 'Realizado ativo em todas as semanas (ticket médio 1 na fixture registro(), mesmos números de furos que Volume mostraria)');
  // Tendência: só S1/S2 estão TOTALMENTE fechadas (fim < hoje=15/07) e
  // ficam sem-dado -- só duplicariam o Realizado. S3 é a semana vigente
  // (hoje está dentro dela) e mostra sua projeção; S4/S5 (futuras) também.
  const semDadoTendenciaFinanceiro = (linhaTendenciaFinanceiro.match(/class="num sem-dado"/g) || []).length;
  assert.strictEqual(semDadoTendenciaFinanceiro, 2, 'Tendência: só as 2 semanas TOTALMENTE fechadas (S1/S2) ficam sem-dado; S3 (vigente)/S4/S5 mostram projeção');
});

test('Tendência não fabrica projeção quando hoje está depois do último dia do mês vigente (contrato defensivo)', () => {
  // Com o corte sempre dentro do mês (2026-08-01), as semanas de um mês
  // cobrem TODOS os seus dias sem lacuna -- o "dia de fronteira" que fazia
  // indiceSemanaAtual devolver -1 no fim do mês (achado da revisão final da
  // branch anterior) não ocorre mais em uso real, porque o último dia do
  // mês SEMPRE fecha dentro da última semana do próprio mês. O código
  // continua defensivo mesmo assim (semanasElapsadas conta pelas datas, não
  // por indiceAtual) -- este teste prova isso passando um hoje FORA do mês
  // vigente de propósito (não acontece no fluxo real, onde hoje e
  // vigenteIdx vêm sempre do mesmo relógio -- ver render-semanal.js).
  const eventos = { sondagemRealizada: [diaJul(1), diaJul(8), diaJul(14), diaJul(22), diaJul(29)], saidaEstoque: [], chegada: [] };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  const hojeEmAgosto = diaEpoch(new Date(Date.UTC(2026, 7, 15))); // bem depois do fim de julho (31/07)

  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: hojeEmAgosto });
  const linhaTendencia = html.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
  const numerosTendencia = linhaTendencia.match(/<td class="num[^"]*">([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  // Com julho inteiro já no passado (regra 2.1/"sem-dado" de
  // compute-tendencia-semanal.js, Decisão 2 da spec de 2026-08-04), todas as
  // 5 colunas de Tendência ficam sem-dado -- nenhuma semana futura pra
  // projetar -- e desde a Task 2 o Fechamento TAMBÉM vira null (antes
  // repetia o Total do Realizado, que é exatamente a duplicação que o
  // pedido veio eliminar; ver fechamentoTendencia em
  // calcularSeriesSemanaisDimensao).
  assert.deepStrictEqual(numerosTendencia, ['', '', '', '', '', '']);
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

const SEMANAS_JULHO = semanasDoMes(ANO, VIGENTE_JULHO);
const DEMANDAS_JULHO = {
  porRegistroEventos: {
    'SUP-0001-24||ST': { sondagemRealizada: [diaJul(2), diaJul(8), diaJul(14)], chegada: [], saidaEstoque: [] },
  },
};

// O registro base do arquivo só carrega volume; para exercitar o financeiro
// basta preencher o mês vigente dele.
function registroFinanceiro(financeiroMes) {
  const r = registro(0);
  r.previsto.financeiro = new Array(12).fill(0);
  r.previsto.financeiro[VIGENTE_JULHO] = financeiroMes;
  r.previsto.volumeResumo = { total: 0, totalInicial: 0, ticket: 250 };
  return r;
}

test('financeiro sai inteiro nas tres linhas da Tabela Semanal', () => {
  const html = renderAbaSemanal([registroFinanceiro(123456)], [0], ['financeiro'], VIGENTE_JULHO, ANO,
    { demandas: DEMANDAS_JULHO, hojeEpoch: HOJE_15_JUL });
  const numeros = html.match(/<td class="num[^"]*">[\d.,]+<\/td>/g) || [];
  assert.ok(numeros.length > 0, 'a fixture precisa produzir celulas numericas');
  numeros.forEach((td) => assert.ok(!/,\d/.test(td), 'financeiro nao pode ter casa decimal: ' + td));
});

test('equipes continua com duas casas -- e media ponderada, nao valor financeiro', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['equipes'], VIGENTE_JULHO, ANO, {});
  assert.ok(/,\d\d</.test(html), 'equipes tem de manter as 2 casas');
});

test('mes inteiramente no passado: Tendencia sem dado ate no fechamento', () => {
  const hojeAgosto = diaEpoch(new Date(Date.UTC(2026, 7, 10)));
  const series = calcularSeriesSemanaisDimensao(
    [registro(1000)], [0], 'volume', VIGENTE_JULHO, SEMANAS_JULHO, SEMANAS_JULHO.length,
    true, indiceSemanaAtual(SEMANAS_JULHO, hojeAgosto), DEMANDAS_JULHO, hojeAgosto
  );
  assert.strictEqual(series.fechamentoTendencia, null, 'o Total nao pode repetir o Realizado');
  series.semanasTendencia.forEach((v) => assert.strictEqual(v, null));
  series.semanasTendenciaCompleta.forEach((v) => assert.strictEqual(v, null));
  assert.strictEqual(series.ramoTendencia, 'sem-dado');
  assert.strictEqual(series.diagnosticoTendencia, null);
});

test('mes corrente: o fechamento da Tendencia continua sendo o mes projetado, e o ramo vem junto', () => {
  const series = calcularSeriesSemanaisDimensao(
    [registro(1000)], [0], 'volume', VIGENTE_JULHO, SEMANAS_JULHO, SEMANAS_JULHO.length,
    true, indiceSemanaAtual(SEMANAS_JULHO, HOJE_15_JUL), DEMANDAS_JULHO, HOJE_15_JUL
  );
  assert.ok(series.fechamentoTendencia !== null, 'mes em curso tem projecao');
  assert.ok(['igual', 'acima', 'abaixo'].indexOf(series.ramoTendencia) !== -1);
  assert.ok(series.diagnosticoTendencia !== null);
  const somaCompleta = series.semanasTendenciaCompleta.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(somaCompleta - series.fechamentoTendencia) < 1e-9,
    'o fechamento tem de ser a soma da serie completa -- e o invariante da curva Acumulada');
});
