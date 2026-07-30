'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { renderSemanal } = require('../tools/semanal/render-semanal.js');
const { renderAbaBalanco } = require('../tools/semanal/render-aba-balanco.js');

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
const DEMANDAS_VAZIAS = { tipologias: [], totais: {} };

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

// Mesmo DOM mínimo do arquivo irmão (semanal-render-semanal-wireup.test.js):
// getElementById devolve sempre o MESMO objeto por id, com listeners
// memoizados por tipo de evento -- suficiente para addEventListener/
// classList.toggle/style/value/innerHTML/focus, que é tudo que os scripts
// de cliente desta página usam.
function criarDocumentoFalso() {
  const elementos = {};
  function elemento(id) {
    if (!elementos[id]) {
      elementos[id] = {
        id,
        style: {},
        classList: { toggle() {} },
        listeners: {},
        addEventListener(tipo, fn) { this.listeners[tipo] = fn; },
        focus() {},
        value: '',
        checked: false,
        textContent: '',
        innerHTML: '',
        disabled: false,
      };
    }
    return elementos[id];
  }
  return { elementos, getElementById: elemento };
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

  const vigenteIdx = geradoEm.getUTCMonth();
  const indicesTodos = registros.map((_, i) => i);
  const esperado = renderAbaBalanco(registros, indicesTodos, {
    periodo: 'mesVigente', base: 'previsto', dimensao: 'financeiro', somenteAtivos: true,
    vigenteIdx, baseline: [],
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
  assert.match(htmlMontado, /class="barra-abaixo"/, 'previsto 4000 > realizado 1000 -- desvio negativo, barra à esquerda');

  // Os 4 controles (período/base/dimensão/somente ativos) também precisam
  // ter sido montados -- é o que SCRIPT_CLIENTE_SEMANAL religa a cada
  // redesenho.
  assert.match(htmlMontado, /id="balanco-periodo"/);
  assert.match(htmlMontado, /id="balanco-base"/);
  assert.match(htmlMontado, /id="balanco-dimensao"/);
  assert.match(htmlMontado, /id="balanco-somente-ativos"/);
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
