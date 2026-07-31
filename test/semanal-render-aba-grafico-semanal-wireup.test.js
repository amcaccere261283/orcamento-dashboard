'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { renderSemanal } = require('../tools/semanal/render-semanal.js');
const { criarDocumentoFalso } = require('./helpers/dom-falso-semanal.js');

// Aba Gráficos (achado de 2026-08-01): mesmo padrão de
// semanal-render-aba-balanco-wireup.test.js -- roda os <script> de cliente
// de dentro do HTML gerado, num vm.Context à parte, com o Web Crypto nativo
// do Node. Ao contrário de Balanço, render-aba-grafico-semanal.js não
// consome tools/comum/calculo-equipes.js (nenhuma média ponderada por
// dias aqui -- Equipes semanal é uma foto repetida, não uma média entre
// semanas), então não depende da injeção de fonteParaCliente() pra não
// quebrar com ReferenceError.

const SENHA_FAKE = 'senha-fake-de-teste-grafico-semanal-nao-e-a-real';
const PERIODOS_2026 = Array.from({ length: 12 }, (_, mes) => new Date(Date.UTC(2026, mes, 1)));
const TIPOLOGIA_SINTETICA = 'Tipologia-Sintetica-Grafico';
const DEMANDAS_VAZIAS = { tipologias: [], totais: {}, porRegistroEventos: {} };

function registroSintetico(sup, tipologia, previstoMes) {
  const zeros = new Array(12).fill(0);
  // Popula Volume E Financeiro com o MESMO previstoMes -- alguns testes
  // usam o seletor de dimensão padrão (Financeiro), outros marcam Volume
  // explicitamente; os dois precisam ter dado real pra desenhar barra.
  const vol = new Array(12).fill(0); vol[6] = previstoMes; // julho -- mesmo vigenteIdx dos testes abaixo
  const fin = new Array(12).fill(0); fin[6] = previstoMes;
  const eq = new Array(12).fill(2);
  const bloco = (v, f, e) => ({
    equipes: e, volume: v, financeiro: f,
    equipesResumo: { pico: 2, media: 2, prod: 8, dias: 25 },
    volumeResumo: { total: 0, totalInicial: 0, ticket: 1 },
    financeiroResumo: { total: 0, totalInicial: 0 },
  });
  return {
    sup, grupo: 'Grupo-Sintetico-Grafico', tomador: 'Tomador-Sintetico-Grafico', tipologia,
    previsto: bloco(vol, fin, eq), realizado: bloco(zeros, zeros, eq), total: bloco(zeros, zeros, zeros),
  };
}

function rodarBlocos(blocos) {
  const codigo = blocos.join('\n;\n');
  const documentoFalso = criarDocumentoFalso();
  const sandbox = { document: documentoFalso, atob, btoa, crypto, TextEncoder, TextDecoder, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(codigo, sandbox, { filename: 'planejamento-semanal-grafico.js' });
  return { sandbox, documentoFalso };
}

function extrairBlocos(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

test('depois da senha certa, clicar na aba Gráficos desenha SVG de verdade em #secao-grafico-semanal', async () => {
  const registros = [registroSintetico('SUP-0001-24', TIPOLOGIA_SINTETICA, 1000)];
  const geradoEm = new Date('2026-07-01T00:00:00Z'); // vigenteIdx = 6 (julho)
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });

  assert.match(html, /<div id="secao-grafico-semanal" style="display:none">/);
  assert.match(html, /<div id="grafico-semanal-conteudo">/);
  assert.match(html, /<div id="grafico-semanal-tooltip" class="grafico-tooltip" style="display:none">/);

  const blocos = extrairBlocos(html);
  const { sandbox, documentoFalso } = rodarBlocos(blocos);

  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  assert.notEqual(documentoFalso.getElementById('gate-senha-erro').style.display, 'block', 'senha certa não pode acusar erro');

  documentoFalso.getElementById('aba-grafico-semanal').listeners.click();

  assert.equal(documentoFalso.getElementById('secao-grafico-semanal').style.display, '', 'clicar na aba precisa mostrar a seção');
  assert.equal(documentoFalso.getElementById('secao-semanal').style.display, 'none', 'trocar de aba esconde a Semanal');

  const htmlMontado = documentoFalso.getElementById('grafico-semanal-conteudo').innerHTML;
  assert.notEqual(htmlMontado, '', '#grafico-semanal-conteudo continua vazio depois de trocar de aba');
  assert.match(htmlMontado, /class="grafico-svg"/);
  // Ao contrário da aba Balanço de massa (um painel por tipologia, com o
  // nome dela no título), a aba Gráficos é agregada por DIMENSÃO -- não há
  // nome de tipologia no SVG (mesmo formato do Gráfico no orçamento). A
  // prova de conteúdo real é o rótulo da dimensão e uma barra desenhada.
  assert.match(htmlMontado, /Semanal — Financeiro/);
  assert.match(htmlMontado, /class="grafico-barra"/, 'previsto 1000 > 0 -- espera pelo menos uma barra desenhada');
});

test('o HTML cru (antes de rodar qualquer script) nunca contém a tipologia/SUP/tomador da aba Gráficos em texto puro', () => {
  const registros = [registroSintetico('SUP-0002-24', TIPOLOGIA_SINTETICA, 500)];
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z') });
  assert.doesNotMatch(html, new RegExp(TIPOLOGIA_SINTETICA));
  assert.doesNotMatch(html, /SUP-0002-24/);
  assert.doesNotMatch(html, /Grupo-Sintetico-Grafico/);
});

// Ao contrário da aba Balanço de massa (um painel POR tipologia, com o nome
// dela no título do SVG), a aba Gráficos é agregada -- um painel por
// DIMENSÃO, somando todos os registros filtrados juntos (mesmo formato do
// Gráfico no orçamento). Não há nome de tipologia pra procurar no SVG; a
// prova de que o filtro chegou até aqui é o VALOR mostrado mudar quando o
// recorte muda -- usa o data-tooltip (que carrega o número exato) em vez
// de rótulo de eixo, pra não confundir com um tick "redondo" que calhe de
// ter o mesmo dígito.
test('filtrar por tipologia na barra compartilhada recalcula a aba Gráficos -- o valor somado reflete só os registros filtrados', async () => {
  const registros = [
    registroSintetico('SUP-0010-24', TIPOLOGIA_SINTETICA, 1000),
    registroSintetico('SUP-0011-24', 'OUTRA-TIPOLOGIA-GRAFICO', 500),
  ];
  const geradoEm = new Date('2026-07-01T00:00:00Z');
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const blocos = extrairBlocos(html);
  const { sandbox, documentoFalso } = rodarBlocos(blocos);

  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  // Marca Volume no seletor de dimensão (Financeiro, o padrão, continua
  // marcado também -- seletor-dimensao é multi-select, minimoUm:true, não
  // substitui) -- registroSintetico só popula previsto.volume.
  const painelDimensao = documentoFalso.getElementById('seletor-dimensao-painel');
  const checkboxVolume = painelDimensao.querySelectorAll('input[type="checkbox"]').filter((c) => c.value === 'volume')[0];
  assert.ok(checkboxVolume, 'esperava um checkbox "volume" no seletor de dimensão');
  checkboxVolume.checked = true;
  checkboxVolume.listeners.change();

  // Sem filtro de tipologia: previsto semanal combinado = (1000+500)/5 = 300.
  let htmlGrafico = documentoFalso.getElementById('grafico-semanal-conteudo').innerHTML;
  assert.match(htmlGrafico, /Previsto: 300/);

  const painelTipologia = documentoFalso.getElementById('filtro-tipologia-painel');
  const checkboxes = painelTipologia.querySelectorAll('input[type="checkbox"]');
  const checkboxSintetica = checkboxes.filter((c) => c.value === TIPOLOGIA_SINTETICA)[0];
  assert.ok(checkboxSintetica, 'esperava um checkbox pra ' + TIPOLOGIA_SINTETICA + ' no painel montado');
  checkboxSintetica.checked = true;
  checkboxSintetica.listeners.change();

  // Filtrado só na tipologia sintética: previsto semanal = 1000/5 = 200.
  htmlGrafico = documentoFalso.getElementById('grafico-semanal-conteudo').innerHTML;
  assert.match(htmlGrafico, /Previsto: 200/);
  assert.doesNotMatch(htmlGrafico, /Previsto: 300/, 'depois do filtro, o valor combinado dos dois registros não pode mais aparecer');
});

test('trocar de aba pra Gráficos e voltar pra Semanal alterna a visibilidade certinho (mutuamente exclusivas com Balanço/Demandas)', async () => {
  const registros = [registroSintetico('SUP-0020-24', TIPOLOGIA_SINTETICA, 1000)];
  const geradoEm = new Date('2026-07-01T00:00:00Z');
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const blocos = extrairBlocos(html);
  const { sandbox, documentoFalso } = rodarBlocos(blocos);

  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  documentoFalso.getElementById('aba-balanco').listeners.click();
  assert.equal(documentoFalso.getElementById('secao-balanco').style.display, '');
  assert.equal(documentoFalso.getElementById('secao-grafico-semanal').style.display, 'none');

  documentoFalso.getElementById('aba-grafico-semanal').listeners.click();
  assert.equal(documentoFalso.getElementById('secao-grafico-semanal').style.display, '');
  assert.equal(documentoFalso.getElementById('secao-balanco').style.display, 'none');
  assert.equal(documentoFalso.getElementById('secao-semanal').style.display, 'none');
  assert.equal(documentoFalso.getElementById('secao-demandas').style.display, 'none');

  documentoFalso.getElementById('aba-semanal').listeners.click();
  assert.equal(documentoFalso.getElementById('secao-semanal').style.display, '');
  assert.equal(documentoFalso.getElementById('secao-grafico-semanal').style.display, 'none');
});
