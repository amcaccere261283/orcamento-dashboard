'use strict';

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

module.exports = { criarDocumentoFalso };
