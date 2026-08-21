'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderAbaSemanal, rotuloColunaFechamento, calcularSeriesSemanaisDimensao, formatarFinanceiroMilhares } = require('../tools/semanal/render-aba-semanal.js');
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
  assert.match(blocos[2], /<div class="tabela-semanal-titulo">Financeiro \(mil R\$\)<\/div>/);
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
  assert.match(linhaPendentes, /celula-total-linha">0</);
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
  assert.deepStrictEqual(numeros, ['2', '3', '1', '0', '0', '6']);
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
  const registroTicket250Mil = registro(0);
  // Ticket 250.000 (não 250): desde 2026-08-07 financeiro sai em milhares
  // truncados (formatarFinanceiroMilhares), e um ticket pequeno faria as 5
  // semanas colapsarem todas em "0" -- indistinguível umas das outras. Um
  // ticket maior preserva a resolução que este teste precisa pra provar a
  // distribuição por semana, sem mudar o que está sendo testado.
  registroTicket250Mil.previsto.volumeResumo.ticket = 250000;
  const html = renderAbaSemanal([registroTicket250Mil], [0], ['financeiro'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL });
  const linhaRealizado = html.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
  const numeros = linhaRealizado.match(/<td class="num[^"]*">([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  // Furos [2,3,1,0,0] (fechamento 6) x ticket 250.000 = [500000,750000,250000,0,0],
  // fechamento 1.500.000. Desde 2026-08-07, financeiro sai em milhares truncados,
  // sem sufixo: /1000 -> [500,750,250,0,0], fechamento 1.500.
  assert.deepStrictEqual(numeros, ['500', '750', '250', '0', '0', '1.500']);
});

test('Realizado de Financeiro soma por registro (furos daquele registro x SEU ticket), não soma os furos todos e multiplica por uma média geral', () => {
  const eventosAlfa = { sondagemRealizada: [diaJul(1), diaJul(1)], saidaEstoque: [], chegada: [] }; // 2 furos
  const eventosBeta = { sondagemRealizada: [diaJul(1)], saidaEstoque: [], chegada: [] }; // 1 furo
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventosAlfa, 'SUP-0002-24||SP': eventosBeta } };
  const registroAlfa = registro(0);
  // Tickets x1000 em relação à versão original do teste (100/1.000): desde
  // 2026-08-07 financeiro trunca em milhares (formatarFinanceiroMilhares), e
  // R$1.200 colapsaria em "0" -- indistinguível de errado. Mantém a mesma
  // proporção 200/1.000 que o teste precisa provar, só numa faixa que sobra
  // dado depois de dividir por 1.000.
  registroAlfa.previsto.volumeResumo.ticket = 100000; // 2 furos x 100.000 = 200.000
  const registroBeta = registro(0);
  registroBeta.sup = 'SUP-0002-24'; registroBeta.tipologia = 'SP';
  registroBeta.previsto.volumeResumo.ticket = 1000000; // 1 furo x 1.000.000 = 1.000.000
  const html = renderAbaSemanal([registroAlfa, registroBeta], [0, 1], ['financeiro'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL });
  const linhaRealizado = html.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
  // Soma correta por registro: 200.000 (Alfa) + 1.000.000 (Beta) = 1.200.000 na 1ª semana.
  // Se fosse "somar furos (3) x ticket médio ((100.000+1.000.000)/2=550.000)" daria
  // 1.650.000 -- errado. Desde 2026-08-07: 1.200.000 / 1.000 -> "1.200".
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
  // Desde 2026-08-07, financeiro sai em milhares truncados, sem sufixo: R$0 -> "0".
  assert.match(linhaRealizado, /<td class="num">0<\/td>/);
});

test('Tendência: só semanas TOTALMENTE fechadas ficam sem-dado (o Realizado já mostra o fato, não precisa duplicar); a semana VIGENTE projeta seu próprio total, e as futuras dividem o saldo restante do T do orçamento PROPORCIONALMENTE AOS DIAS de cada uma', () => {
  const eventos = {
    sondagemRealizada: [diaJul(1), diaJul(1), diaJul(8), diaJul(8), diaJul(8), diaJul(14)],
    saidaEstoque: [], chegada: [],
  };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  // Desde 2026-08-20 a Tendência não é mais o cálculo automático por ramo --
  // fecha sempre no T do orçamento (aqui, de propósito, igual ao Previsto:
  // T = 1000). Realizado até agora (S1+S2+S3 parcial) = 2+3+1 = 6.
  // S1/S2 estão TOTALMENTE fechadas (fim < hoje=15/07) e ficam sem-dado na
  // linha Tendência -- mostrar o mesmo número que a linha Realizado já
  // mostra só duplicaria. S3 é a semana VIGENTE: mostra seu Realizado
  // parcial (1) + a fatia do saldo (T - realizadoAcumulado - realizadoVigente
  // = 1000 - 5 - 1 = 994) proporcional aos 4 dias que ainda faltam dela, dos
  // 16 dias restantes do mês (4 de S3 + 7 de S4 + 5 de S5).
  // S3 = 1 + 994*4/16 = 249,50 -> exibido sem casa decimal: 250.
  // S4 = 994*7/16 = 434,875 -> 435; S5 = 994*5/16 = 310,625 -> 311.
  // Fechamento continua batendo com o T do mês inteiro: 1.000.
  const reg = registro(1000);
  reg.total.volume[VIGENTE_JULHO] = 1000;
  const html = renderAbaSemanal([reg], [0], ['volume'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL });
  const linhaTendencia = html.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
  const numeros = linhaTendencia.match(/<td class="num[^"]*">([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  assert.deepStrictEqual(numeros, ['', '', '250', '435', '311', '1.000']);
});

test('Tendência: sem T preenchido no orçamento (linha em branco), não projeta nada além do que já é fato -- "não executar nada naquele local"', () => {
  const eventos = {
    sondagemRealizada: [diaJul(1), diaJul(1), diaJul(8), diaJul(8), diaJul(8), diaJul(14)],
    saidaEstoque: [], chegada: [],
  };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  // Mesmo cenário do teste acima (Realizado 2+3+1), mas sem preencher
  // reg.total.volume -- fica 0 (mesma fixture-padrão de registro()), que é
  // exatamente a convenção de T ausente. S1/S2 continuam sem-dado (fato já
  // mostrado no Realizado). S3 (vigente) mostra só o próprio fato (1),
  // S4/S5 ficam em 0 -- nada é projetado a mais.
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL });
  const linhaTendencia = html.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
  const numeros = linhaTendencia.match(/<td class="num[^"]*">([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  assert.deepStrictEqual(numeros, ['', '', '1', '0', '0', '6']);
});

test('Tendência nunca fica negativa: o saldo pra fechar no T é repartido pelos dias que restam, nunca extrapola o ritmo já visto', () => {
  const eventos = {
    // 20 furos concentrados em S1+S2: realizado até agora bem acima do Previsto (5).
    sondagemRealizada: new Array(10).fill(diaJul(1)).concat(new Array(10).fill(diaJul(8))),
    saidaEstoque: [], chegada: [],
  };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  const reg = registro(5);
  reg.total.volume[VIGENTE_JULHO] = 200; // T do orçamento pro mês, bem diferente do Previsto (5)
  const html = renderAbaSemanal([reg], [0], ['volume'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL });
  const linhaTendencia = html.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
  assert.doesNotMatch(linhaTendencia, />-/, 'nenhum valor negativo -- ">-" isola número negativo dos hífens em nomes de classe');
  // realizadoAcumulado (S1+S2 fechadas) = 20; realizadoVigente (S3, nada
  // aconteceu nela ainda) = 0. saldoTendencia = 200 - 20 - 0 = 180, repartido
  // pelos 16 dias que restam do mês (4 de S3 + 7 de S4 + 5 de S5).
  // S3 = 0 + 180*4/16 = 45; S4 = 180*7/16 = 78,75 -> 79; S5 = 180*5/16 = 56,25 -> 56.
  const numeros = linhaTendencia.match(/<td class="num[^"]*">([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  assert.deepStrictEqual(numeros, ['', '', '45', '79', '56', '200']);
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

test('Tendência: 1º dia de uma semana nova (Realizado dela ainda zerado) não cria "degrau" -- projeta o total da semana vigente com base no T do orçamento, sem sobrecarregar as semanas seguintes', () => {
  // Cenário relatado pelo usuário em 2026-08-03: ele está no 1º dia da 2ª
  // semana de Agosto/2026 (S2, 03/08 a 09/08 -- agosto tem 6 semanas, mês
  // começa num sábado), e o Realizado desse dia ainda não chegou (fonte
  // real só atualiza depois). Sem a correção, S2 cairia no ramo das semanas
  // elapsadas e mostraria 0 (Realizado parcial), um degrau irreal -- e os 6
  // dias que faltam dela sumiam do cálculo, sobrecarregando S3/S4/S5 (acima
  // do que os 7 dias de cada uma justificam). Essa proteção (não mudou)
  // agora vale sobre o saldo até o T, não mais até o Previsto.
  const registroAgosto = registro(0);
  registroAgosto.previsto.volume[VIGENTE_AGOSTO] = 620; // Previsto do mês -- não é mais o que a Tendência persegue
  registroAgosto.total.volume[VIGENTE_AGOSTO] = 620; // T do orçamento -- igual ao Previsto aqui, de propósito
  const diaAgo = (dia) => diaEpoch(new Date(Date.UTC(2026, 7, dia)));
  const eventos = {
    // 20 furos em S1 (01 e 02/08, semana TOTALMENTE fechada).
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
  assert.deepStrictEqual(numerosRealizado.slice(0, 6), ['20', '0', '0', '0', '0', '0']);

  // Tendência: S1 sem-dado (totalmente fechada, duplicaria o Realizado).
  // S2 (vigente) NÃO fica em branco nem em 0 -- mostra o próprio fato (0
  // até agora) + a fatia do saldo pra fechar o mês no T (620 - 20 = 600),
  // repartida proporcionalmente aos dias que SOBRAM (6 dias que faltam de
  // S2 + 7+7+7+1 das semanas futuras = 28 dias). S2 fica com 0 + 600 x 6/28
  // = 128,57 -> exibido 129. S3/S4/S5 (7 dias cada) ficam com 600 x 7/28 =
  // 150,00 cada; S6 (1 dia) com 600 x 1/28 = 21,43 -> exibido 21 -- nunca as
  // 190,91 que S3/S4/S5 teriam se os 6 dias de S2 tivessem sumido do
  // cálculo (600/22 x 7), prova de que elas não ficam sobrecarregadas.
  assert.deepStrictEqual(numerosTendencia.slice(0, 6), ['', '129', '150', '150', '150', '21']);
  assert.strictEqual(numerosTendencia[6], '620', 'Fechamento continua batendo com o T do mês inteiro');
});

test('Tendência: T ausente no mês inteiramente futuro fica zerada -- não reproduz mais o Previsto', () => {
  const registroAgosto = registro(0);
  registroAgosto.previsto.volume[VIGENTE_AGOSTO] = 1200; // Previsto preenchido, mas T (registro.total) segue 0 (ausente)
  const hojeAntesDeAgosto = diaEpoch(new Date(Date.UTC(2026, 6, 20))); // 20/07 -- antes de agosto começar (01/08)
  const demandas = { porRegistroEventos: {} }; // agregado real vazio -- ativa Realizado/Tendência, tudo fecha em 0
  const html = renderAbaSemanal([registroAgosto], [0], ['volume'], VIGENTE_AGOSTO, ANO, { demandas, hojeEpoch: hojeAntesDeAgosto });
  const linhaTendencia = html.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
  const numerosTendencia = linhaTendencia.match(/<td class="num[^"]*">([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  // Desde 2026-08-20, T ausente conta como zero -- "não executa nada naquele
  // local" -- mesmo com Previsto preenchido e o ramo (diagnóstico) caindo em
  // 'igual' (R=P=0, sem semana fechada ainda). A Tendência exibida não usa
  // mais o Previsto como reserva.
  assert.deepStrictEqual(numerosTendencia, ['0', '0', '0', '0', '0', '0', '0']);
});

test('Tendência: T preenchido no mês inteiramente futuro reparte o T pelas semanas, proporcional aos dias', () => {
  const registroAgosto = registro(0);
  registroAgosto.previsto.volume[VIGENTE_AGOSTO] = 1200;
  registroAgosto.total.volume[VIGENTE_AGOSTO] = 1200; // T = Previsto aqui, de propósito, pra comparar com o teste acima
  const hojeAntesDeAgosto = diaEpoch(new Date(Date.UTC(2026, 6, 20)));
  const demandas = { porRegistroEventos: {} };
  const html = renderAbaSemanal([registroAgosto], [0], ['volume'], VIGENTE_AGOSTO, ANO, { demandas, hojeEpoch: hojeAntesDeAgosto });
  const linhaTendencia = html.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
  const numerosTendencia = linhaTendencia.match(/<td class="num[^"]*">([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  // Agosto: 1200 repartido pelos dias [2,7,7,7,7,1] dá [77,271,271,271,271,39]
  // (mesmos números da linha Previsto aqui, porque T = P nesta fixture -- não
  // é mais a mesma conta por trás: a Tendência não usa mais o arredondamento
  // pelo maior resto de dividirEmSemanasInteiras, é repartição fracionária
  // simples, arredondada célula a célula na exibição).
  assert.deepStrictEqual(numerosTendencia, ['77', '271', '271', '271', '271', '39', '1.200'],
    'T=1200 repartido pelos dias do mês');
});

test('Demandas Pendentes: cada semana mostra o saldo fixo do SEU primeiro dia, semana futura fica sem-dado, fechamento é sempre o saldo de hoje', () => {
  // Semanas de julho/2026: S1 01-05/07, S2 06-12/07, S3 13-19/07 (em curso,
  // hoje=15/07), S4 20-26/07 (futura), S5 27-31/07 (futura).
  const eventos = {
    chegada: new Array(10).fill(diaJul(-30)), // 10 furos, todos chegados antes de julho
    saidaEstoque: [diaJul(2), diaJul(2), diaJul(9)], // 2 saem em 02/07, 1 em 09/07
    sondagemRealizada: [],
  };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  const html = renderAbaSemanal([registro(0)], [0], ['volume'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL });
  const linhaPendentes = html.match(/<tr class="linha-serie-semanal linha-pendentes-demandas">[\s\S]*?<\/tr>/)[0];
  const celulas = linhaPendentes.match(/<td class="num[^"]*"[^>]*>([^<]*)<\/td>/g).map(td => td.match(/>([^<]*)</)[1]);
  // Saldo no 1º dia de cada semana (10 chegaram, nenhuma saída ainda contada
  // além das que já ocorreram até aquele dia inclusive):
  // S1 início (01/07): 10 - 0 saídas até 01/07 = 10.
  // S2 início (06/07): 10 - 2 saídas até 06/07 (as duas de 02/07) = 8.
  // S3 início (13/07): 10 - 3 saídas até 13/07 (as duas de 02/07 + a de 09/07) = 7.
  // S4/S5 (início no futuro, ainda não começaram): sem-dado (célula vazia).
  // 6º elemento é o fechamento (celula-total-linha também casa com o regex
  // "num[^\"]*") -- SEMPRE o saldo de hoje (15/07), não o instantâneo da
  // semana em curso: 10 - 3 = 7.
  assert.deepStrictEqual(celulas, ['10', '8', '7', '', '', '7']);
  assert.match(linhaPendentes, /celula-total-linha">7</, 'fechamento é sempre o saldo de hoje, calculado direto');
});

test('registro cuja combinação (sup, tipologia) não existe em demandas.porRegistroEventos contribui 0, não é excluído da soma', () => {
  const demandas = { porRegistroEventos: { 'SUP-0002-24||ST': { sondagemRealizada: [diaJul(1)], saidaEstoque: [], chegada: [] } } };
  const html = renderAbaSemanal([registro(1000)], [0], ['volume'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL }); // registro é SUP-0001-24, não bate
  const linhaRealizado = html.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
  assert.doesNotMatch(linhaRealizado, /sem-dado/, '"sem furo" é uma contagem real (0), não uma lacuna');
  assert.match(linhaRealizado, /<td class="num">0<\/td>/);
});

test('Realizado/Tendência aparecem em Volume E Financeiro (Financeiro pesado pelo ticket médio); Equipes sem demandas.equipesPorDia fica sem-dado só no Realizado (Tendência vem de registro.total.equipes, independente de demandas); Demandas Pendentes continua exclusivo do Volume', () => {
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': { sondagemRealizada: [diaJul(1)], saidaEstoque: [], chegada: [] } } };
  const html = renderAbaSemanal([registro(1000)], [0], ['equipes', 'financeiro'], VIGENTE_JULHO, ANO, { demandas, hojeEpoch: HOJE_15_JUL });
  assert.doesNotMatch(html, /Demandas Pendentes/, 'Pendentes é estoque de furos, sem análogo em R$ -- exclusivo do Volume');
  const blocoEquipes = html.split('<div class="bloco-dimensao-semanal">')[1];
  const blocoFinanceiro = html.split('<div class="bloco-dimensao-semanal">')[2];
  const semDadoEquipes = (blocoEquipes.match(/class="num sem-dado"/g) || []).length;
  // Realizado (5 semanas): sem demandas.equipesPorDia, fica sem-dado.
  // Tendência (2026-08-07, e desde 2026-08-10 some nas semanas ENCERRADAS):
  // não depende de demandas -- vem de registro.total.equipes -- mas com
  // hoje=15/07 as semanas S1/S2 (fim < 15/07) já fecharam, então elas
  // também ficam sem-dado na Tendência (+2). Previsto sempre tem dado real.
  assert.strictEqual(semDadoEquipes, 7, '5 semanas do Realizado (sem equipesPorDia) + 2 semanas encerradas da Tendência (S1/S2)');
  const linhaTendenciaEquipes = blocoEquipes.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
  const semDadoTendenciaEquipes = (linhaTendenciaEquipes.match(/class="num sem-dado"/g) || []).length;
  assert.strictEqual(semDadoTendenciaEquipes, 2, 'Tendência de Equipes some nas semanas já encerradas (S1/S2 com hoje=15/07), mostra nas demais');
  const linhaRealizadoFinanceiro = blocoFinanceiro.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
  const linhaTendenciaFinanceiro = blocoFinanceiro.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
  assert.doesNotMatch(linhaRealizadoFinanceiro, /sem-dado/, 'Realizado ativo em todas as semanas (ticket médio 1 na fixture registro(), mesmos números de furos que Volume mostraria)');
  // Tendência: só S1/S2 estão TOTALMENTE fechadas (fim < hoje=15/07) e
  // ficam sem-dado -- só duplicariam o Realizado. S3 é a semana vigente
  // (hoje está dentro dela) e mostra sua projeção; S4/S5 (futuras) também.
  const semDadoTendenciaFinanceiro = (linhaTendenciaFinanceiro.match(/class="num sem-dado"/g) || []).length;
  assert.strictEqual(semDadoTendenciaFinanceiro, 2, 'Tendência: só as 2 semanas TOTALMENTE fechadas (S1/S2) ficam sem-dado; S3 (vigente)/S4/S5 mostram projeção');
});

// --- Realizado de Equipes (2026-08-06, recalibrado; 2026-08-08 trocado pra
// decomponível por SUP) --------------------------------------------------
// Versão original usava "Ativas (total)" do Matriz -- um número da EMPRESA
// INTEIRA por dia (demandas.equipesAtivoPorDia), igual em toda linha
// independente do filtro. Achado ao vivo pelo dono do projeto em 2026-08-08
// ("troquei o ID Contrato no filtro e o número não mudou"): trocado pra somar
// demandas.equipesPorDia[chaveDemandas(sup,tipologia)] através de 'indices'
// -- mesmo raciocínio de somaMesVigente (linha 42-43 do arquivo fonte):
// equipes de contratos DIFERENTES no mesmo dia se somam, só não se soma
// equipes ao longo do TEMPO (por isso segue média sobre os dias da semana,
// não soma). registro() default é sup='SUP-0001-24', tipologia='ST' -- as
// fixtures abaixo usam a chave 'SUP-0001-24||ST'.

test('Realizado de Equipes: média diária por semana, cortada em HOJE -- S1 e S2 fechadas, S3 vigente truncada em 3 dias, S4/S5 futuras sem-dado. Tendência (2026-08-07) vem de registro.total.equipes, repetida nas semanas que ainda NÃO fecharam (2026-08-10: some nas encerradas -- S1/S2 aqui)', () => {
  const equipesPorDia = {
    'SUP-0001-24||ST': {
      [diaJul(1)]: 3, [diaJul(3)]: 1,    // S1 (5 dias corridos, seg-dom, mas domingo dia5 sai da conta -- 4 dias úteis): soma 4 / 4 = 1,00 -- ver teste seguinte pra denominador
      [diaJul(8)]: 7,                     // S2 (7 dias corridos, seg-dom, domingo dia12 sai da conta -- 6 dias úteis): 7 / 6 = 1,1667 -> Math.ceil = 2
      [diaJul(14)]: 3,                    // S3 (13-19, truncada em hoje=15 -> 3 dias: 13, 14 e 15)
      [diaJul(22)]: 99,                   // S4 é futura (hoje=15) -- não deve entrar em nada
    },
  };
  const demandas = { porRegistroEventos: {}, equipesPorDia };
  // total.equipes DIFERENTE de previsto.equipes (5, não 2 -- ambos vêm de
  // registro(0), que usa o mesmo array [2]*12 pros três blocos por padrão):
  // prova que a Tendência lê o campo certo (BASE=T), não aliasa o Previsto.
  const registroComTendencia = registro(0);
  registroComTendencia.total.equipes = new Array(12).fill(0);
  registroComTendencia.total.equipes[VIGENTE_JULHO] = 5;
  const series = calcularSeriesSemanaisDimensao(
    [registroComTendencia], [0], 'equipes', VIGENTE_JULHO, SEMANAS_JULHO, SEMANAS_JULHO.length,
    true, indiceSemanaAtual(SEMANAS_JULHO, HOJE_15_JUL), demandas, HOJE_15_JUL
  );
  // somarEquipesNoIntervalo divide pelos DIAS ÚTEIS DA JANELA (segunda a
  // sábado -- domingo sai do denominador E da soma, decisão do dono do
  // projeto em 2026-08-10), não pelos dias com dado nem pelos dias corridos
  // -- diferente de mediaEquipesNoIntervalo (a versão anterior, roster
  // global): S1 = (3+1)/4 dias úteis = 1,00 -> 1; S2 = 7/6 dias úteis =
  // 1,1667 -> Math.ceil = 2.
  //
  // S3 desde 2026-08-17 (corte em HOJE, não mais em d-1): a janela vai do dia
  // 13 ao dia 15 (hoje) -- 3 dias, todos úteis (13=segunda, 14=terça,
  // 15=quarta), então 3/3 = 1,0 -> Math.ceil = 1. Com o corte antigo em d-1
  // eram 2 dias (13 e 14) e dava 3/2 = 1,5 -> 2. Ver
  // docs/superpowers/specs/2026-08-17-realizado-ate-hoje-design.md.
  assert.deepStrictEqual(series.semanasRealizado, [1, 2, 1, null, null]);
  assert.ok(Math.abs(series.fechamentoRealizado - 4 / 3) < 1e-9, 'fechamento é a MÉDIA de [1,2,1], não a soma');
  // 2026-08-10: Tendência de Equipes some nas semanas já ENCERRADAS (fim <
  // hoje) -- S1 e S2 fecharam antes de 15/07, ficam null. S3 (vigente),
  // S4/S5 (futuras) continuam mostrando o Total repetido, igual ao Previsto.
  // semanasTendenciaCompleta continua com o valor em TODAS -- só a exibição
  // (semanasTendencia) muda.
  assert.deepStrictEqual(series.semanasTendencia, [null, null, 5, 5, 5], 'some nas semanas encerradas (S1/S2), mostra nas que ainda não fecharam');
  assert.deepStrictEqual(series.semanasTendenciaCompleta, [5, 5, 5, 5, 5], 'a versão completa continua repetindo em todas -- alimenta o Gráfico/Consolidado');
  assert.strictEqual(series.fechamentoTendencia, 5, 'fechamento é a MÉDIA das semanas COM DADO (foto) -- aqui o próprio valor repetido nas 3 visíveis');
});

test('Realizado de Equipes: divide pelos DIAS DA JANELA (não pelos dias com dado) -- semana de 5 dias com só 1 dia de dado (4) dá 4/5=0,8 -> Math.ceil=1', () => {
  const equipesPorDia = { 'SUP-0001-24||ST': { [diaJul(1)]: 4 } }; // só o dia 1 de S1 tem dado
  const demandas = { porRegistroEventos: {}, equipesPorDia };
  const series = calcularSeriesSemanaisDimensao(
    [registro(0)], [0], 'equipes', VIGENTE_JULHO, SEMANAS_JULHO, SEMANAS_JULHO.length,
    true, indiceSemanaAtual(SEMANAS_JULHO, HOJE_15_JUL), demandas, HOJE_15_JUL
  );
  assert.strictEqual(series.semanasRealizado[0], 1, '4 equipes-dia / 5 dias da semana = 0,8, Math.ceil = 1 -- dia sem produção conta como 0 equipes naquele dia, é fluxo de produção, não roster');
});

test('Realizado de Equipes: sem demandas.equipesPorDia, todas as semanas ficam sem-dado (null), não zero', () => {
  const demandas = { porRegistroEventos: {} };
  const series = calcularSeriesSemanaisDimensao(
    [registro(0)], [0], 'equipes', VIGENTE_JULHO, SEMANAS_JULHO, SEMANAS_JULHO.length,
    true, indiceSemanaAtual(SEMANAS_JULHO, HOJE_15_JUL), demandas, HOJE_15_JUL
  );
  series.semanasRealizado.forEach((v) => assert.strictEqual(v, null));
  assert.strictEqual(series.fechamentoRealizado, null);
});

test('Realizado de Equipes: mês inteiramente no futuro fica todo sem-dado (nenhuma semana já começou)', () => {
  const hojeJunho = diaEpoch(new Date(Date.UTC(2026, 5, 10))); // hoje ANTES de julho inteiro
  const equipesPorDia = { 'SUP-0001-24||ST': { [diaJul(1)]: 5 } };
  const demandas = { porRegistroEventos: {}, equipesPorDia };
  const series = calcularSeriesSemanaisDimensao(
    [registro(0)], [0], 'equipes', VIGENTE_JULHO, SEMANAS_JULHO, SEMANAS_JULHO.length,
    true, indiceSemanaAtual(SEMANAS_JULHO, hojeJunho), demandas, hojeJunho
  );
  series.semanasRealizado.forEach((v) => assert.strictEqual(v, null));
  assert.strictEqual(series.fechamentoRealizado, null);
});

// Achado ao vivo pelo dono do projeto em 2026-08-08: "troquei o ID Contrato
// no filtro e o Realizado de Equipes não mudou" -- a versão anterior
// (equipesAtivoPorDia) de propósito ignorava 'registros'/'indices'. Este
// teste prova o oposto do que a versão anterior testava: dois filtros
// diferentes (um SUP só vs. dois SUPs somados) TÊM que dar números
// diferentes agora.
test('Realizado de Equipes: MUDA com o filtro de SUP -- dois SUPs somam no mesmo dia, um filtro com só um deles dá metade', () => {
  const equipesPorDia = {
    'SUP-0001-24||ST': { [diaJul(1)]: 3, [diaJul(2)]: 3, [diaJul(3)]: 3, [diaJul(4)]: 3, [diaJul(5)]: 3 }, // S1 inteira, 5 dias
    'SUP-0002-24||ST': { [diaJul(1)]: 2, [diaJul(2)]: 2, [diaJul(3)]: 2, [diaJul(4)]: 2, [diaJul(5)]: 2 },
  };
  const demandas = { porRegistroEventos: {}, equipesPorDia };
  const registroDois = registro(0);
  registroDois.sup = 'SUP-0002-24';

  const soUmSup = calcularSeriesSemanaisDimensao(
    [registro(0)], [0], 'equipes', VIGENTE_JULHO, SEMANAS_JULHO, SEMANAS_JULHO.length,
    true, indiceSemanaAtual(SEMANAS_JULHO, HOJE_15_JUL), demandas, HOJE_15_JUL
  );
  const doisSups = calcularSeriesSemanaisDimensao(
    [registro(0), registroDois], [0, 1], 'equipes', VIGENTE_JULHO, SEMANAS_JULHO, SEMANAS_JULHO.length,
    true, indiceSemanaAtual(SEMANAS_JULHO, HOJE_15_JUL), demandas, HOJE_15_JUL
  );
  assert.strictEqual(soUmSup.semanasRealizado[0], 3, 'só SUP-0001-24: 3 equipes-dia/dia = 3 (Math.ceil de 3,00)');
  assert.strictEqual(doisSups.semanasRealizado[0], 5, 'os dois SUPs somam por dia: (3+2) = 5 -- prova que o filtro de SUP agora MUDA o número');
  assert.notStrictEqual(soUmSup.semanasRealizado[0], doisSups.semanasRealizado[0]);
});

// Regressão de calibração (2026-08-06/08): S1 = 85 (5 dias, 425 equipes-dia
// no total, 85/dia); S2 truncada em 4 dias até 06/08 com 83,75 equipes-dia
// médias -> 335 equipes-dia / 4 dias = 83,75 -> Math.ceil = 84.
test('Realizado de Equipes: regressão -- replica S1=85 e S2=84 (83,75 arredondado pra cima) medidos ao vivo contra o Matriz em agosto/2026', () => {
  const diaAgo = (d) => diaEpoch(new Date(Date.UTC(2026, 7, d)));
  const equipesPorDia = {
    'SUP-0001-24||ST': {
      [diaAgo(1)]: 85, [diaAgo(2)]: 85,
      [diaAgo(3)]: 85, [diaAgo(4)]: 84, [diaAgo(5)]: 83, [diaAgo(6)]: 83,
    },
  };
  const demandas = { porRegistroEventos: {}, equipesPorDia };
  const VIGENTE_AGOSTO_LOCAL = 7;
  const semanasAgosto = semanasDoMes(2026, VIGENTE_AGOSTO_LOCAL);
  const hoje6ago = diaAgo(6);
  const series = calcularSeriesSemanaisDimensao(
    [registro(0)], [0], 'equipes', VIGENTE_AGOSTO_LOCAL, semanasAgosto, semanasAgosto.length,
    true, indiceSemanaAtual(semanasAgosto, hoje6ago), demandas, hoje6ago
  );
  // Agosto/2026 começa num sábado -- S1 é só 01-02/08 (fim de semana, corte
  // sempre dentro do mês). S2 é 03-09/08, truncada em hoje (06/08) -> 03-06.
  assert.strictEqual(semanasAgosto[0].inicio, diaAgo(1));
  assert.strictEqual(semanasAgosto[0].fim, diaAgo(2));
  assert.strictEqual(series.semanasRealizado[0], 85, '(85+85)/2 dias = 85,00');
  assert.strictEqual(series.semanasRealizado[1], 84, '(85+84+83+83)/4 dias = 83,75 -> Math.ceil = 84');
});

// 2026-08-10, decisão do dono do projeto: domingo sai do denominador E da
// soma de "Realizado de Equipes" -- semana cheia passa a ser segunda a
// sábado (6 dias), não os 7 dias corridos que somarEquipesNoIntervalo usava
// até aqui. Semana usada: 03-09/08/2026 (segunda a domingo, semana inteira
// dentro do mês, sem truncamento -- hoje é 11/08, depois do fim dela).
// Valores DIFERENTES entre domingo e o resto de propósito (6 nos dias úteis,
// 60 no domingo): se o domingo ainda entrasse na soma ou no denominador, o
// resultado mudaria bastante -- com valor uniforme os dois cálculos dão o
// mesmo número por coincidência (36/6 = 42/7 = 6), o que não provaria nada
// (é o alerta do próprio brief desta tarefa).
test('Realizado de Equipes: domingo sai do denominador E da soma -- semana cheia (seg-sáb) vira 6 dias, não 7', () => {
  const semanasAgosto = semanasDoMes(2026, 7); // mesIndex 0-based -- 7 = agosto
  const semanaCheia = semanasAgosto[1]; // 03-09/08: segunda a domingo, inteira dentro do mês
  assert.strictEqual(new Date(semanaCheia.inicio * 86400000).getUTCDay(), 1, 'início é segunda-feira');
  assert.strictEqual(new Date(semanaCheia.fim * 86400000).getUTCDay(), 0, 'fim é domingo');
  const equipesPorDia = { 'SUP-0001-24||ST': {} };
  for (let dia = semanaCheia.inicio; dia <= semanaCheia.fim; dia++) {
    const domingo = new Date(dia * 86400000).getUTCDay() === 0;
    equipesPorDia['SUP-0001-24||ST'][dia] = domingo ? 60 : 6;
  }
  const demandas = { porRegistroEventos: {}, equipesPorDia };
  const hojeDepoisDaSemana = diaEpoch(new Date(Date.UTC(2026, 7, 11))); // 11/08, depois do fim da semana (09/08)
  const series = calcularSeriesSemanaisDimensao(
    [registro(0)], [0], 'equipes', 7, semanasAgosto, semanasAgosto.length,
    true, indiceSemanaAtual(semanasAgosto, hojeDepoisDaSemana), demandas, hojeDepoisDaSemana
  );
  // Novo: soma seg-sáb (6*6=36) / 6 dias = 6. Se o domingo ainda entrasse
  // (soma antiga 36+60=96, denominador 7), daria Math.ceil(96/7) = 14 --
  // bem diferente de 6, prova que a mudança realmente pega os dois lugares.
  assert.strictEqual(series.semanasRealizado[1], 6, 'domingo (60) não soma nem conta no denominador -- 36/6 = 6, não Math.ceil(96/7) = 14');
});

// Caso de borda documentado no próprio código (diasUteisNoIntervalo,
// render-aba-semanal.js): quando o recorte cai INTEIRO num domingo --
// acontece na borda do mês, quando a semana do calendário real (segunda a
// domingo, corte sempre dentro do mês) tem só esse dia. Fevereiro/2026
// começa num domingo (01/02), então S1 é só esse dia sozinho.
test('Realizado de Equipes: recorte que é só um domingo (borda de mês) conta esse domingo sozinho, não vira "sem dado"', () => {
  const semanasFevereiro = semanasDoMes(2026, 1); // mesIndex 0-based -- 1 = fevereiro
  const s1 = semanasFevereiro[0];
  assert.strictEqual(s1.inicio, s1.fim, 'S1 de fevereiro/2026 é um único dia');
  assert.strictEqual(new Date(s1.inicio * 86400000).getUTCDay(), 0, 'esse único dia é domingo');
  const equipesPorDia = { 'SUP-0001-24||ST': { [s1.inicio]: 9 } };
  const demandas = { porRegistroEventos: {}, equipesPorDia };
  const hojeDepoisDeS1 = diaEpoch(new Date(Date.UTC(2026, 1, 5))); // depois de S1, dentro do mês
  const series = calcularSeriesSemanaisDimensao(
    [registro(0)], [0], 'equipes', 1, semanasFevereiro, semanasFevereiro.length,
    true, indiceSemanaAtual(semanasFevereiro, hojeDepoisDeS1), demandas, hojeDepoisDeS1
  );
  assert.strictEqual(series.semanasRealizado[0], 9, 'domingo sozinho conta ele mesmo (9/1 = 9), não fica sem-dado por denominador zero');
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
  assert.match(linhaPendentes, /celula-total-linha">1</, 'fechamento continua mostrando o saldo de hoje: 1 chegada, 0 saídas até 15/07');
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

// Substituído em 2026-08-07 (pedido do dono do projeto): financeiro deixou
// de ser milhões com "M" (2026-08-06) e passou a milhares TRUNCADOS, sem
// sufixo -- ver formatarFinanceiroMilhares. Exemplo confirmado com ele antes
// de implementar (preview da pergunta de esclarecimento): R$ 12.345.648 ->
// "12.345" (truncado, não arredondado -- ,648 não vira ,346).
// R$ 5.000 -> "5" · R$ 45.000 -> "45" · R$ 99.999 -> "99" (trunca, não
// arredonda pra 100) · R$ 100.000 -> "100" · R$ 1.250.000 -> "1.250" ·
// R$ 33.000.884 -> "33.000".
test('formatarFinanceiroMilhares: milhares truncados (Math.floor), sem sufixo, agrupados em pt-BR', () => {
  assert.strictEqual(formatarFinanceiroMilhares(5000), '5');
  assert.strictEqual(formatarFinanceiroMilhares(45000), '45');
  assert.strictEqual(formatarFinanceiroMilhares(99999), '99', 'trunca, não arredonda pra 100');
  assert.strictEqual(formatarFinanceiroMilhares(100000), '100');
  assert.strictEqual(formatarFinanceiroMilhares(1250000), '1.250');
  assert.strictEqual(formatarFinanceiroMilhares(33000884), '33.000');
  assert.strictEqual(formatarFinanceiroMilhares(12345648), '12.345', 'exemplo confirmado com o dono do projeto');
  assert.strictEqual(formatarFinanceiroMilhares(null), '—');
});

test('financeiro na Tabela Semanal usa o formato em milhares truncados, não mais inteiro puro nem milhões', () => {
  const html = renderAbaSemanal([registroFinanceiro(1250000)], [0], ['financeiro'], VIGENTE_JULHO, ANO,
    { demandas: DEMANDAS_JULHO, hojeEpoch: HOJE_15_JUL });
  assert.match(html, /<td class="num celula-total-linha">1\.250<\/td>/, 'R$1.250.000 no mês precisa fechar como "1.250" (milhares) na coluna Total do Previsto');
  assert.doesNotMatch(html, /<td class="num[^"]*">1\.250\.000<\/td>/, 'não pode sobrar o valor cru sem conversão pra milhares');
  assert.doesNotMatch(html, / M</, 'o sufixo "M" (formato em milhões, substituído em 2026-08-07) não pode mais aparecer');
});

test('equipes sem casa decimal, igual a volume (financeiro agora usa o formato em milhões, testado à parte)', () => {
  const html = renderAbaSemanal([registro(1000)], [0], ['equipes'], VIGENTE_JULHO, ANO, {});
  const numeros = [...html.matchAll(/<td class="num[^"]*"[^>]*>([^<]*)<\/td>/g)].map((m) => m[1]).filter(Boolean);
  assert.ok(numeros.length > 0, 'a fixture precisa produzir celulas numericas');
  numeros.forEach((td) => assert.ok(!/,\d/.test(td), 'equipes nao pode ter casa decimal: ' + td));
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

// --- Financeiro Realizado: SEMPRE eventos x ticket médio (2026-08-21) -----
//
// Até 2026-08-10 meses JÁ FECHADOS usavam 'realizado.financeiro' da MATRIZ
// (repartido proporcionalmente entre as semanas); revertido em 2026-08-21,
// decisão do dono do projeto por "1 origem por tipo de dado" -- Financeiro
// não pode ter fonte diferente dependendo de quando você olha o mesmo mês.
// Confirmado com o mesmo exemplo real usado pra justificar a troca de 2026:
// julho/2026 mostrava 9.832 pela conta de eventos contra 9.408 na MATRIZ --
// a diferença (~4,5%) é aceita, agora Financeiro conta eventos em qualquer
// mês, igual Volume sempre fez.
//
// mesAtualReal (parâmetro que distinguia "mês selecionado" de "mês real de
// hoje") não tem mais consumidor dentro desta função -- ver o comentário
// em calcularSeriesSemanaisDimensao -- mas continua sendo aceito e
// repassado pelos chamadores, então os testes abaixo continuam passando
// ele para provar que ele já não faz diferença nenhuma.

test('Financeiro Realizado: mês FECHADO conta eventos x ticket médio, igual qualquer outro mês (não usa mais a MATRIZ)', () => {
  const registroFinanceiro = registro(0);
  registroFinanceiro.realizado.financeiro = new Array(12).fill(0);
  registroFinanceiro.realizado.financeiro[VIGENTE_JULHO] = 9408; // valor da MATRIZ -- tem que ser IGNORADO agora
  const demandasComEventos = {
    porRegistroEventos: {
      'SUP-0001-24||ST': { sondagemRealizada: [diaJul(2), diaJul(8)], chegada: [], saidaEstoque: [] },
    },
  };
  const mesAtualReal = 7; // agosto -- julho (6) já fechou
  const series = calcularSeriesSemanaisDimensao(
    [registroFinanceiro], [0], 'financeiro', VIGENTE_JULHO, SEMANAS_JULHO, SEMANAS_JULHO.length,
    true, indiceSemanaAtual(SEMANAS_JULHO, HOJE_15_JUL), demandasComEventos, HOJE_15_JUL, mesAtualReal
  );
  const soma = series.semanasRealizado.reduce((a, b) => a + (b || 0), 0);
  assert.strictEqual(soma, 2, '2 eventos x ticket médio 1 (fixture registro()) = 2 -- não os 9408 da MATRIZ, mesmo em mês fechado');
});

test('Financeiro Realizado: mês VIGENTE (selecionado == mesAtualReal) continua com a conta de eventos, ignora a MATRIZ', () => {
  const registroFinanceiro = registro(0);
  registroFinanceiro.realizado.financeiro = new Array(12).fill(0);
  registroFinanceiro.realizado.financeiro[VIGENTE_JULHO] = 9408;
  const demandas = {
    porRegistroEventos: {
      'SUP-0001-24||ST': { sondagemRealizada: [diaJul(2), diaJul(8)], chegada: [], saidaEstoque: [] },
    },
  };
  const mesAtualReal = VIGENTE_JULHO; // julho é o mês corrente -- não fechado
  const series = calcularSeriesSemanaisDimensao(
    [registroFinanceiro], [0], 'financeiro', VIGENTE_JULHO, SEMANAS_JULHO, SEMANAS_JULHO.length,
    true, indiceSemanaAtual(SEMANAS_JULHO, HOJE_15_JUL), demandas, HOJE_15_JUL, mesAtualReal
  );
  const soma = series.semanasRealizado.reduce((a, b) => a + (b || 0), 0);
  assert.strictEqual(soma, 2, '2 eventos x ticket médio 1 (fixture registro()) = 2 -- não os 9408 da MATRIZ');
});

test('Financeiro Realizado: mês FUTURO (selecionado depois do vigente) continua com a conta de eventos', () => {
  const registroFinanceiro = registro(0);
  registroFinanceiro.realizado.financeiro = new Array(12).fill(0);
  registroFinanceiro.realizado.financeiro[VIGENTE_JULHO] = 9408;
  const mesAtualReal = 5; // junho -- julho ainda não chegou
  const series = calcularSeriesSemanaisDimensao(
    [registroFinanceiro], [0], 'financeiro', VIGENTE_JULHO, SEMANAS_JULHO, SEMANAS_JULHO.length,
    true, indiceSemanaAtual(SEMANAS_JULHO, HOJE_15_JUL), { porRegistroEventos: {} }, HOJE_15_JUL, mesAtualReal
  );
  const soma = series.semanasRealizado.reduce((a, b) => a + (b || 0), 0);
  assert.strictEqual(soma, 0, 'sem eventos e mês ainda não fechou -- nunca usa a MATRIZ pra mês futuro');
});

test('Financeiro Realizado: SEM mesAtualReal (chamador antigo, ex. Consolidado/Alertas) nunca usa a MATRIZ', () => {
  const registroFinanceiro = registro(0);
  registroFinanceiro.realizado.financeiro = new Array(12).fill(0);
  registroFinanceiro.realizado.financeiro[VIGENTE_JULHO] = 9408;
  const demandas = {
    porRegistroEventos: {
      'SUP-0001-24||ST': { sondagemRealizada: [diaJul(2)], chegada: [], saidaEstoque: [] },
    },
  };
  const series = calcularSeriesSemanaisDimensao(
    [registroFinanceiro], [0], 'financeiro', VIGENTE_JULHO, SEMANAS_JULHO, SEMANAS_JULHO.length,
    true, indiceSemanaAtual(SEMANAS_JULHO, HOJE_15_JUL), demandas, HOJE_15_JUL
    // mesAtualReal omitido de propósito
  );
  const soma = series.semanasRealizado.reduce((a, b) => a + (b || 0), 0);
  assert.strictEqual(soma, 1, '1 evento x ticket médio 1 -- comportamento idêntico ao de antes desta mudança');
});

test('Volume Realizado NUNCA usa a MATRIZ, mesmo em mês fechado -- só Financeiro troca de fonte', () => {
  const registroVolume = registro(1000); // volume previsto/realizado já preenchidos pela fixture
  const demandas = {
    porRegistroEventos: {
      'SUP-0001-24||ST': { sondagemRealizada: [diaJul(2), diaJul(8)], chegada: [], saidaEstoque: [] },
    },
  };
  const mesAtualReal = 7; // agosto -- julho fechado
  const series = calcularSeriesSemanaisDimensao(
    [registroVolume], [0], 'volume', VIGENTE_JULHO, SEMANAS_JULHO, SEMANAS_JULHO.length,
    true, indiceSemanaAtual(SEMANAS_JULHO, HOJE_15_JUL), demandas, HOJE_15_JUL, mesAtualReal
  );
  const soma = series.semanasRealizado.reduce((a, b) => a + (b || 0), 0);
  assert.strictEqual(soma, 2, 'continua contando os 2 furos reais -- Volume não tem valor mensal único pra comparar com a MATRIZ');
});

// --- A unidade de projeção da Tendência (2026-08-11) ------------------------

test('GRUPOS_TIPOLOGIA_TENDENCIA é idêntica a COLUNAS_ALOCACAO', () => {
  // A tabela está duplicada em render-aba-semanal.js por causa da ordem de
  // BUNDLE_ARQUIVOS (aquele módulo entra antes de equipes-alocaveis.js, então
  // o require leria undefined no navegador). Este teste é o que impede a
  // duplicata de virar divergência: se uma mudar e a outra não, quebra aqui.
  const { GRUPOS_TIPOLOGIA_TENDENCIA } = require('../tools/semanal/render-aba-semanal.js');
  const { COLUNAS_ALOCACAO } = require('../tools/semanal/equipes-alocaveis.js');
  assert.deepStrictEqual(
    GRUPOS_TIPOLOGIA_TENDENCIA.map((g) => ({ id: g.id, tipologias: g.tipologias })),
    COLUNAS_ALOCACAO.map((c) => ({ id: c.id, tipologias: c.tipologias })),
    'a unidade de projeção da Semanal tem que ser a mesma célula da Alocação'
  );
});

test('a unidade agrupa CPTu, SH e VT numa só -- não são três unidades', () => {
  const { chaveUnidadeTendencia } = require('../tools/semanal/render-aba-semanal.js');
  const chave = (t) => chaveUnidadeTendencia({ sup: 'SUP-A', tipologia: t });
  assert.strictEqual(chave('CPTu'), chave('SH'));
  assert.strictEqual(chave('SH'), chave('VT'));
  assert.notStrictEqual(chave('CPTu'), chave('SP'));
  // SUPs diferentes são unidades diferentes -- a Alocação também separa por SUP.
  assert.notStrictEqual(chaveUnidadeTendencia({ sup: 'SUP-A', tipologia: 'SP' }),
    chaveUnidadeTendencia({ sup: 'SUP-B', tipologia: 'SP' }));
});

test('o furo de HOJE entra no Realizado da semana em curso -- o corte é em D, não em d-1 (2026-08-17)', () => {
  // hoje = 15/07 (S3, 13..19). Um furo em 13/07 (passado) e um em 15/07 (hoje).
  // Com o corte antigo em d-1 (14/07) só o primeiro contava: S3 = 1.
  const eventos = { sondagemRealizada: [diaJul(13), diaJul(15)], saidaEstoque: [], chegada: [] };
  const demandas = { porRegistroEventos: { 'SUP-0001-24||ST': eventos } };
  const series = calcularSeriesSemanaisDimensao(
    [registro(1000)], [0], 'volume', VIGENTE_JULHO, SEMANAS_JULHO, SEMANAS_JULHO.length,
    true, indiceSemanaAtual(SEMANAS_JULHO, HOJE_15_JUL), demandas, HOJE_15_JUL
  );
  assert.strictEqual(series.semanasRealizado[2], 2, 'os dois furos entram: o de 13/07 e o de HOJE (15/07)');
});

test('Realizado de Equipes: semana que COMEÇOU hoje deixa de ser sem-dado e mostra a média de 1 dia (2026-08-17)', () => {
  // hoje = 13/07, o PRIMEIRO dia da S3 (13..19). Com o corte antigo em d-1 a
  // condição `semana.inicio > realizadoAteEpoch` era verdadeira e S3 voltava
  // null ("semana futura, ou começou hoje"). Com o corte em D, a janela é
  // [13, 13] -- um dia, útil (segunda) -- e a média é o próprio valor dele.
  const hoje13 = diaJul(13);
  const equipesPorDia = { 'SUP-0001-24||ST': { [diaJul(13)]: 4 } };
  const demandas = { porRegistroEventos: {}, equipesPorDia };
  const series = calcularSeriesSemanaisDimensao(
    [registro(0)], [0], 'equipes', VIGENTE_JULHO, SEMANAS_JULHO, SEMANAS_JULHO.length,
    true, indiceSemanaAtual(SEMANAS_JULHO, hoje13), demandas, hoje13
  );
  assert.strictEqual(series.semanasRealizado[2], 4, 'S3 começou hoje: 4/1 dia útil = 4, não null');
  assert.strictEqual(series.semanasRealizado[3], null, 'S4 continua futura, sem dado');
});
