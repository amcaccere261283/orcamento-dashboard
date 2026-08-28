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

  // --- Identidade de nó da região do MAPA (Task 11, correção pós-revisão) ---
  //
  // Este DOM falso é FLAT/global: getElementById(id) memoiza e devolve
  // SEMPRE o MESMO objeto pro mesmo id, não importa quantas vezes o
  // innerHTML de um ancestral tenha sido reescrito -- diferente do DOM real,
  // onde reatribuir o innerHTML de um elemento DESTRÓI e recria todos os
  // descendentes, mesmo que o HTML novo tenha um id igual ao antigo. Isso é
  // inócuo pro resto da suíte (nada até aqui testava identidade de nó através
  // de um redesenho), mas é EXATAMENTE a propriedade que o bug Critical da
  // Task 11 quebra: montarMapaAlocacao reescrevia secao.innerHTML inteiro a
  // cada redesenho, mesmo com o mapa MapLibre já ligado ao
  // #mapa-alocacao-canvas existente -- trocando esse container por um NOVO
  // e vazio, com o mapa continuando "vivo" mas nunca mais visível. Sem
  // modelar a recriação de nó aqui, um teste que prova "o container do mapa
  // sobrevive a um redesenho" passaria mesmo com o bug presente (o singleton
  // sempre devolveria o mesmo objeto, não importa o que o código de produção
  // fizesse) -- pior que não existir, mesma lição do comentário de
  // celulasAlocacao/cartoesAlocacao logo abaixo.
  //
  // Escopo DELIBERADAMENTE estreito: só os 4 ids da região do mapa, não
  // TODO id do documento -- generalizar arriscaria quebrar testes existentes
  // que hoje dependem do singleton persistente (ex.: #busca-equipe, mantido
  // de propósito pelo comentário em inicializarInteracaoAlocacao sobre
  // "refazer o campo a cada tecla").
  const IDS_MAPA_RECRIADOS_POR_INNERHTML = [
    'mapa-alocacao-canvas', 'mapa-alocacao-sem-localizacao',
    'mapa-alocacao-topo', 'mapa-alocacao-pool',
  ];

  // Chamado toda vez que ALGUM elemento tem seu innerHTML reatribuído.
  // 'html' é o novo conteúdo; 'idProprio' é o id do elemento que está sendo
  // escrito (pra nunca invalidar o próprio elemento por causa do seu
  // conteúdo -- não é o caso de uso real de qualquer forma, ver o
  // comentário acima). Para cada id "do mapa" que APARECE no HTML novo,
  // invalida (deleta) o registro existente em `elementos` -- a próxima
  // getElementById(id) cria um objeto NOVO, simulando a recriação real do
  // nó. Se o id não aparecer no HTML novo (caso de montarMapaAlocacao
  // reescrevendo só #mapa-alocacao-topo/#mapa-alocacao-pool depois que o
  // mapa existe, Task 11), nada é invalidado -- é exatamente essa
  // preservação que o teste de regressão prova.
  function recriarIdsDoMapaMencionados(html, idProprio) {
    IDS_MAPA_RECRIADOS_POR_INNERHTML.forEach((id) => {
      if (id === idProprio) return;
      if (elementos[id] && new RegExp('id="' + id + '"').test(html || '')) delete elementos[id];
    });
  }

  // --- Elementos de ARRASTO da aba Alocação (2026-08-11) ---------------------
  //
  // destacarCelulasCompativeis/limparDestaquesAlocacao (render-alocacao-pagina.js)
  // varrem por classe/atributo. Sem estes stubs, querySelectorAll devolveria
  // [] e querySelector devolveria null, as duas funções virariam no-op, e um
  // teste sobre elas passaria VAZIO -- pior que não existir, porque daria a
  // impressão de cobertura. É exatamente o destaque preso na tela que a
  // Decisão 3 do spec quer travar.
  //
  // Os testes registram as células que querem com registrarCelulasAlocacao().
  // Declarados ANTES de elemento() (abaixo) porque elemento()'s querySelector/
  // querySelectorAll também resolvem estes seletores -- ver o comentário lá
  // (achado Important 3 da revisão do Task 9, 2026-08-26).
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

  function obterPoolAlocacao() {
    if (!poolAlocacao) poolAlocacao = comClassList({});
    return poolAlocacao;
  }

  // Seletores de ARRASTO/companheiras que tanto o documento quanto QUALQUER
  // elemento resolvido por getElementById precisam entender -- ver o
  // comentário grande acima de celulasAlocacao. Compartilhado pelos dois
  // pontos de entrada (querySelector/querySelectorAll do documento E de
  // elemento()) porque este DOM falso é FLAT (uma seção lógica só, sem
  // hierarquia real): "buscar dentro da seção X" e "buscar no documento
  // inteiro" resolvem pro MESMO registro global aqui, de propósito -- nenhum
  // teste deste helper simula duas seções (Kanban/Mapa) com conteúdo
  // concorrente ao mesmo tempo.
  function querySelectorAlocacao(sel) {
    if (sel === '.pool-alocacao') return obterPoolAlocacao();
    // '#algum-id' PURO (sem combinador) -- suporta
    // secao.querySelector('#busca-equipe') (achado Important 3 da revisão do
    // Task 9): resolve pro MESMO objeto memoizado que getElementById(id)
    // devolveria. Só o id sozinho -- '#algum-id .filtro-multi-trigger' (com
    // espaço) continua caindo no regex mais abaixo, que já tratava esse caso.
    const idPuro = /^#([\w-]+)$/.exec(sel);
    if (idPuro) return elemento(idPuro[1]);
    return null;
  }

  function querySelectorAllAlocacao(sel) {
    if (sel === '.celula-alocacao') return celulasAlocacao;
    if (sel === '.cartao-companheiro') return cartoesAlocacao.filter((c) => c.classes.has('cartao-companheiro'));
    // Achado Minor 4 (revisão final de 2026-08-12): destacarCelulasCompativeis
    // parou de montar '[data-equipe="X"]' com id cru interpolado (risco de
    // DOMException) e passou a buscar '[data-equipe]' (seletor de presença,
    // sem valor) e filtrar em JS -- mantém o regex velho por compatibilidade
    // com qualquer outro chamador que ainda monte o seletor com valor.
    if (sel === '[data-equipe]') return cartoesAlocacao;
    const porEquipe = /^\[data-equipe="([^"]+)"\]$/.exec(sel);
    if (porEquipe) return cartoesAlocacao.filter((c) => c.equipeId === porEquipe[1]);
    return null; // null, não [] -- sinaliza "não é um seletor de alocação", ver os chamadores
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
        // Empilha por tipo (mesma semântica do addEventListener real -- dois
        // registros pro MESMO tipo no MESMO elemento coexistem, os dois
        // disparam) em vez de sobrescrever: #secao-mapa-alocacao recebe
        // 'click' de inicializarInteracaoAlocacao E de inicializarSeletorRodovias
        // (2026-08-28) -- sobrescrever perderia o primeiro (o que trata o
        // miniseletor "Alocar em qual SUP?"). `listeners[tipo]` continua
        // CHAMÁVEL como uma função só, então nenhum teste existente que já
        // fazia `el.listeners.click(evento)` precisa mudar -- só passa a
        // disparar todos os handlers registrados, não só o último.
        _listenersPorTipo: {},
        addEventListener(tipo, fn) {
          if (!this._listenersPorTipo[tipo]) this._listenersPorTipo[tipo] = [];
          this._listenersPorTipo[tipo].push(fn);
          const todos = this._listenersPorTipo[tipo];
          this.listeners[tipo] = (evento) => { todos.forEach((h) => h(evento)); };
        },
        focus() {},
        value: '',
        textContent: '',
        disabled: false,
        closest() { return el; },
        appendChild() {}, // atualizarRotuloFiltro chama trigger.appendChild(seta) pra recolocar a seta depois de reescrever o textContent
        // Só os 5 seletores que montarFiltroMulti/configurarAberturaFiltrosMulti
        // chamam sobre um elemento já resolvido (o gatilho, o painel, e o
        // que existe dentro do painel), MAIS os seletores de arrasto/busca da
        // aba Alocação (achado Important 3 da revisão do Task 9, 2026-08-26):
        // destacarCelulasCompativeis/limparDestaquesAlocacao/o handler de
        // 'input' de #busca-equipe passaram a escopar suas consultas pela
        // SEÇÃO que disparou o gesto (secao.querySelector(...)), em vez do
        // document inteiro -- sem isto aqui, esse escopo devolveria sempre
        // null/[] neste DOM falso, e os testes que exercitam o caminho REAL
        // do listener (não a chamada direta às funções) passariam vazios.
        querySelector(sel) {
          if (sel === '.filtro-multi-trigger') return elemento(id + '-trigger');
          if (sel === '.filtro-multi-painel') return elemento(id + '-painel');
          if (sel === '.filtro-multi-seta') return {};
          if (sel === '.filtro-multi-busca') return null; // sem busca digitada nestes testes
          if (sel === '.filtro-multi-vazio-busca') return { hidden: false };
          return querySelectorAlocacao(sel);
        },
        querySelectorAll(sel) {
          if (sel === 'input[type="checkbox"]') return checkboxesDoPainel(el);
          const viaAlocacao = querySelectorAllAlocacao(sel);
          return viaAlocacao === null ? [] : viaAlocacao;
        },
      };
      // innerHTML vira um par get/set (era um campo simples) só para poder
      // reagir à ESCRITA -- ver recriarIdsDoMapaMencionados acima. Leitura
      // continua idêntica a antes (devolve o último HTML atribuído); nenhum
      // outro comportamento deste helper muda.
      let _innerHTML = '';
      Object.defineProperty(el, 'innerHTML', {
        get() { return _innerHTML; },
        set(html) { _innerHTML = html; recriarIdsDoMapaMencionados(html, id); },
        enumerable: true,
        configurable: true,
      });
      elementos[id] = el;
    }
    return elementos[id];
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
    poolAlocacao: obterPoolAlocacao,
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
    // O FANTASMA do arrasto (Task 14): criarFantasmaArrasto faz
    // document.createElement('div') + document.body.appendChild(...), e
    // removerFantasmaArrasto desfaz por fantasma.parentNode.removeChild(...).
    // Sem estes três, o pointerdown REAL lança TypeError antes de chegar no
    // que o teste quer provar. Mínimo necessário: só os campos que aquelas
    // três funções tocam (className/textContent/style/parentNode).
    createElement() {
      const filho = { className: '', textContent: '', style: {}, parentNode: null };
      return filho;
    },
    body: {
      filhos: [],
      appendChild(filho) {
        filho.parentNode = this;
        this.filhos.push(filho);
        return filho;
      },
      removeChild(filho) {
        const i = this.filhos.indexOf(filho);
        if (i !== -1) this.filhos.splice(i, 1);
        filho.parentNode = null;
        return filho;
      },
    },
    // document.querySelector só é chamado como '#algum-id .filtro-multi-trigger'
    // ou '#algum-id .filtro-multi-painel' (ver atualizarRotuloFiltro/montarFiltroMulti
    // em scriptFiltros()), OU um dos seletores de alocação (.pool-alocacao,
    // '#algum-id') -- resolve pro mesmo elemento(id) e delega.
    querySelector(sel) {
      const viaAlocacao = querySelectorAlocacao(sel);
      if (viaAlocacao !== null) return viaAlocacao;
      const m = /^#([\w-]+) (\.filtro-multi-(?:trigger|painel))$/.exec(sel);
      return m ? elemento(m[1]).querySelector(m[2]) : null;
    },
    // Um único seletor GLOBAL é resolvido de verdade: as linhas já
    // renderizadas da tabela de Alertas, que aplicarBuscaAlertasSemanal
    // percorre para esconder/mostrar. Sintetizadas do innerHTML de
    // #corpo-alertas pelo mesmo mecanismo (e com o mesmo cache por innerHTML)
    // que checkboxesDoPainel usa -- sem isso a busca "passaria" num array
    // vazio e o teste não provaria nada. Mais os seletores de alocação
    // (.celula-alocacao, [data-equipe], .cartao-companheiro).
    //
    // Os demais (.filtro-multi-trigger, .filtro-multi.aberto) continuam
    // vazios de propósito: nenhum teste depende de achar outro filtro aberto.
    querySelectorAll(sel) {
      const viaAlocacao = querySelectorAllAlocacao(sel);
      if (viaAlocacao !== null) return viaAlocacao;
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
