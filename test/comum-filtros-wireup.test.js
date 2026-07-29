'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { scriptFiltros } = require('../tools/comum/render-shell.js');

// DOM mínimo o bastante pra montarFiltroMulti/configurarAberturaFiltrosMulti
// rodarem de ponta a ponta -- só os métodos que elas de fato chamam (mesma
// convenção de criarLinhaFake em test/orcamento-render-dashboard.test.js e
// criarDocumentoFalso em test/semanal-render-semanal-wireup.test.js).
// `buscar`/`buscarTodos` precisam existir ANTES de criarElemento pra ele
// poder fechar sobre elas (querySelector/querySelectorAll de um elemento
// devolvem outros elementos do mesmo registro) -- por isso as duas famílias
// de função vivem juntas dentro de criarSandboxDom, não em módulo separado.
function criarSandboxDom() {
  const registrados = {};

  function criarElemento(seletor) {
    const classes = new Set();
    const listeners = {};
    const el = {
      seletor,
      hidden: false,
      value: '',
      textContent: '',
      innerHTML: '',
      style: {},
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
      },
      listeners,
      addEventListener(tipo, fn) { listeners[tipo] = fn; },
      focus() {},
      appendChild() {},
      querySelector: buscar,
      querySelectorAll: buscarTodos,
      closest: () => el,
    };
    return el;
  }

  function buscar(sel) {
    if (!registrados[sel]) registrados[sel] = criarElemento(sel);
    return registrados[sel];
  }

  // Só é chamada pra '.filtro-multi-item'/'.filtro-multi-busca' (dentro de
  // um painel, populados só como texto em innerHTML, nunca como elementos
  // reais neste fake) e '.filtro-multi-trigger'/'.filtro-multi.aberto'
  // (globais) -- sempre vazio de propósito: nenhum teste deste arquivo
  // depende de encontrar outros filtros/itens já abertos ou renderizados.
  function buscarTodos() {
    return [];
  }

  const documentoFalso = {
    getElementById: buscar,
    querySelector: buscar,
    querySelectorAll: buscarTodos,
    addEventListener() {},
  };
  return { documentoFalso, buscar };
}

// vm.createContext realms do NOT inherit host globals like Set/Array
// automatically -- montarFiltroMulti/opcoesFiltro call Set methods
// (.has/.add/.delete/.size) on whatever `estado` the test constructs, so
// those Set instances must come from INSIDE this same realm (sandbox.Set),
// not the host Node process's Set.
function montarSandbox() {
  const { documentoFalso, buscar } = criarSandboxDom();
  const sandbox = { document: documentoFalso, console, Set, Array, String, Math };
  vm.createContext(sandbox);
  vm.runInContext(scriptFiltros(), sandbox, { filename: 'filtros-cliente.js' });
  return { sandbox, buscar };
}

test('montarFiltroMulti monta as opções, marca as já selecionadas, e NÃO chama aoMudar na montagem inicial (só numa mudança real de checkbox)', () => {
  const { sandbox, buscar } = montarSandbox();
  const registros = [{ tipologia: 'SM' }, { tipologia: 'ST' }];
  const cfg = { id: 'filtro-tipologia', chave: 'tipologia', rotuloPadrao: 'Todas', campo: 'tipologia' };
  const estado = { tipologia: new sandbox.Set(['SM']) };
  const chamadas = [];

  sandbox.montarFiltroMulti(cfg, registros, estado, function (cfgMudado) { chamadas.push(cfgMudado.chave); });

  const painel = buscar('#filtro-tipologia .filtro-multi-painel');
  assert.match(painel.innerHTML, /value="SM" checked/);
  assert.match(painel.innerHTML, /value="ST">/);
  assert.equal(chamadas.length, 0, 'aoMudar só deve rodar numa mudança real de checkbox, nunca na montagem/remontagem');
});

test('estado (Set) mutation between two montarFiltroMulti calls is reflected in the panel -- proves montarFiltroMulti reads current estado, not a stale snapshot', () => {
  const { sandbox, buscar } = montarSandbox();
  const registros = [{ tipologia: 'SM' }, { tipologia: 'ST' }];
  const cfg = { id: 'filtro-tipologia', chave: 'tipologia', rotuloPadrao: 'Todas', campo: 'tipologia' };
  const estado = { tipologia: new sandbox.Set() };

  sandbox.montarFiltroMulti(cfg, registros, estado, function () {});
  assert.doesNotMatch(buscar('#filtro-tipologia .filtro-multi-painel').innerHTML, /checked/);

  estado.tipologia.add('ST');
  sandbox.montarFiltroMulti(cfg, registros, estado, function () {});
  assert.match(buscar('#filtro-tipologia .filtro-multi-painel').innerHTML, /value="ST" checked/);
});

test('opcoesFiltro cascades tipologia options to only those in the selected categoria(s)', () => {
  const { sandbox } = montarSandbox();
  const registros = [{ tipologia: 'SP' }, { tipologia: 'LAB.C' }, { tipologia: 'CPTu' }];
  const cfgTipologia = { chave: 'tipologia', campo: 'tipologia' };
  const estadoSemCategoria = { categoria: new sandbox.Set(), tipologia: new sandbox.Set() };
  const todas = sandbox.opcoesFiltro(cfgTipologia, registros, estadoSemCategoria).map((o) => o.valor);
  assert.deepEqual(todas.sort(), ['CPTu', 'LAB.C', 'SP']);

  const estadoComCategoria = { categoria: new sandbox.Set(['labConvencional']), tipologia: new sandbox.Set() };
  const soLab = sandbox.opcoesFiltro(cfgTipologia, registros, estadoComCategoria).map((o) => o.valor);
  assert.deepEqual(soLab, ['LAB.C']);
});

test('indicesFiltrados and categoriaTipologia are present and behave exactly as before the extraction', () => {
  const { sandbox } = montarSandbox();
  const registros = [
    { tipologia: 'SM', grupo: 'PÁTRIA', sup: 'SUP-A', origem: 'X' },
    { tipologia: 'ST', grupo: 'SYSTRA', sup: 'SUP-B', origem: 'Y' },
  ];
  const vazio = new sandbox.Set();
  assert.deepEqual(sandbox.indicesFiltrados(registros, vazio, vazio, vazio, vazio, vazio), [0, 1]);
  assert.deepEqual(sandbox.indicesFiltrados(registros, new sandbox.Set(['SM']), vazio, vazio, vazio, vazio), [0]);
  assert.equal(sandbox.categoriaTipologia('LAB.E'), 'labEspecial');
});
