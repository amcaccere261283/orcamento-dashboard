'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { renderSemanal } = require('../tools/semanal/render-semanal.js');
const { criarDocumentoFalso } = require('./helpers/dom-falso-semanal.js');

const SENHA_FAKE = 'senha-fake-de-teste-relatorio-nao-e-a-real';
const PERIODOS_2026 = Array.from({ length: 12 }, (_, mes) => new Date(Date.UTC(2026, mes, 1)));
const DEMANDAS_VAZIAS = { tipologias: [], totais: {}, porRegistroEventos: {} };

function registroSintetico(sup, tomador, tipologia, previstoVolumeMes) {
  const zeros = new Array(12).fill(0);
  const volume = new Array(12).fill(0); volume[6] = previstoVolumeMes; // julho
  const bloco = (equipes, vol, financeiro) => ({
    equipes, volume: vol, financeiro,
    equipesResumo: { pico: 2, media: 2, prod: 8, dias: 25 },
    volumeResumo: { total: 0, totalInicial: 0, ticket: 1 },
    financeiroResumo: { total: 0, totalInicial: 0 },
  });
  return {
    sup, grupo: 'Grupo-Relatorio', tomador, tipologia,
    previsto: bloco(new Array(12).fill(2), volume, zeros),
    realizado: bloco(new Array(12).fill(0), zeros, zeros),
    total: bloco(new Array(12).fill(2), zeros, zeros),
  };
}

// Mesmo padrão de test/semanal-render-semanal-wireup.test.js (6 <script>,
// vm.Context isolado), com Blob/URL/document.createElement A MAIS -- a aba
// Consolidado ganhou um botão que baixa um .xlsx via Blob, e o DOM falso
// compartilhado (dom-falso-semanal.js) não tinha createElement porque
// nenhum recurso anterior precisava criar elemento nenhum.
function montarSandbox(html) {
  const blocos = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(blocos.length, 6);
  const codigo = blocos.join('\n;\n');

  const documentoFalso = criarDocumentoFalso();
  const ancoraCriada = { href: '', download: '', style: {}, cliques: 0, click() { this.cliques++; } };
  documentoFalso.createElement = () => ancoraCriada;
  documentoFalso.body = { appendChild() {}, removeChild() {} };

  const blobsCriados = [];
  function BlobFalso(partes, opcoes) { blobsCriados.push({ partes, opcoes }); }
  const URLFalso = { createObjectURL() { return 'blob:fake-url'; }, revokeObjectURL() {} };

  const sandbox = {
    document: documentoFalso, atob, btoa, crypto, TextEncoder, TextDecoder, console,
    fetch: () => Promise.reject(new Error('fetch não mockado neste teste')),
    localStorage: { getItem: () => null, setItem() {} },
    Blob: BlobFalso, URL: URLFalso,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(codigo, sandbox, { filename: 'planejamento-semanal-relatorio-teste.js' });
  return { sandbox, documentoFalso, ancoraCriada, blobsCriados };
}

test('a aba Consolidado tem o botão "Gerar relatório Excel" e o span de status', () => {
  const html = renderSemanal({ registros: [], baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z') });
  assert.match(html, /<button id="gerar-relatorio-excel" type="button">/);
  assert.match(html, /<span id="status-relatorio-excel"[^>]*><\/span>/);
});

test('clicar em "Gerar relatório Excel" baixa um .xlsx (via Blob) e o status reflete a contagem de desvios', async () => {
  const registros = [
    registroSintetico('SUP-0001-24', 'Tomador-A', 'ST', 100),
    registroSintetico('SUP-0002-24', 'Tomador-B', 'ST', 50),
  ];
  const geradoEm = new Date('2026-07-15T00:00:00Z'); // dentro de julho/2026
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso, ancoraCriada, blobsCriados } = montarSandbox(html);

  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  // Dispara pelo MESMO caminho que montarAbaConsolidado liga
  // (addEventListener('click', gerarRelatorioExcel)) -- chamar
  // sandbox.gerarRelatorioExcel() direto não provaria que o listener foi
  // de fato registrado no botão. gerarRelatorioExcel é `async function`
  // de verdade (devolve a Promise que só resolve depois do `await`
  // interno em clienteHistoricoRelatorio().gravar(lote)), diferente de
  // atualizarDadosAoVivoSemanal (fire-and-forget, exige o boundary de
  // setImmediate de chamarEsperarAtualizacao em
  // semanal-render-semanal-wireup.test.js) -- aqui um `await` direto
  // sobre o clique já é suficiente.
  const botao = documentoFalso.getElementById('gerar-relatorio-excel');
  assert.ok(botao, 'esperava o botão #gerar-relatorio-excel no DOM');
  await botao.listeners.click();

  assert.strictEqual(blobsCriados.length, 1, 'esperava um Blob criado (o .xlsx)');
  assert.strictEqual(blobsCriados[0].opcoes.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.ok(blobsCriados[0].partes[0].length > 0, 'o .xlsx não pode vir vazio');
  assert.strictEqual(ancoraCriada.cliques, 1, 'o link de download precisa ser clicado uma vez');
  assert.match(ancoraCriada.download, /^relatorio-semanal-\d{4}-\d{2}-\d{2}\.xlsx$/);
  assert.match(documentoFalso.getElementById('status-relatorio-excel').textContent, /Relatório baixado \(Crítico: \d+ · Atenção: \d+\)/);
});

test('a chamada a RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx e a HistoricoRelatorioSheet.criarClienteHistoricoRelatorio estão no código-fonte de gerarRelatorioExcel', () => {
  const html = renderSemanal({ registros: [], baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z') });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const scriptCliente = scripts[5][1];
  assert.match(scriptCliente, /RenderRelatorioSemanalXlsx\.gerarRelatorioSemanalXlsx\(/);
  assert.match(scriptCliente, /HistoricoRelatorioSheet\.criarClienteHistoricoRelatorio\(/);
});
