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
  const linhasPorTabela = new Map();

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
      // classList de verdade (Set), não um stub -- Task 12 precisa provar
      // que definirStatusAtualizacaoSemanal() (render-semanal.js) realmente
      // acrescenta 'status-erro' via classList.toggle(classe, força), então
      // contains()/toggle() precisam refletir estado, não sempre `false`.
      const classes = new Set();
      const classList = {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
        toggle: (c, forcar) => {
          const presente = forcar === undefined ? !classes.has(c) : !!forcar;
          if (presente) classes.add(c); else classes.delete(c);
          return presente;
        },
      };
      const el = {
        id,
        style: {},
        classList,
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

  // --- Elementos de ARRASTO da aba Alocação (2026-08-11) ---------------------
  //
  // destacarCelulasCompativeis/limparDestaquesAlocacao (render-semanal.js)
  // varrem o DOCUMENTO por classe. Sem estes stubs, querySelectorAll devolveria
  // [] e querySelector devolveria null, as duas funções virariam no-op, e um
  // teste sobre elas passaria VAZIO -- pior que não existir, porque daria a
  // impressão de cobertura. É exatamente o destaque preso na tela que a
  // Decisão 3 do spec quer travar.
  //
  // Os testes registram as células que querem com registrarCelulasAlocacao().
  const celulasAlocacao = [];
  const cartoesAlocacao = [];
  let poolAlocacao = null;

  function comClassList(extra) {
    const classes = new Set();
    return Object.assign({
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
        toggle: (c, forcar) => {
          const presente = forcar === undefined ? !classes.has(c) : !!forcar;
          if (presente) classes.add(c); else classes.delete(c);
          return presente;
        },
      },
      classes,
    }, extra || {});
  }

  return {
    elementos,
    getElementById: elemento,

    // colunas: ['SP', 'ST', ...] -- uma célula por entrada, com data-coluna.
    registrarCelulasAlocacao(colunas) {
      celulasAlocacao.length = 0;
      (colunas || []).forEach((coluna) => {
        celulasAlocacao.push(comClassList({
          getAttribute: (attr) => (attr === 'data-coluna' ? coluna : null),
        }));
      });
      return celulasAlocacao;
    },
    poolAlocacao() {
      if (!poolAlocacao) poolAlocacao = comClassList({});
      return poolAlocacao;
    },
    // Os cartões que os testes de destaque querem observar. Mesmo motivo de
    // registrarCelulasAlocacao: sem isto querySelectorAll devolve [] e o teste
    // de destaque das companheiras passaria VAZIO.
    registrarCartoesAlocacao(ids) {
      cartoesAlocacao.length = 0;
      (ids || []).forEach((id) => {
        cartoesAlocacao.push(comClassList({
          getAttribute: (attr) => (attr === 'data-equipe' ? String(id) : null),
          equipeId: String(id),
        }));
      });
      return cartoesAlocacao;
    },
    cartaoAlocacao(id) {
      return cartoesAlocacao.find((c) => c.equipeId === String(id)) || null;
    },
    // document.querySelector só é chamado como '#algum-id .filtro-multi-trigger'
    // ou '#algum-id .filtro-multi-painel' (ver atualizarRotuloFiltro/montarFiltroMulti
    // em scriptFiltros()) -- resolve pro mesmo elemento(id) e delega.
    querySelector(sel) {
      if (sel === '.pool-alocacao') return this.poolAlocacao();
      const m = /^#([\w-]+) (\.filtro-multi-(?:trigger|painel))$/.exec(sel);
      return m ? elemento(m[1]).querySelector(m[2]) : null;
    },
    // Um único seletor GLOBAL é resolvido de verdade: as linhas já
    // renderizadas da tabela de Alertas, que aplicarBuscaAlertasSemanal
    // percorre para esconder/mostrar. Sintetizadas do innerHTML de
    // #corpo-alertas pelo mesmo mecanismo (e com o mesmo cache por innerHTML)
    // que checkboxesDoPainel usa -- sem isso a busca "passaria" num array
    // vazio e o teste não provaria nada.
    //
    // Os demais (.filtro-multi-trigger, .filtro-multi.aberto) continuam
    // vazios de propósito: nenhum teste depende de achar outro filtro aberto.
    querySelectorAll(sel) {
      if (sel === '.celula-alocacao') return celulasAlocacao;
      if (sel === '.cartao-companheiro') return cartoesAlocacao.filter((c) => c.classes.has('cartao-companheiro'));
      var porEquipe = /^\[data-equipe="([^"]+)"\]$/.exec(sel);
      if (porEquipe) return cartoesAlocacao.filter((c) => c.equipeId === porEquipe[1]);
      if (sel !== '#tabela-alertas tbody tr') return [];
      const corpo = elemento('corpo-alertas');
      const cache = linhasPorTabela.get(corpo);
      if (cache && cache.key === corpo.innerHTML) return cache.lista;
      const lista = [];
      const re = /<tr data-search="([^"]*)">/g;
      let m;
      while ((m = re.exec(corpo.innerHTML))) lista.push({ dataset: { search: m[1] }, style: {} });
      linhasPorTabela.set(corpo, { key: corpo.innerHTML, lista });
      return lista;
    },
    addEventListener() {},
  };
}

module.exports = { criarDocumentoFalso };
