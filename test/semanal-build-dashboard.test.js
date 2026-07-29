'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderSemanal } = require('../tools/semanal/render-semanal.js');
const { baselineParaCliente } = require('../tools/semanal/build-dashboard.js');

// grupo/tomador são identificadores sintéticos de propósito: >=12
// caracteres e com hífen, pro alvo do teste "nenhum identificador aparece
// em texto puro" abaixo não colidir por acaso com o próprio ruído
// aleatório do blob cifrado (ver o comentário na frente da 2ª asserção).
const REGISTROS = [{
  origem: 'CONTRATO VIGENTE', grupo: 'Grupo-Sintetico-Beta', tomador: 'Tomador-Sintetico-Alfa', sup: 'SUP-0001-24',
  escopo: 'E', apoio: 'A', inicio: 45439, termino: 47265, tipologia: 'ST', observacao: null,
  previsto:  { equipes: new Array(12).fill(1), volume: new Array(12).fill(400), financeiro: new Array(12).fill(1000),
               equipesResumo: { pico: 1, media: 1, prod: 8, dias: 25 },
               volumeResumo: { total: 4800, totalInicial: 4800, ticket: 2.5 },
               financeiroResumo: { total: 12000, totalInicial: 12000 } },
  realizado: { equipes: new Array(12).fill(0), volume: new Array(12).fill(0), financeiro: new Array(12).fill(0),
               equipesResumo: { pico: 0, media: 0, prod: 8, dias: 25 },
               volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
               financeiroResumo: { total: 0, totalInicial: 0 } },
  total:     { equipes: new Array(12).fill(0), volume: new Array(12).fill(0), financeiro: new Array(12).fill(0),
               equipesResumo: { pico: 0, media: 0, prod: 8, dias: 25 },
               volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
               financeiroResumo: { total: 0, totalInicial: 0 } },
}];

test('gera HTML com as duas abas e a casca compartilhada', () => {
  const html = renderSemanal({ registros: REGISTROS, baseline: [], senha: 'fake', geradoEm: new Date(0) });
  assert.match(html, /id="aba-semanal"/);
  assert.match(html, /id="aba-balanco"/);
  assert.match(html, /abas-visualizacao/);
  assert.match(html, /--text-primary/);
});

// O alvo de cada assert precisa ser longo/distintivo o bastante pra nunca
// colidir por acaso com o próprio ruído aleatório do blob cifrado (base64
// de um AES-256-GCM com salt/IV novos a cada chamada) -- um alvo curto tipo
// "T1" tem chance real de aparecer por puro acaso dentro desse ruído, o que
// reprovaria o teste sem vazamento nenhum (medido: ~10-43% das rodadas,
// ver task-7-report.md). '-' nunca aparece no alfabeto base64 padrão
// (A-Za-z0-9+/), então qualquer alvo com hífen -- como os identificadores
// sintéticos abaixo, ou o próprio SUP-0001-24 -- é estruturalmente imune a
// esse falso positivo, não só estatisticamente improvável.
test('nenhum identificador aparece em texto puro', () => {
  const html = renderSemanal({ registros: REGISTROS, baseline: [], senha: 'fake', geradoEm: new Date(0) });
  assert.doesNotMatch(html, /SUP-0001-24/, 'SUP vazou fora do blob cifrado');
  assert.doesNotMatch(html, /Tomador-Sintetico-Alfa/, 'tomador vazou fora do blob cifrado');
  assert.doesNotMatch(html, /Grupo-Sintetico-Beta/, 'grupo vazou fora do blob cifrado');
});

test('a senha nunca aparece no HTML', () => {
  const html = renderSemanal({ registros: REGISTROS, baseline: [], senha: 'senha-secreta-123', geradoEm: new Date(0) });
  assert.doesNotMatch(html, /senha-secreta-123/);
});

// parseBaseline() (tools/orcamento/parse-baseline.js) devolve { porChave },
// um Map de "SUP||tipologia" -> {equipes,volume,financeiro}. build-dashboard.js
// converte isso com baselineParaCliente() antes de passar pra renderSemanal,
// que faz JSON.stringify({registros, baseline}) -- um Map cru sobrevive a
// ISSO como "{}" (JSON.stringify não sabe serializar Map), apagando a linha
// de base inteira, em silêncio, de dentro do próprio blob cifrado. Trava os
// dois lados: o conversor preserva os dados, e o Map cru (sem o conversor)
// reproduz o apagamento -- prova que o teste reprovaria se a conversão
// fosse removida de build-dashboard.js.
test('baselineParaCliente preserva os dados do Map da linha de base através de JSON.stringify', () => {
  const porChave = new Map([
    ['SUP-0001-24||ST', { equipes: [1, 2], volume: [100, 200], financeiro: [1000, 2000] }],
    ['SUP-0002-24||SP', { equipes: [3, 4], volume: [300, 400], financeiro: [3000, 4000] }],
  ]);

  const baseline = baselineParaCliente(porChave);
  const rodaTrip = JSON.parse(JSON.stringify(baseline));
  assert.deepStrictEqual(rodaTrip, [
    { chave: 'SUP-0001-24||ST', equipes: [1, 2], volume: [100, 200], financeiro: [1000, 2000] },
    { chave: 'SUP-0002-24||SP', equipes: [3, 4], volume: [300, 400], financeiro: [3000, 4000] },
  ]);

  // Prova que a conversão é necessária, não decorativa: o MESMO Map, sem
  // passar por baselineParaCliente, sai vazio do outro lado de JSON.stringify.
  const semConversao = JSON.parse(JSON.stringify(porChave));
  assert.deepStrictEqual(semConversao, {}, 'um Map cru precisa "desaparecer" em JSON.stringify -- é exatamente o bug que baselineParaCliente existe para evitar');
});

// Fim a fim: renderSemanal({baseline: <o array de baselineParaCliente>})
// realmente entrega esses dados decifráveis no HTML (não só que o array em
// si sobrevive a um JSON.stringify isolado).
test('o baseline convertido chega inteiro dentro do blob cifrado do HTML', () => {
  const porChave = new Map([['SUP-0001-24||ST', { equipes: [1], volume: [100], financeiro: [1000] }]]);
  const baseline = baselineParaCliente(porChave);
  const senha = 'fake';
  const html = renderSemanal({ registros: REGISTROS, baseline, senha, geradoEm: new Date(0) });

  const { decifrarComSenha } = require('../tools/comum/criptografia.js');
  const match = html.match(/window\.__DADOS_CIFRADOS__\s*=\s*(\{[\s\S]*?\});/);
  assert.ok(match, 'window.__DADOS_CIFRADOS__ not found in the built HTML');
  const dados = JSON.parse(decifrarComSenha(JSON.parse(match[1]), senha));
  assert.deepStrictEqual(dados.baseline, [{ chave: 'SUP-0001-24||ST', equipes: [1], volume: [100], financeiro: [1000] }]);
});
