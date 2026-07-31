'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderSemanal } = require('../tools/semanal/render-semanal.js');
const { renderAbaSemanal } = require('../tools/semanal/render-aba-semanal.js');
const { baselineParaCliente } = require('../tools/semanal/build-dashboard.js');
const { diaEpoch } = require('../tools/comum/datas.js');

// Os 12 meses da MATRIZ como datas -- em produção saem do cabeçalho da
// planilha (build-dashboard.js); aqui basta o ano bater com o de geradoEm
// para calcularVigenteIdx cair no caso "mês real dentro do ano". Todos os
// testes deste arquivo usam geradoEm = new Date(0) (1970-01-01).
function periodosDoAno(ano) {
  return Array.from({ length: 12 }, (_, mes) => new Date(Date.UTC(ano, mes, 1)));
}
const PERIODOS = periodosDoAno(1970);

// A aba Demandas passou a ser obrigatória no payload (renderSemanal lança sem
// ela, de propósito -- ver o comentário lá). Agregado mínimo válido: sem
// tipologia nenhuma, renderAbaDemandas rende o aviso de "sem dado".
const DEMANDAS_VAZIAS = { tipologias: [], totais: {}, porRegistroEventos: {} };

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
  const html = renderSemanal({ registros: REGISTROS, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS, senha: 'fake', geradoEm: new Date(0) });
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
  const html = renderSemanal({ registros: REGISTROS, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS, senha: 'fake', geradoEm: new Date(0) });
  assert.doesNotMatch(html, /SUP-0001-24/, 'SUP vazou fora do blob cifrado');
  assert.doesNotMatch(html, /Tomador-Sintetico-Alfa/, 'tomador vazou fora do blob cifrado');
  assert.doesNotMatch(html, /Grupo-Sintetico-Beta/, 'grupo vazou fora do blob cifrado');
});

test('a senha nunca aparece no HTML', () => {
  const html = renderSemanal({ registros: REGISTROS, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS, senha: 'senha-secreta-123', geradoEm: new Date(0) });
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
//
// Os registros abaixo casam DIRETO com as chaves do Map (nenhuma tradução
// necessária), então a saída sai com as mesmas chaves -- o rechaveamento
// pela MATRIZ tem arquivo próprio: test/semanal-linha-base-costura.test.js.
test('baselineParaCliente preserva os dados do Map da linha de base através de JSON.stringify', () => {
  const porChave = new Map([
    ['SUP-0001-24||ST', { equipes: [1, 2], volume: [100, 200], financeiro: [1000, 2000] }],
    ['SUP-0002-24||SP', { equipes: [3, 4], volume: [300, 400], financeiro: [3000, 4000] }],
  ]);
  const registros = [{ sup: 'SUP-0001-24', tipologia: 'ST' }, { sup: 'SUP-0002-24', tipologia: 'SP' }];

  const baseline = baselineParaCliente(porChave, registros);
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
  const baseline = baselineParaCliente(porChave, REGISTROS);
  const senha = 'fake';
  const html = renderSemanal({ registros: REGISTROS, baseline, demandas: DEMANDAS_VAZIAS, periodos: PERIODOS, senha, geradoEm: new Date(0) });

  const { decifrarComSenha } = require('../tools/comum/criptografia.js');
  const match = html.match(/window\.__DADOS_CIFRADOS__\s*=\s*(\{[\s\S]*?\});/);
  assert.ok(match, 'window.__DADOS_CIFRADOS__ not found in the built HTML');
  const dados = JSON.parse(decifrarComSenha(JSON.parse(match[1]), senha));
  assert.deepStrictEqual(dados.baseline, [{ chave: 'SUP-0001-24||ST', equipes: [1], volume: [100], financeiro: [1000] }]);
});

// --- Revisão final da branch -------------------------------------------------

// A 3ª linha da tabela semanal (Tendência) emite .linha-tendencia, que não
// tem regra em cssBase() -- as irmãs .linha-previsto/.linha-realizado têm, e
// por isso a linha renderizava sem cor nenhuma, como se fosse de outro tipo.
// O CSS novo vive em CSS_SEMANAL (bloco próprio desta página): cssBase() é
// compartilhada com o orçamento e test/orcamento-html-inalterado.test.js
// trava o HTML dele byte a byte, então mexer nela reprovaria o golden.
// Genérico de propósito: uma 4ª série futura sem CSS também é pega aqui.
test('toda classe linha-* da tabela semanal tem regra de CSS na página gerada', () => {
  const html = renderSemanal({ registros: REGISTROS, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS, senha: 'fake', geradoEm: new Date(0) });
  const estilo = html.match(/<style>([\s\S]*?)<\/style>/)[1];

  const demandas = { porRegistroEventos: {} };
  const tabela = renderAbaSemanal(REGISTROS, [0], ['volume'], 0, 1970, { demandas, hojeEpoch: diaEpoch(new Date(1970, 0, 15)) });
  const classes = [...new Set([...tabela.matchAll(/class="linha-serie-semanal (linha-[a-z-]+)"/g)].map(m => m[1]))];
  assert.deepStrictEqual(classes, ['linha-previsto', 'linha-realizado', 'linha-tendencia', 'linha-pendentes-demandas'], 'pré-condição: são estas as 4 séries da tabela hoje (com porRegistro presente ativando a linha de Pendentes)');

  classes.forEach(classe => {
    assert.ok(estilo.includes(`.${classe} `), `a classe ${classe} é emitida pela tabela mas não tem nenhuma regra no <style> da página -- a linha renderiza sem cor`);
  });

  // Tendência usa o MESMO dourado que o orçamento usa na Tendência dele
  // (.linha-total, em cssBase()) -- é o mesmo sistema visual nos dois painéis.
  assert.match(estilo, /\.linha-tendencia \.serie-label[^}]*#f6b53f/);
});

// vigenteIdx saía de geradoEm.getUTCMonth(), que assume que os registros são
// sempre do ano corrente. Em 2027-01, com a MATRIZ de 2026 ainda no ar, isso
// devolveria 0 e a página trataria JANEIRO DE 2026 como mês vigente -- errado
// e em silêncio. calcularVigenteIdx (tools/comum/datas.js), a mesma função
// que o orçamento já usa, compara o ano de periodos[0] com o de geradoEm.
test('vigenteIdx vem de calcularVigenteIdx, não do mês de geradoEm -- a virada de ano não vira "janeiro" da planilha antiga', () => {
  const periodos2026 = periodosDoAno(2026);
  const gerar = (iso) => renderSemanal({
    registros: REGISTROS, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: periodos2026, senha: 'fake', geradoEm: new Date(iso),
  });

  assert.match(gerar('2026-07-15T00:00:00Z'), /window\.__VIGENTE_IDX__ = 6;/, 'dentro do ano da planilha, é o mês mesmo');
  assert.match(gerar('2027-01-15T00:00:00Z'), /window\.__VIGENTE_IDX__ = 12;/, 'ano da planilha inteiro no passado -- 12, nunca 0 (que seria janeiro de 2026)');
  assert.match(gerar('2025-12-15T00:00:00Z'), /window\.__VIGENTE_IDX__ = -1;/, 'ano da planilha inteiro no futuro -- -1, nunca 11');
});

test('renderSemanal recusa build sem "periodos" -- sem eles não dá para decidir o mês vigente sem chutar o ano', () => {
  assert.throws(
    () => renderSemanal({ registros: REGISTROS, baseline: [], demandas: DEMANDAS_VAZIAS, senha: 'fake', geradoEm: new Date(0) }),
    /periodos/
  );
});
