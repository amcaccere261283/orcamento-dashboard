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
  assert.equal(blocos.length, 8);
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
  // URL_HISTORICO_RELATORIO ainda é o placeholder PENDENTE- nesta branch, então
  // toda geração cai em modo local -- o status precisa dizer isso, não só
  // parecer um sucesso indistinguível de um envio de verdade à Sheet.
  assert.match(
    documentoFalso.getElementById('status-relatorio-excel').textContent,
    /Relatório baixado \(Crítico: \d+ · Atenção: \d+\) · histórico local \(Apps Script não publicado\)/
  );
  assert.strictEqual(botao.disabled, false, 'o botão precisa voltar a habilitado depois de terminar');
});

test('indiceAtual nunca é -1, mesmo com o mês selecionado fora do mês que contém "hoje" (Fix Crítico da revisão final)', async () => {
  const registros = [
    registroSintetico('SUP-0001-24', 'Tomador-A', 'ST', 100),
    registroSintetico('SUP-0002-24', 'Tomador-B', 'ST', 50),
  ];
  const geradoEm = new Date('2026-07-15T00:00:00Z');
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso } = montarSandbox(html);

  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  // Força o mês SELECIONADO a ficar a 6 meses de distância do mês real de
  // hoje (a data do relógio da máquina que roda o teste, não `geradoEm`
  // acima -- montarOpcoesRelatorioSemanal usa hojeEpochDoNavegador(), que lê
  // Date real) -- garante que "hoje" nunca cai dentro das semanas do mês
  // selecionado, não importa em que dia o teste rodar. window.__ANO__ vem
  // fixo de PERIODOS_2026 (2026): se o teste rodar num ano civil diferente
  // de 2026, o ano sozinho já garante o mesmo descasamento.
  sandbox.mesSelecionadoIdx = (new Date().getMonth() + 6) % 12;

  const indices = sandbox.indicesFiltrados(
    sandbox.window.__REGISTROS__,
    sandbox.filtrosSelecionadosSemanal.tipologia, sandbox.filtrosSelecionadosSemanal.categoria,
    sandbox.filtrosSelecionadosSemanal.grupo, sandbox.filtrosSelecionadosSemanal.sup, sandbox.filtrosSelecionadosSemanal.origem
  );
  const opcoes = sandbox.montarOpcoesRelatorioSemanal(sandbox.window.__REGISTROS__, indices);

  assert.ok(
    opcoes.indiceAtual >= 0 && opcoes.indiceAtual < opcoes.semanas.length,
    'indiceAtual nunca pode ser -1, mesmo com o mês selecionado fora do mês corrente (era ' + opcoes.indiceAtual + ')'
  );
});

test('um clique duplo (re-entrância) não dispara a geração duas vezes', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-A', 'ST', 100)];
  const geradoEm = new Date('2026-07-15T00:00:00Z');
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso, blobsCriados } = montarSandbox(html);

  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  const botao = documentoFalso.getElementById('gerar-relatorio-excel');
  const primeiro = botao.listeners.click();
  // Dispara um segundo clique síncrono, antes do primeiro terminar (o botão
  // já deveria estar `disabled`, e o guard ESTADO_RELATORIO_SEMANAL.gerando
  // precisa recusar o segundo antes mesmo do disabled ter efeito prático).
  const segundo = botao.listeners.click();
  await Promise.all([primeiro, segundo]);

  assert.strictEqual(blobsCriados.length, 1, 'o segundo clique, em voo com o primeiro, não pode gerar um segundo .xlsx');
});

test('um erro durante a geração aparece no status em vez de deixar "Gerando..." travado', async () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-A', 'ST', 100)];
  const geradoEm = new Date('2026-07-15T00:00:00Z');
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso } = montarSandbox(html);

  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  sandbox.RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx = () => { throw new Error('falha proposital de teste'); };

  const botao = documentoFalso.getElementById('gerar-relatorio-excel');
  await botao.listeners.click();

  assert.match(
    documentoFalso.getElementById('status-relatorio-excel').textContent,
    /Erro ao gerar o relatório: falha proposital de teste/
  );
  assert.strictEqual(botao.disabled, false, 'o botão precisa reabilitar mesmo depois de um erro');
  assert.strictEqual(sandbox.ESTADO_RELATORIO_SEMANAL.gerando, false, 'o guard de re-entrância precisa liberar mesmo depois de um erro');
});

test('a chamada a RenderRelatorioSemanalXlsx.gerarRelatorioSemanalXlsx e a HistoricoRelatorioSheet.criarClienteHistoricoRelatorio estão no código-fonte de gerarRelatorioExcel', () => {
  const html = renderSemanal({ registros: [], baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z') });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const scriptCliente = scripts[7][1];
  assert.match(scriptCliente, /RenderRelatorioSemanalXlsx\.gerarRelatorioSemanalXlsx\(/);
  assert.match(scriptCliente, /HistoricoRelatorioSheet\.criarClienteHistoricoRelatorio\(/);
});
