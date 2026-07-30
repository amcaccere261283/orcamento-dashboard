'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { baselineParaCliente } = require('../tools/semanal/build-dashboard.js');
const { calcularLinhas } = require('../tools/semanal/compute-balanco.js');
const { renderSemanal } = require('../tools/semanal/render-semanal.js');
const { renderAbaBalanco } = require('../tools/semanal/render-aba-balanco.js');

// A COSTURA que ninguém atravessava: build-dashboard.js/baselineParaCliente
// (que serializa a linha de base) -> compute-balanco.js/chaveBaseline (que a
// procura no navegador).
//
// O estudo de linha de base usa OUTROS rótulos que a MATRIZ viva: 'LAB.' e
// 'LAB. ESPECIAL' onde a MATRIZ diz LAB.C/LAB.E, e 7 SUPs com nome antigo ou
// descritivo (SUP_MAP_LINHA_BASE). O orçamento sempre reconciliou isso em
// anexarPrevistoInicial; a página semanal, não -- ela mandava as chaves
// ORIGINAIS pro cliente e lá chaveBaseline procurava `sup||tipologia` CRU.
// Resultado: LAB.C e LAB.E sozinhas (68 das 340 linhas da grade real) mais os
// 7 SUPs mapeados sairiam TODAS como semBase:true -- indistinguível de
// "contrato entrou depois do estudo", que é o caso que a seção Riscos da
// spec exige que apareça de forma inconfundível, e faria as duas páginas
// discordarem sobre o mesmo número.
//
// Todo teste daqui usa uma chave que PRECISA dos dois mapas ao mesmo tempo:
// SUP-6830-23 + LAB.C na MATRIZ <-> SUP-6830-24 + 'LAB.' na linha de base.
// (SUP-6830-23/24 é um dos 7 pares reais já registrados em
// tools/comum/linha-base.js e em test/orcamento-anexar-previsto-inicial.test.js
// -- código de contrato, não nome de cliente.) Trocar reconciliarLinhaBase
// por um `Array.from(porChave, ...)` cru derruba este arquivo inteiro.

const SENHA_FAKE = 'senha-fake-de-teste-linha-base-nao-e-a-real';
const PERIODOS_2026 = Array.from({ length: 12 }, (_, mes) => new Date(Date.UTC(2026, mes, 1)));
const VIGENTE_IDX = 6; // julho
const TIPOLOGIA_MATRIZ = 'LAB.C';        // rótulo da MATRIZ viva
const TIPOLOGIA_LINHA_BASE = 'LAB.';     // rótulo do estudo original
const SUP_MATRIZ = 'SUP-6830-23';        // código atual
const SUP_LINHA_BASE = 'SUP-6830-24';    // nome do mesmo contrato no estudo

function serie(financeiroMes, equipesMes) {
  const financeiro = new Array(12).fill(0);
  const equipes = new Array(12).fill(0);
  financeiro[VIGENTE_IDX] = financeiroMes;
  equipes[VIGENTE_IDX] = equipesMes;
  return {
    financeiro, equipes, volume: new Array(12).fill(0),
    equipesResumo: { pico: 0, media: 0, prod: 8, dias: 25 },
    volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
    financeiroResumo: { total: financeiroMes, totalInicial: financeiroMes },
  };
}

function registro(sup, previstoFin, realizadoFin, equipesPrevisto, equipesRealizado) {
  return {
    sup, grupo: 'Grupo-Sintetico-LinhaBase', tomador: 'Tomador-Sintetico-LinhaBase',
    tipologia: TIPOLOGIA_MATRIZ,
    previsto: serie(previstoFin, equipesPrevisto),
    realizado: serie(realizadoFin, equipesRealizado),
    total: serie(0, 0),
  };
}

function entradaLinhaBase(financeiroMes, equipesMes) {
  const financeiro = new Array(12).fill(0);
  const equipes = new Array(12).fill(0);
  financeiro[VIGENTE_IDX] = financeiroMes;
  equipes[VIGENTE_IDX] = equipesMes;
  return { equipes, volume: new Array(12).fill(0), financeiro };
}

// 3 SUPs na MESMA tipologia LAB.C:
//  - SUP-6830-23: só acha a linha de base se OS DOIS mapas forem aplicados;
//  - SUP-0001-24: só precisa da tradução da tipologia (LAB.C -> 'LAB.');
//  - SUP-0009-26: genuinamente não estava no estudo -- ESTE, e só este, deve
//    sair como "sem base". É o contraste que a spec exige.
function cenario() {
  const registros = [
    registro(SUP_MATRIZ, 1000, 1500, 2, 4),
    registro('SUP-0001-24', 2000, 1200, 3, 1),
    registro('SUP-0009-26', 500, 100, 1, 1),
  ];
  const porChave = new Map([
    [`${SUP_LINHA_BASE}||${TIPOLOGIA_LINHA_BASE}`, entradaLinhaBase(800, 5)],
    [`SUP-0001-24||${TIPOLOGIA_LINHA_BASE}`, entradaLinhaBase(900, 1)],
  ]);
  return { registros, porChave };
}

test('baselineParaCliente entrega a linha de base RECHAVEADA pela MATRIZ -- SUP-6830-23 + LAB.C, que no estudo é SUP-6830-24 + "LAB."', () => {
  const { registros, porChave } = cenario();
  const baseline = baselineParaCliente(porChave, registros);

  assert.deepStrictEqual(baseline.map(e => e.chave), [
    `${SUP_MATRIZ}||${TIPOLOGIA_MATRIZ}`,
    `SUP-0001-24||${TIPOLOGIA_MATRIZ}`,
  ], 'as chaves entregues ao cliente precisam ser as da MATRIZ (sup e tipologia crus) -- chaveBaseline, em compute-balanco.js, procura exatamente isso e não pode carregar os mapas de tradução');

  // Não é só o rótulo: os dados que vieram junto são os do SUP certo.
  assert.strictEqual(baseline[0].financeiro[VIGENTE_IDX], 800);
  assert.strictEqual(baseline[1].financeiro[VIGENTE_IDX], 900);

  // Nenhuma chave do ESTUDO pode ter sobrado -- se sobrasse, o cliente
  // receberia uma entrada que nenhuma busca dele jamais alcançaria.
  assert.ok(!baseline.some(e => e.chave.startsWith(SUP_LINHA_BASE)), 'a chave original do estudo não pode chegar ao cliente');
  assert.ok(!baseline.some(e => e.chave.endsWith(`||${TIPOLOGIA_LINHA_BASE}`)), 'a tipologia do estudo não pode chegar ao cliente');
});

test('a costura fecha: o que baselineParaCliente produz é achado por chaveBaseline em calcularLinhas, inclusive na linha que precisa dos DOIS mapas', () => {
  const { registros, porChave } = cenario();
  const baseline = baselineParaCliente(porChave, registros);

  const linhas = calcularLinhas({
    registros, indices: [0, 1, 2], tipologia: TIPOLOGIA_MATRIZ,
    base: 'previstoInicial', dimensao: 'financeiro', periodo: 'mesVigente',
    vigenteIdx: VIGENTE_IDX, baseline,
  });

  // SUP-6830-23 + LAB.C: precisa de SUP_MAP_LINHA_BASE **e** de
  // TIP_MAP_LINHA_BASE. Sem a reconciliação, esta é a linha que vira
  // semBase:true em silêncio.
  assert.strictEqual(linhas[0].sup, SUP_MATRIZ);
  assert.strictEqual(linhas[0].semBase, false, 'SUP-6830-23/LAB.C TEM linha de base (via SUP-6830-24/"LAB.") -- marcá-lo como sem base seria indistinguível de contrato novo');
  assert.strictEqual(linhas[0].valorBase, 800);
  assert.strictEqual(linhas[0].desvio, 700);   // 1500 realizado - 800 base
  assert.strictEqual(linhas[0].equipesBase, 5);
  assert.strictEqual(linhas[0].desvioEquipes, -1); // 4 realizado - 5 base

  // SUP-0001-24 + LAB.C: precisa só da tradução da tipologia.
  assert.strictEqual(linhas[1].semBase, false);
  assert.strictEqual(linhas[1].valorBase, 900);
  assert.strictEqual(linhas[1].desvio, 300);   // 1200 - 900

  // SUP-0009-26: ausência de verdade. O valor de "sem base" é justamente
  // este contraste -- ele só significa alguma coisa se as outras duas linhas
  // NÃO estiverem marcadas junto.
  assert.strictEqual(linhas[2].semBase, true);
  assert.strictEqual(linhas[2].valorBase, null);
  assert.strictEqual(linhas[2].desvio, null);
});

// --- Fim a fim, dentro da página gerada -------------------------------------
// Mesmo padrão dos arquivos irmãos (semanal-render-aba-balanco-wireup.test.js):
// roda os <script> do HTML num vm.Context, com o Web Crypto nativo do Node.
// Fecha DE UMA VEZ o item do ledger "Task 8: window.__BASELINE__ sem
// cobertura" -- é a mesma costura: fecharTendenciaVigente desembrulha
// {registros, baseline} e guarda o baseline ali, e é de lá que
// montarAbaBalanco o lê quando a base escolhida é 'previstoInicial'.

// DOM mínimo o bastante pro script de cliente rodar de ponta a ponta,
// AGORA incluindo a barra de filtros compartilhada (montarFiltroMulti/
// configurarAberturaFiltrosMulti, de scriptFiltros()) -- getElementById
// devolve sempre o MESMO objeto por id (memoizado); querySelector/
// querySelectorAll resolvem os poucos seletores que montarFiltroMulti de
// fato usa e sintetizam checkboxes reais (com addEventListener/change
// disparável) a partir do innerHTML que montarFiltroMulti escreveu, igual a
// test/comum-filtros-wireup.test.js (tools/comum/render-shell.js) já faz.
function criarDocumentoFalso() {
  const elementos = {};
  const checkboxesPorPainel = new Map();

  function criarCheckboxFake(valor, checked) {
    const listeners = {};
    return { value: valor, checked, listeners, addEventListener(tipo, fn) { listeners[tipo] = fn; } };
  }

  // Sintetiza os <input type="checkbox"> do innerHTML do painel -- cache
  // por texto de innerHTML (uma remontagem gera checkboxes NOVOS, igual ao
  // DOM real substituindo os nós ao reatribuir innerHTML).
  function checkboxesDoPainel(painel) {
    const cacheKey = painel.innerHTML;
    const cache = checkboxesPorPainel.get(painel);
    if (cache && cache.key === cacheKey) return cache.lista;
    const lista = [];
    const re = /<input type="checkbox" value="([^"]*)"( checked)?>/g;
    let m;
    while ((m = re.exec(painel.innerHTML))) lista.push(criarCheckboxFake(m[1], !!m[2]));
    checkboxesPorPainel.set(painel, { key: cacheKey, lista });
    return lista;
  }

  function elemento(id) {
    if (!elementos[id]) {
      const el = {
        id,
        style: {},
        classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
        listeners: {},
        addEventListener(tipo, fn) { this.listeners[tipo] = fn; },
        focus() {},
        value: '',
        textContent: '',
        innerHTML: '',
        disabled: false,
        closest() { return el; },
        appendChild() {}, // atualizarRotuloFiltro chama trigger.appendChild(seta) pra recolocar a seta depois de reescrever o textContent
        // Só os 5 seletores que montarFiltroMulti/configurarAberturaFiltrosMulti
        // chamam sobre um elemento já resolvido (o gatilho, o painel, e o
        // que existe dentro do painel).
        querySelector(sel) {
          if (sel === '.filtro-multi-trigger') return elemento(id + '-trigger');
          if (sel === '.filtro-multi-painel') return elemento(id + '-painel');
          if (sel === '.filtro-multi-seta') return {};
          if (sel === '.filtro-multi-busca') return null; // sem busca digitada nestes testes
          if (sel === '.filtro-multi-vazio-busca') return { hidden: false };
          return null;
        },
        querySelectorAll(sel) {
          if (sel === 'input[type="checkbox"]') return checkboxesDoPainel(el);
          return [];
        },
      };
      elementos[id] = el;
    }
    return elementos[id];
  }

  return {
    elementos,
    getElementById: elemento,
    // document.querySelector só é chamado como '#algum-id .filtro-multi-trigger'
    // ou '#algum-id .filtro-multi-painel' (ver atualizarRotuloFiltro/montarFiltroMulti
    // em scriptFiltros()) -- resolve pro mesmo elemento(id) e delega.
    querySelector(sel) {
      const m = /^#([\w-]+) (\.filtro-multi-(?:trigger|painel))$/.exec(sel);
      return m ? elemento(m[1]).querySelector(m[2]) : null;
    },
    querySelectorAll() { return []; }, // .filtro-multi-trigger/.filtro-multi.aberto globais -- vazios de propósito, nenhum teste depende de achar outro filtro já aberto
    addEventListener() {},
  };
}

function rodarPagina(html) {
  const blocos = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.equal(blocos.length, 6, 'esperava 6 <script> (vigenteIdx, dados cifrados, gate, fonteParaCliente, bundle, cliente)');
  const documentoFalso = criarDocumentoFalso();
  const sandbox = { document: documentoFalso, atob, btoa, crypto, TextEncoder, TextDecoder, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(blocos.join('\n;\n'), sandbox, { filename: 'planejamento-semanal-linha-base.js' });
  return { sandbox, documentoFalso };
}

function contarOcorrencias(texto, alvo) {
  return texto.split(alvo).length - 1;
}

test('na página gerada, a base "Previsto Inicial" só marca "sem base" no SUP que realmente não estava no estudo -- e window.__BASELINE__ carrega o que baselineParaCliente produziu', async () => {
  const { registros, porChave } = cenario();
  const baseline = baselineParaCliente(porChave, registros);
  const geradoEm = new Date('2026-07-01T00:00:00Z');

  const html = renderSemanal({ registros, baseline, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm });
  const { sandbox, documentoFalso } = rodarPagina(html);

  documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
  await sandbox.tentarDesbloquear();
  assert.notEqual(documentoFalso.getElementById('gate-senha-erro').style.display, 'block', 'senha certa não pode acusar erro');

  // Item do ledger da Task 8: até aqui NENHUM teste olhava window.__BASELINE__.
  // fecharTendenciaVigente é quem o preenche, a partir do {registros,
  // baseline} decifrado -- se ele voltasse a devolver o objeto inteiro (o bug
  // que a Task 8 corrigiu) ou parasse de guardar o baseline, a aba Balanço
  // perderia a base inteira em silêncio.
  // Reserializado antes de comparar: os objetos nascem DENTRO do vm.Context,
  // com Object/Array de outro Realm -- deepStrictEqual reprovaria pelo
  // protótipo, não pelo conteúdo.
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.__BASELINE__)), baseline, 'window.__BASELINE__ precisa ser exatamente o array de baselineParaCliente que foi cifrado no HTML');
  assert.strictEqual(sandbox.__BASELINE__[0].chave, `${SUP_MATRIZ}||${TIPOLOGIA_MATRIZ}`);
  assert.ok(Array.isArray(sandbox.__REGISTROS__), 'window.__REGISTROS__ tem que continuar sendo só o array de registros, não o embrulho {registros, baseline}');

  // Troca o seletor de base para "Previsto Inicial" -- o mesmo listener que
  // montarAbaBalanco religa a cada redesenho.
  documentoFalso.getElementById('balanco-base').listeners.change({ target: { value: 'previstoInicial' } });

  const svg = documentoFalso.getElementById('secao-balanco').innerHTML;
  const esperado = renderAbaBalanco(registros, [0, 1, 2], {
    periodo: 'mesVigente', base: 'previstoInicial', dimensao: 'financeiro', somenteAtivos: true,
    vigenteIdx: VIGENTE_IDX, baseline,
  });
  assert.equal(svg, esperado, 'a aba redesenhada com base "Previsto Inicial" precisa bater com renderAbaBalanco -- prova que window.__BASELINE__ chegou lá dentro com o conteúdo certo');

  // A asserção que a reconciliação sustenta: DOS TRÊS SUPs, exatamente UM
  // aparece como "sem base". Com as chaves cruas (sem reconciliarLinhaBase),
  // os três apareceriam -- e o rótulo perderia todo o significado.
  assert.strictEqual(contarOcorrencias(svg, 'sem base'), 1, 'só SUP-0009-26 (o que de fato não estava no estudo) pode aparecer como "sem base"');
  assert.match(svg, /class="barra-acima"/, 'os dois SUPs com base têm desvio positivo (+700 e +300) -- precisa haver barra desenhada, não só rótulo');
});
