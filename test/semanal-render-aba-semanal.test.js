'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderAbaSemanal, rotuloColunaFechamento } = require('../tools/semanal/render-aba-semanal.js');

function registro(volumeMes) {
  const zeros = new Array(12).fill(0);
  const vol = new Array(12).fill(0); vol[6] = volumeMes;
  const bloco = (v) => ({ equipes: new Array(12).fill(2), volume: v, financeiro: zeros,
    equipesResumo: { pico: 2, media: 2, prod: 8, dias: 25 },
    volumeResumo: { total: volumeMes, totalInicial: volumeMes, ticket: 1 },
    financeiroResumo: { total: 0, totalInicial: 0 } });
  return { sup: 'SUP-0001-24', grupo: 'G', tomador: 'T', tipologia: 'ST',
           previsto: bloco(vol), realizado: bloco(zeros), total: bloco(zeros) };
}

test('mostra as 4 semanas com P, R e T', () => {
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6);
  for (const s of ['S1', 'S2', 'S3', 'S4']) assert.match(html, new RegExp(s));
  assert.match(html, /Previsto/); assert.match(html, /Realizado/); assert.match(html, /Tend/);
});

test('previsto de volume aparece como um quarto do mês', () => {
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6);
  assert.match(html, /100/);
});

test('a coluna de fechamento muda de rótulo conforme a dimensão', () => {
  assert.strictEqual(rotuloColunaFechamento('volume'), 'Total');
  assert.strictEqual(rotuloColunaFechamento('financeiro'), 'Total');
  assert.strictEqual(rotuloColunaFechamento('equipes'), 'Média');
});

test('realizado e tendência ficam vazios enquanto não há planilha semanal', () => {
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6);
  assert.match(html, /class="[^"]*sem-dado/);
});

test('com uma dimensão só, renderiza exatamente 1 bloco/tabela', () => {
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6);
  assert.equal((html.match(/<div class="bloco-dimensao-semanal">/g) || []).length, 1);
  assert.equal((html.match(/<table class="tabela-semanal">/g) || []).length, 1);
});

test('com várias dimensões marcadas, renderiza um bloco por dimensão, na ordem recebida, cada um com seu próprio título e sua própria coluna de fechamento', () => {
  const html = renderAbaSemanal([registro(400)], [0], ['equipes', 'volume', 'financeiro'], 6);
  assert.equal((html.match(/<div class="bloco-dimensao-semanal">/g) || []).length, 3);
  assert.equal((html.match(/<table class="tabela-semanal">/g) || []).length, 3);

  // split() no próprio marcador de bloco -- blocos[0] é '' (antes do 1º
  // marcador), blocos[1..3] são o conteúdo de cada bloco, na ordem em que
  // aparecem no HTML (que deve ser a ordem recebida em "dimensoes", não
  // reordenada).
  const blocos = html.split('<div class="bloco-dimensao-semanal">').slice(1);
  assert.equal(blocos.length, 3);

  assert.match(blocos[0], /<div class="tabela-semanal-titulo">Equipes<\/div>/);
  assert.match(blocos[1], /<div class="tabela-semanal-titulo">Volume<\/div>/);
  assert.match(blocos[2], /<div class="tabela-semanal-titulo">Financeiro<\/div>/);

  // Bloco de equipes fecha por Média (rótulo da coluna); volume/financeiro fecham por Total.
  assert.match(blocos[0], />Média<\/th>/);
  assert.match(blocos[1], />Total<\/th>/);
  assert.match(blocos[2], />Total<\/th>/);
});

test('título do bloco escapa o rótulo da dimensão (defesa em profundidade, mesmo as 3 dimensões sendo valores fixos e seguros)', () => {
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6);
  assert.match(html, /<div class="tabela-semanal-titulo">Volume<\/div>/);
});

function demandasFixture(sup, tipologia, sondagemRealizadaMes, pendentesMes) {
  const zeros = new Array(12).fill(0);
  const sondagem = zeros.slice(); sondagem[6] = sondagemRealizadaMes;
  const pendentes = zeros.slice(); pendentes[6] = pendentesMes;
  return {
    // totais espelha o mesmo agregado que compute-demandas.js sempre produz
    // (serieVazia(n), nunca ausente) -- o guard de vigenteIdx fora do ano em
    // demandasMesVigente usa demandas.totais[serie] pra saber o tamanho do
    // ano; sem isto aqui, toda fixture deste arquivo pareceria "fora do
    // intervalo" e cairia pra sem-dado por engano.
    totais: { sondagemRealizada: sondagem, pendentes: pendentes },
    porRegistro: { [`${sup}||${tipologia}`]: { sondagemRealizada: sondagem, pendentes: pendentes } },
  };
}

test('sem o 5º parâmetro, o comportamento é idêntico ao de hoje -- Realizado/Tendência sem-dado, sem linha de Pendentes', () => {
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6);
  assert.doesNotMatch(html, /Demandas Pendentes/);
  const linhasSemDado = (html.match(/class="num sem-dado"/g) || []).length;
  assert.strictEqual(linhasSemDado, 8, '4 semanas x 2 linhas (Realizado + Tendência), nenhuma mudança nesta chamada de 4 argumentos');
});

test('com demandas SEM a chave porRegistro (ex.: {tipologias:[],totais:{}}, o formato que os testes de wire-up já usam como "sem dado real"), o comportamento fica idêntico ao de hoje', () => {
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6, { demandas: { tipologias: [], totais: {} }, diaDoMes: 10, diasNoMes: 28 });
  assert.doesNotMatch(html, /Demandas Pendentes/, 'demandas.porRegistro é undefined aqui (a chave não existe) -- diferente de {} vazio, que é um agregado real com zero furos; undefined é "sem agregado nenhum"');
});

// Diferente do teste acima: aqui porRegistro EXISTE, só está vazio -- um
// agregado real (a planilha existe, ninguém no recorte atual tem furo
// nenhum). Isso é um dado real, não "ausência de dado" -- por isso ATIVA a
// linha nova, com zero, não sem-dado. A distinção entre "chave ausente" e
// "objeto vazio" é proposital (ver demandasMesVigente/temDadosDemandas).
test('com demandas.porRegistro presente mas vazio ({}), a linha Demandas Pendentes aparece com zero, não fica escondida', () => {
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6, { demandas: { totais: { sondagemRealizada: new Array(12).fill(0), pendentes: new Array(12).fill(0) }, porRegistro: {} }, diaDoMes: 10, diasNoMes: 28 });
  assert.match(html, /Demandas Pendentes/, 'porRegistro:{} é um agregado real (zero furos casaram), diferente de porRegistro ausente -- a linha deve aparecer, mostrando 0');
  const linhaPendentes = html.match(/<tr class="linha-serie-semanal linha-pendentes-demandas">[\s\S]*?<\/tr>/)[0];
  assert.match(linhaPendentes, /celula-total-linha">0,00/);
});

test('Realizado semanal (Volume) vem de demandas.porRegistro, dividido nominalmente em 4 semanas', () => {
  // diaDoMes=1 (semanaAtualNum=1) de propósito, não 28: mantém Tendência
  // (3 semanas futuras, saldo distribuído) numericamente diferente de
  // Realizado (800/4=200 fixo em todas as semanas) -- se este teste usasse
  // diaDoMes=28 (semanaAtualNum=4), Tendência colapsaria pro mesmo valor de
  // Realizado em toda semana, e uma regex frouxa passaria mesmo com um bug
  // em Realizado.
  const demandas = demandasFixture('SUP-0001-24', 'ST', 800, 0);
  const html = renderAbaSemanal([registro(1600)], [0], ['volume'], 6, { demandas, diaDoMes: 1, diasNoMes: 28 });
  // 800 furos no mês, dividido em 4 = 200 por semana -- escopado à linha
  // Realizado especificamente (não a Tendência, que aqui é diferente).
  const linhaRealizado = html.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
  const duzentos = (200).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const oitocentos = (800).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  assert.strictEqual((linhaRealizado.match(new RegExp(duzentos.replace('.', '\\.'), 'g')) || []).length, 4, 'as 4 semanas mostram 200,00 cada -- 800 furos no mês ÷ 4');
  assert.match(linhaRealizado, new RegExp('celula-total-linha">' + oitocentos.replace('.', '\\.')), 'a coluna de fechamento (Total, dimensão Volume soma) mostra 800,00 -- a soma das 4 semanas, não 200');
});

test('Realizado/Tendência só aparecem no bloco Volume -- Equipes e Financeiro continuam sem-dado mesmo com demandas presente', () => {
  const demandas = demandasFixture('SUP-0001-24', 'ST', 800, 0);
  const html = renderAbaSemanal([registro(1600)], [0], ['equipes', 'financeiro'], 6, { demandas, diaDoMes: 28, diasNoMes: 28 });
  assert.doesNotMatch(html, /Demandas Pendentes/);
  const linhasSemDado = (html.match(/class="num sem-dado"/g) || []).length;
  assert.strictEqual(linhasSemDado, 16, '2 dimensões x 4 semanas x 2 linhas (Realizado + Tendência), nenhuma delas é Volume');
});

test('Tendência: semanas já passadas usam o Realizado nominal, semanas futuras distribuem o saldo restante igualmente -- soma bate com o Previsto', () => {
  // Previsto do mês = 800 (200/semana nominal). Realizado do mês = 400 (100/semana
  // nominal). diaDoMes=10 num mês de 28 dias -> semanaAtual = ceil(10/7) = 2.
  const demandas = demandasFixture('SUP-0001-24', 'ST', 400, 0);
  const html = renderAbaSemanal([registro(800)], [0], ['volume'], 6, { demandas, diaDoMes: 10, diasNoMes: 28 });
  // Semanas 1-2 (passadas): Realizado nominal = 100 cada. Semanas 3-4 (futuras):
  // saldoRestante = 800 - (100*2) = 600, dividido por 2 semanas restantes = 300 cada.
  const cem = (100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const trezentos = (300).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const oitocentos = (800).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const linhaTendencia = html.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
  assert.strictEqual((linhaTendencia.match(new RegExp(cem.replace('.', '\\.'), 'g')) || []).length, 2, 'as 2 primeiras semanas devem mostrar 100 (Realizado nominal)');
  assert.strictEqual((linhaTendencia.match(new RegExp(trezentos.replace('.', '\\.'), 'g')) || []).length, 2, 'as 2 últimas semanas devem mostrar 300 (saldo distribuído)');
  assert.match(linhaTendencia, new RegExp(oitocentos.replace('.', '\\.') + '</td>'), 'a soma das 4 semanas de Tendência bate com o Previsto do mês (800) -- "mantido o resto do plano, o mês fecha como planejado"');
});

test('linha Demandas Pendentes: só a célula de fechamento, as 4 semanas ficam sem-dado', () => {
  const demandas = demandasFixture('SUP-0001-24', 'ST', 0, 150);
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6, { demandas, diaDoMes: 1, diasNoMes: 28 });
  const linhaPendentes = html.match(/<tr class="linha-serie-semanal linha-pendentes-demandas">[\s\S]*?<\/tr>/);
  assert.ok(linhaPendentes, 'esperava uma linha com classe linha-pendentes-demandas');
  assert.match(linhaPendentes[0], /Demandas Pendentes/);
  const semDadoNaLinha = (linhaPendentes[0].match(/class="num sem-dado"/g) || []).length;
  assert.strictEqual(semDadoNaLinha, 4, 'as 4 células de semana ficam sem-dado -- Pendentes é estoque, não se divide');
  const centoECinquenta = (150).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  assert.match(linhaPendentes[0], new RegExp('celula-total-linha">' + centoECinquenta.replace('.', '\\.')));
});

test('registro cuja combinação (sup, tipologia) não existe em demandas.porRegistro contribui 0, não é excluído da soma', () => {
  const demandas = demandasFixture('SUP-0002-24', 'ST', 400, 0); // registro abaixo é SUP-0001-24, não bate
  const html = renderAbaSemanal([registro(400)], [0], ['volume'], 6, { demandas, diaDoMes: 28, diasNoMes: 28 });
  const linhaRealizado = html.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
  assert.doesNotMatch(linhaRealizado, /sem-dado/, 'indices não está vazio -- deve somar 0, não cair pra sem-dado, já que "sem furo" é uma contagem real, não uma lacuna');
  assert.match(linhaRealizado, /<td class="num">0,00<\/td>/);
});

// --- Revisão final da branch -------------------------------------------------

test('vigenteIdx fora do intervalo do ano (12 ou -1) deixa Realizado/Tendência/Pendentes sem-dado, não 0,00', () => {
  const demandas = { totais: { sondagemRealizada: new Array(12).fill(0), pendentes: new Array(12).fill(0) }, porRegistro: { 'SUP-0001-24||ST': { sondagemRealizada: [0,0,0,0,0,0,800,0,0,0,0,0], pendentes: [0,0,0,0,0,0,50,0,0,0,0,0] } } };
  const registros = [{ sup: 'SUP-0001-24', tipologia: 'ST', previsto: { volume: [0,0,0,0,0,0,800,0,0,0,0,0], equipes: new Array(12).fill(0), financeiro: new Array(12).fill(0) } }];
  const html = renderAbaSemanal(registros, [0], ['volume'], 12, { demandas, diaDoMes: 10, diasNoMes: 28 });
  assert.doesNotMatch(html.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0], /800,00|0,00/, 'com vigenteIdx=12 (fora do ano), Realizado não pode aparecer nem como valor real nem como 0,00 fabricado');
  assert.match(html, /Demandas Pendentes/, 'a linha ainda aparece (Volume + porRegistro presente), só as células ficam sem-dado');
});

test('Tendência nunca fica negativa quando Realizado já passou o Previsto -- continua no ritmo já realizado, não projeta furos negativos', () => {
  const demandas = { totais: { sondagemRealizada: new Array(12).fill(0), pendentes: new Array(12).fill(0) }, porRegistro: { 'SUP-0001-24||ST': { sondagemRealizada: [0,0,0,0,0,0,400,0,0,0,0,0], pendentes: new Array(12).fill(0) } } };
  const registros = [{ sup: 'SUP-0001-24', tipologia: 'ST', previsto: { volume: [0,0,0,0,0,0,100,0,0,0,0,0], equipes: new Array(12).fill(0), financeiro: new Array(12).fill(0) } }];
  const html = renderAbaSemanal(registros, [0], ['volume'], 6, { demandas, diaDoMes: 10, diasNoMes: 31 }); // dia 10/31 -> semana 2
  const linhaTendencia = html.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
  // /-/ cru bateria também nos hífens de "linha-serie-semanal"/"linha-tendencia"
  // (nomes de classe, não números) -- ">-" isola o caso real: um valor
  // negativo sempre começa logo depois do "<td ...>" de abertura da célula.
  assert.doesNotMatch(linhaTendencia, />-/, 'nenhum valor negativo deve aparecer na linha de Tendência');
  const cem = (100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  assert.strictEqual((linhaTendencia.match(new RegExp(cem.replace('.', '\\.'), 'g')) || []).length, 4, 'realizado=400/4=100 por semana; as 2 semanas passadas mostram 100 (Realizado) e as 2 futuras também mostram 100 (ritmo mantido) -- 4 ocorrências de "100,00" na linha inteira');
});

test('Tendência: na última semana do mês (sem semana futura), a soma bate exatamente com o Realizado', () => {
  const demandas = { totais: { sondagemRealizada: new Array(12).fill(0), pendentes: new Array(12).fill(0) }, porRegistro: { 'SUP-0001-24||ST': { sondagemRealizada: [0,0,0,0,0,0,600,0,0,0,0,0], pendentes: new Array(12).fill(0) } } };
  const registros = [{ sup: 'SUP-0001-24', tipologia: 'ST', previsto: { volume: [0,0,0,0,0,0,800,0,0,0,0,0], equipes: new Array(12).fill(0), financeiro: new Array(12).fill(0) } }];
  const html = renderAbaSemanal(registros, [0], ['volume'], 6, { demandas, diaDoMes: 28, diasNoMes: 28 }); // último dia -> semana 4, sem semana futura
  const linhaTendencia = html.match(/<tr class="linha-serie-semanal linha-tendencia">[\s\S]*?<\/tr>/)[0];
  const linhaRealizado = html.match(/<tr class="linha-serie-semanal linha-realizado">[\s\S]*?<\/tr>/)[0];
  // Comparar as linhas inteiras (só trocando o nome da classe) esbarraria no
  // rótulo visível ("Tendência" vs "Realizado"), que nunca vai bater -- o
  // que a asserção realmente quer garantir é que os NÚMEROS das 2 linhas
  // são idênticos, não o texto do rótulo. Extrai só as células <td class="num...">.
  const numerosTendencia = linhaTendencia.match(/<td class="num[^"]*">[^<]*<\/td>/g);
  const numerosRealizado = linhaRealizado.match(/<td class="num[^"]*">[^<]*<\/td>/g);
  assert.deepStrictEqual(numerosTendencia, numerosRealizado, 'na última semana, sem saldo futuro pra projetar, Tendência precisa mostrar os mesmos números que Realizado');
});
