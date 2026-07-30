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
      querySelectorAll(sel) { return buscarTodos(sel, el); },
      closest: () => el,
    };
    return el;
  }

  function buscar(sel) {
    if (!registrados[sel]) registrados[sel] = criarElemento(sel);
    return registrados[sel];
  }

  // Fabrica um checkbox fake (mesma forma que os outros elementos: .value,
  // .checked, .listeners e addEventListener guardando a callback em
  // listeners[tipo]) a partir de um par valor/checked já parseado do
  // innerHTML -- é o que permite ao teste disparar 'change' chamando
  // checkbox.listeners.change() diretamente, sem precisar de um DOM real.
  function criarCheckboxFake(valor, checked) {
    const listenersCheckbox = {};
    return {
      value: valor,
      checked,
      listeners: listenersCheckbox,
      addEventListener(tipo, fn) { listenersCheckbox[tipo] = fn; },
    };
  }

  // Recorta cada <input type="checkbox" value="..."[ checked]> do innerHTML
  // do painel e devolve um checkbox fake por ocorrência. Cacheado por texto
  // de innerHTML: enquanto o painel não for remontado (innerHTML igual), a
  // MESMA lista de objetos volta -- é isso que garante que os listeners
  // anexados por montarFiltroMulti (dentro do sandbox) continuem acessíveis
  // pro teste chamar depois, em vez de cada chamada devolver checkboxes
  // novos e "surdos".
  function checkboxesFakeDoPainel(painel) {
    if (painel._checkboxesCacheHtml === painel.innerHTML && painel._checkboxesCache) {
      return painel._checkboxesCache;
    }
    const regex = /<input type="checkbox" value="([^"]*)"( checked)?>/g;
    const resultado = [];
    let m;
    while ((m = regex.exec(painel.innerHTML))) {
      resultado.push(criarCheckboxFake(m[1], !!m[2]));
    }
    painel._checkboxesCacheHtml = painel.innerHTML;
    painel._checkboxesCache = resultado;
    return resultado;
  }

  // Só é chamada pra '.filtro-multi-item'/'.filtro-multi-busca' (dentro de
  // um painel, populados só como texto em innerHTML, nunca como elementos
  // reais neste fake), 'input[type="checkbox"]' (ver checkboxesFakeDoPainel
  // acima -- esse caso É sintetizado de verdade, ao contrário dos demais) e
  // '.filtro-multi-trigger'/'.filtro-multi.aberto' (globais) -- os demais
  // seguem vazios de propósito: nenhum teste deste arquivo depende de
  // encontrar outros filtros/itens já abertos ou renderizados.
  function buscarTodos(sel, elementoChamador) {
    if (sel === 'input[type="checkbox"]' && elementoChamador) {
      return checkboxesFakeDoPainel(elementoChamador);
    }
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

test('marcar um checkbox antes desmarcado adiciona o valor ao Set do estado e chama aoMudar(cfg) exatamente uma vez', () => {
  const { sandbox, buscar } = montarSandbox();
  const registros = [{ tipologia: 'SM' }, { tipologia: 'ST' }];
  const cfg = { id: 'filtro-tipologia', chave: 'tipologia', rotuloPadrao: 'Todas', campo: 'tipologia' };
  const estado = { tipologia: new sandbox.Set(['SM']) };
  const chamadas = [];

  sandbox.montarFiltroMulti(cfg, registros, estado, function (cfgMudado) { chamadas.push(cfgMudado.chave); });

  const painel = buscar('#filtro-tipologia .filtro-multi-painel');
  const checkboxes = painel.querySelectorAll('input[type="checkbox"]');
  const checkboxSt = checkboxes.filter((cb) => cb.value === 'ST')[0];
  assert.equal(checkboxSt.checked, false, 'ST começa desmarcado -- só SM está no estado inicial');

  // Simula o navegador: ele já alterna .checked ANTES de disparar 'change'.
  checkboxSt.checked = true;
  checkboxSt.listeners.change();

  assert.equal(estado.tipologia.has('ST'), true, 'marcar deve adicionar o valor ao Set');
  assert.deepEqual(chamadas, ['tipologia'], 'aoMudar(cfg) deve rodar exatamente uma vez');
});

test('desmarcar um checkbox remove o valor do Set do estado (sem minimoUm/exclusivo, mesmo restando só 1 marcado)', () => {
  const { sandbox, buscar } = montarSandbox();
  const registros = [{ tipologia: 'SM' }, { tipologia: 'ST' }];
  const cfg = { id: 'filtro-tipologia', chave: 'tipologia', rotuloPadrao: 'Todas', campo: 'tipologia' };
  const estado = { tipologia: new sandbox.Set(['SM']) };
  const chamadas = [];

  sandbox.montarFiltroMulti(cfg, registros, estado, function (cfgMudado) { chamadas.push(cfgMudado.chave); });

  const painel = buscar('#filtro-tipologia .filtro-multi-painel');
  const checkboxSm = painel.querySelectorAll('input[type="checkbox"]').filter((cb) => cb.value === 'SM')[0];
  assert.equal(checkboxSm.checked, true);

  checkboxSm.checked = false;
  checkboxSm.listeners.change();

  assert.equal(estado.tipologia.has('SM'), false, 'desmarcar deve remover o valor do Set');
  assert.deepEqual(chamadas, ['tipologia'], 'aoMudar(cfg) deve rodar mesmo desmarcando o último valor, já que cfg não tem minimoUm/exclusivo');
});

test('cfg.minimoUm: true recusa desmarcar o único valor selecionado -- checkbox.checked é forçado de volta pra true, o Set não muda e aoMudar NÃO roda', () => {
  const { sandbox, buscar } = montarSandbox();
  const cfg = {
    id: 'seletor-dimensao', chave: 'dimensao', rotuloPadrao: 'Selecione ao menos 1', minimoUm: true,
    opcoesFixas: [{ valor: 'financeiro', rotulo: 'Financeiro' }, { valor: 'volume', rotulo: 'Volume' }],
  };
  const estado = { dimensao: new sandbox.Set(['financeiro']) };
  const chamadas = [];

  sandbox.montarFiltroMulti(cfg, [], estado, function (cfgMudado) { chamadas.push(cfgMudado.chave); });

  const painel = buscar('#seletor-dimensao .filtro-multi-painel');
  const checkboxFinanceiro = painel.querySelectorAll('input[type="checkbox"]').filter((cb) => cb.value === 'financeiro')[0];

  checkboxFinanceiro.checked = false;
  checkboxFinanceiro.listeners.change();

  assert.equal(checkboxFinanceiro.checked, true, 'a última desmarcação deve ser recusada: checked volta pra true');
  assert.deepEqual([...estado.dimensao], ['financeiro'], 'o Set não deve mudar');
  assert.deepEqual(chamadas, [], 'aoMudar NÃO deve rodar quando a mudança é recusada');
});

test('cfg.exclusivo: true limpa o Set pro valor recém-marcado (aplicarSelecaoExclusiva) e remonta o painel -- só um checkbox fica marcado por vez', () => {
  const { sandbox, buscar } = montarSandbox();
  const cfg = {
    id: 'filtro-alertas-agrupar-por', chave: 'agruparPor', rotuloPadrao: 'Agrupar por', exclusivo: true,
    opcoesFixas: [{ valor: 'sup', rotulo: 'SUP' }, { valor: 'tipologia', rotulo: 'Tipologia' }],
  };
  const estado = { agruparPor: new sandbox.Set(['sup']) };
  const chamadas = [];

  sandbox.montarFiltroMulti(cfg, [], estado, function (cfgMudado) { chamadas.push(cfgMudado.chave); });

  const painel = buscar('#filtro-alertas-agrupar-por .filtro-multi-painel');
  const checkboxTipologia = painel.querySelectorAll('input[type="checkbox"]').filter((cb) => cb.value === 'tipologia')[0];

  checkboxTipologia.checked = true;
  checkboxTipologia.listeners.change();

  assert.deepEqual([...estado.agruparPor], ['tipologia'], 'exclusivo deve limpar o Set e deixar só o valor recém-marcado');
  assert.deepEqual(chamadas, ['agruparPor'], 'aoMudar deve rodar uma vez, depois do remount');

  // O painel foi remontado (innerHTML mudou) -- pega os checkboxes de novo
  // pra provar que o estado final do DOM reflete só uma marcação por vez.
  const checkboxesFinais = painel.querySelectorAll('input[type="checkbox"]');
  const marcados = checkboxesFinais.filter((cb) => cb.checked).map((cb) => cb.value);
  assert.deepEqual(marcados, ['tipologia'], 'depois do remount, só o checkbox de tipologia deve estar marcado');
});
