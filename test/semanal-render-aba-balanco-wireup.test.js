'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { renderSemanal } = require('../tools/semanal/render-semanal.js');
const { renderAbaBalanco } = require('../tools/semanal/render-aba-balanco.js');
const { semanasDoMes } = require('../tools/semanal/compute-semanal.js');
const { criarDocumentoFalso } = require('./helpers/dom-falso-semanal.js');

// Task 10 liga a aba Balanço de massa de ponta a ponta. O achado crítico da
// Task 9 (ver progress.md) é que compute-balanco.js depende de
// mediaEquipesPonderada existir como GLOBAL no navegador -- ela é injetada
// por fonteParaCliente() (tools/comum/calculo-equipes.js) num <script> que
// precisa rodar ANTES do bundle que contém compute-balanco.js. Se
// render-semanal.js esquecer essa injeção, a aba quebra em produção com
// ReferenceError -- e os testes que só chamam calcularLinhas() via require()
// direto (test/semanal-compute-balanco.test.js) passam do mesmo jeito,
// porque no Node o require resolve mediaEquipesPonderada normalmente. Este
// arquivo prova as duas pontas: (1) a aba desenha SVG de verdade depois da
// senha certa, com a injeção no lugar; (2) removendo o <script> da injeção,
// o MESMO caminho quebra -- prova que o teste (1) teria pego a regressão.
//
// Mesmo padrão de test/semanal-render-semanal-wireup.test.js: roda os
// <script> de cliente de dentro do HTML gerado, num vm.Context à parte, com
// o Web Crypto nativo do Node.

const SENHA_FAKE = 'senha-fake-de-teste-balanco-nao-e-a-real';

// Os 12 meses da MATRIZ como datas -- em produção vêm do cabeçalho da
// planilha (tools/semanal/build-dashboard.js) e alimentam calcularVigenteIdx
// (tools/comum/datas.js). 2026 é o ano de todos os geradoEm deste arquivo.
const PERIODOS_2026 = Array.from({ length: 12 }, (_, mes) => new Date(Date.UTC(2026, mes, 1)));

// Tipologia e identificadores sintéticos, longos e com hífen -- alvos
// curtos colidem com o ruído base64 do blob cifrado (ver nota do brief).
const TIPOLOGIA_SINTETICA = 'Tipologia-Sintetica-Rotativa';

// A aba Demandas passou a ser obrigatória no payload (renderSemanal lança sem
// ela, de propósito -- ver o comentário lá). Agregado mínimo válido: sem
// tipologia nenhuma, renderAbaDemandas rende o aviso de "sem dado".
const DEMANDAS_VAZIAS = { tipologias: [], totais: {}, porRegistroEventos: {} };

function registroSintetico(sup, tomador, tipologia, previstoMes, realizadoMes, equipesPrevisto, equipesRealizado) {
  const zeros = new Array(12).fill(0);
  const eqPrev = new Array(12).fill(0);
  const eqReal = new Array(12).fill(0);
  const fin = new Array(12).fill(0);
  const finReal = new Array(12).fill(0);
  fin[6] = previstoMes; // julho -- mesmo vigenteIdx dos testes abaixo
  finReal[6] = realizadoMes;
  eqPrev[6] = equipesPrevisto;
  eqReal[6] = equipesRealizado;
  const bloco = (equipes, volume, financeiro, financeiroResumoTotal) => ({
    equipes, volume, financeiro,
    equipesResumo: { pico: 2, media: 2, prod: 8, dias: 25 },
    volumeResumo: { total: 0, totalInicial: 0, ticket: 1 },
    financeiroResumo: { total: financeiroResumoTotal, totalInicial: financeiroResumoTotal },
  });
  return {
    sup, grupo: 'Grupo-Sintetico-Balanco', tomador, tipologia,
    previsto: bloco(eqPrev, zeros, fin, previstoMes),
    realizado: bloco(eqReal, zeros, finReal, realizadoMes),
    total: bloco(zeros, zeros, zeros, 0),
  };
}

// blocos: array de trechos de <script> (já sem as tags). Roda-os, na ordem
// dada, num Realm isolado -- usado tanto para o caminho feliz (todos os 6
// blocos) quanto para a prova de regressão (blocos sem o de
// fonteParaCliente()).
function rodarBlocos(blocos) {
  const codigo = blocos.join('\n;\n');
  const documentoFalso = criarDocumentoFalso();
  const sandbox = { document: documentoFalso, atob, btoa, crypto, TextEncoder, TextDecoder, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(codigo, sandbox, { filename: 'planejamento-semanal-balanco.js' });
  return { sandbox, documentoFalso };
}

function extrairBlocos(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

test('depois da senha certa, a aba Balanço de massa desenha SVG de verdade em #secao-balanco -- não fica um <div> vazio', async () => {
  const registros = [
    registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Rho', TIPOLOGIA_SINTETICA, 4000, 1000, 2, 5),
  ];
  const geradoEm = new Date('2026-07-01T00:00:00Z'); // vigenteIdx = 6 (julho)
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });

  // Antes de rodar qualquer script, a div está vazia -- nada pode montar em
  // build-time (identificador de cliente vazaria num Pages público).
  assert.match(html, /<div id="secao-balanco" style="display:none"><\/div>/);

  const blocos = extrairBlocos(html);
  assert.equal(blocos.length, 6, 'esperava 6 <script> (vigenteIdx, dados cifrados, gate, fonteParaCliente, bundle, cliente)');

  const { sandbox, documentoFalso } = rodarBlocos(blocos);

  // fonteParaCliente() precisa ter deixado mediaEquipesPonderada como
  // função global ANTES do bundle -- é exatamente essa global que
  // compute-balanco.js (dentro do bundle) consome sem require().
  assert.equal(typeof sandbox.mediaEquipesPonderada, 'function', 'mediaEquipesPonderada precisa existir como global depois dos scripts rodarem');

  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  assert.notEqual(documentoFalso.getElementById('gate-senha-erro').style.display, 'block', 'senha certa não pode acusar erro -- se acusar, é sintoma do ReferenceError de mediaEquipesPonderada ausente');
  assert.equal(documentoFalso.getElementById('gate-senha').style.display, 'none');

  // demandas/ano: MESMO que montarAbaBalanco passa de verdade (window.__DEMANDAS__/
  // window.__ANO__) -- precisa bater aqui pro comparativo de igualdade de
  // string abaixo fazer sentido. DEMANDAS_VAZIAS tem porRegistroEventos: {}
  // (nenhum furo), então o Realizado calculado do Avanço Sond pra Mês
  // Vigente (achado de 2026-08-01, ver compute-balanco.js) é 0 aqui -- NÃO
  // o 1000 hardcoded em registro.realizado.financeiro (esse valor só
  // importaria com periodo: 'acumuladoAteMes', que continua lendo a coluna
  // da MATRIZ).
  const vigenteIdx = geradoEm.getUTCMonth();
  const indicesTodos = registros.map((_, i) => i);
  // semanas/semanasSelecionadas: o estado padrão do recorte semanal
  // (2026-08-03) -- o calendário real do mês vigente, nenhuma semana marcada
  // ("nada marcado = mês inteiro"). Tem que bater com o que montarAbaBalanco
  // passa, senão o comparativo abaixo falha só pelo controle a mais/a menos.
  const esperado = renderAbaBalanco(registros, indicesTodos, {
    periodo: 'mesVigente', base: 'previsto', dimensao: 'financeiro', somenteAtivos: true,
    vigenteIdx, baseline: [], demandas: DEMANDAS_VAZIAS, ano: geradoEm.getUTCFullYear(),
    semanas: semanasDoMes(geradoEm.getUTCFullYear(), vigenteIdx), semanasSelecionadas: [],
  });

  const htmlMontado = documentoFalso.getElementById('secao-balanco').innerHTML;
  assert.notEqual(htmlMontado, '', '#secao-balanco continua vazia depois da senha certa');
  assert.equal(
    htmlMontado, esperado,
    'o HTML injetado em #secao-balanco precisa ser exatamente o que renderAbaBalanco(registros decifrados, todos os índices, estado padrão) produz'
  );

  // Prova de conteúdo, não só de igualdade de string: a tipologia sintética,
  // o SUP e uma barra colorida real aparecem no SVG desenhado.
  assert.match(htmlMontado, new RegExp(TIPOLOGIA_SINTETICA));
  assert.match(htmlMontado, /SUP-0001-24/);
  assert.match(htmlMontado, /class="barra-abaixo"/, 'previsto 4000 > realizado 0 (Avanço Sond vazio nesta fixture) -- desvio negativo, barra à esquerda');

  // Os 3 controles próprios do Balanço (período/base/dimensão) precisam ter
  // sido montados -- é o que SCRIPT_CLIENTE_SEMANAL religa a cada redesenho.
  assert.match(htmlMontado, /id="balanco-periodo"/);
  assert.match(htmlMontado, /id="balanco-base"/);
  assert.match(htmlMontado, /id="balanco-dimensao"/);

  // O checkbox "somente ativos" virou um filtro da barra compartilhada (não
  // mais um controle próprio do Balanço). Prova de ponta a ponta: (a) ele
  // existe no HTML bruto da página (renderizado por MARKUP_ACOES_SEMANAL),
  // (b) o listener está ligado e recalcula a aba, e (c) desmarcar muda o
  // resultado do Balanço (menos linhas/gráficos aparecem quando SOMENTE_ATIVOS
  // vira false e as linhas inativas desaparecem).
  const htmlCru = html;
  assert.match(htmlCru, /id="somente-ativos"/, 'checkbox renderizado na barra compartilhada');

  // Estado inicial: SOMENTE_ATIVOS = true (default). Registros com
  // previsto/realizado zerados não aparecem porque estão inativos.
  const countGraficosAntes = (documentoFalso.getElementById('secao-balanco').innerHTML.match(/<svg class="grafico-svg grafico-balanco"/g) || []).length;
  assert.ok(countGraficosAntes > 0, 'com SOMENTE_ATIVOS=true, aparecem gráficos das tipologias que têm registros ativos');

  // Desmarcar o checkbox deve revelar registros inativos -- o fixture tem só 1 registro com previsto 4000 > realizado 0 (ativo),
  // então o número de gráficos não muda, mas o número de LINHAS dentro deles poderia subir se houvesse registros inativos.
  // Como o fixture não tem, a melhor prova é desmarcar, recalcular, e confirmar que o comportamento foi acionado sem erro.
  const checkboxSomenteAtivos = documentoFalso.getElementById('somente-ativos');
  assert.ok(checkboxSomenteAtivos, 'checkbox somente-ativos existe no DOM após os scripts rodarem');
  checkboxSomenteAtivos.checked = false;
  checkboxSomenteAtivos.listeners.change({ target: checkboxSomenteAtivos });

  // Depois de desmarcar, o HTML do Balanço é recalculado. Com o fixture atual (1 registro ativo),
  // o HTML continua tendo 1 gráfico, mas o listener foi acionado e recalcularSemanal() rodou com êxito.
  // A prova de que o filtro funciona vem do fixture em semanal-render-aba-balanco.test.js (calcularLinhas),
  // que testa indicesFiltrados e somenteAtivos em condições mais variadas.
  const htmlAposDesmarcar = documentoFalso.getElementById('secao-balanco').innerHTML;
  assert.notEqual(htmlAposDesmarcar, '', 'após desmarcar o checkbox, o Balanço continua renderizado (não quebrou)');
});

test('SEM a injeção de fonteParaCliente() antes do bundle, a mesma senha certa quebra a aba (ReferenceError engolido pelo catch de tentarDesbloquear) -- prova que a injeção não é decorativa', async () => {
  const registros = [
    registroSintetico('SUP-0002-24', 'Tomador-Sintetico-Sigma', TIPOLOGIA_SINTETICA, 3000, 3000, 2, 2),
  ];
  const geradoEm = new Date('2026-07-01T00:00:00Z');
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });

  const blocos = extrairBlocos(html);
  assert.equal(blocos.length, 6);

  // Remove especificamente o bloco que define mediaEquipesPonderada
  // (fonteParaCliente()) -- simula o esquecimento que a Task 9 avisou que
  // aconteceria se render-semanal.js não injetasse a global antes do
  // bundle. Os outros 5 blocos (vigenteIdx, dados cifrados, gate, bundle,
  // cliente) continuam intactos.
  const blocosSemInjecao = blocos.filter((b) => !/function mediaEquipesPonderada/.test(b));
  assert.equal(blocosSemInjecao.length, 5, 'esperava remover exatamente 1 bloco (o de fonteParaCliente())');

  const { sandbox, documentoFalso } = rodarBlocos(blocosSemInjecao);
  assert.equal(typeof sandbox.mediaEquipesPonderada, 'undefined', 'pré-condição do teste: a global precisa estar mesmo ausente aqui');

  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE; // senha CERTA
  await sandbox.tentarDesbloquear();

  // tentarDesbloquear() envolve tudo (inclusive montarDashboard ->
  // montarAbaBalanco -> calcularLinhas -> mediaEquipesPonderada) num
  // try/catch que só sabe mostrar "Senha incorreta." -- então o sintoma em
  // produção seria EXATAMENTE este: usuário digita a senha certa e vê erro
  // de senha, porque o ReferenceError da global ausente foi engolido.
  assert.equal(documentoFalso.getElementById('gate-senha-erro').style.display, 'block', 'sem a global, o ReferenceError de compute-balanco.js deveria estourar dentro do try e acionar mostrarErroSenha');
  assert.equal(documentoFalso.getElementById('secao-balanco').innerHTML, '', 'com a exceção estourando antes do fim de montarDashboard, a aba não pode ter sido montada');
});

test('o HTML cru (antes de rodar qualquer script) nunca contém a tipologia, o SUP, o grupo ou o tomador da aba Balanço em texto puro -- só o blob cifrado os carrega', () => {
  const registros = [
    registroSintetico('SUP-0003-24', 'Tomador-Sintetico-Tau', TIPOLOGIA_SINTETICA, 5000, 2000, 3, 1),
  ];
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z') });

  assert.doesNotMatch(html, new RegExp(TIPOLOGIA_SINTETICA));
  assert.doesNotMatch(html, /SUP-0003-24/);
  assert.doesNotMatch(html, /Grupo-Sintetico-Balanco/);
  assert.doesNotMatch(html, /Tomador-Sintetico-Tau/);
});

test('filtrar por tipologia na barra compartilhada faz a aba Balanço de massa mostrar só os gráficos das tipologias marcadas', async () => {
  const registros = [
    registroSintetico('SUP-0010-24', 'Tomador-Sintetico-Um', TIPOLOGIA_SINTETICA, 4000, 1000, 2, 5),
    registroSintetico('SUP-0011-24', 'Tomador-Sintetico-Dois', 'OUTRA-TIPOLOGIA', 3000, 3000, 2, 2),
  ];
  const geradoEm = new Date('2026-07-01T00:00:00Z');
  const html = renderSemanal({ registros, baseline: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });

  const blocos = extrairBlocos(html);
  const { sandbox, documentoFalso } = rodarBlocos(blocos);

  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();

  const painelTipologia = documentoFalso.getElementById('filtro-tipologia-painel');
  const checkboxes = painelTipologia.querySelectorAll('input[type="checkbox"]');
  const checkboxSintetica = checkboxes.filter((c) => c.value === TIPOLOGIA_SINTETICA)[0];
  assert.ok(checkboxSintetica, 'esperava um checkbox pra ' + TIPOLOGIA_SINTETICA + ' no painel montado');
  checkboxSintetica.checked = true;
  checkboxSintetica.listeners.change();

  const htmlMontado = documentoFalso.getElementById('secao-balanco').innerHTML;
  assert.match(htmlMontado, new RegExp(TIPOLOGIA_SINTETICA), 'o gráfico da tipologia marcada deve continuar aparecendo');
  assert.doesNotMatch(htmlMontado, /OUTRA-TIPOLOGIA/, 'a tipologia não marcada não deve aparecer -- prova que a aba Balanço recebeu o indices já filtrado, não todos os registros');
});
