'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { cssBase, markupCabecalho, markupFiltros, markupAbas, scriptDesbloqueio, scriptFiltros } = require('../tools/comum/render-shell.js');

test('cssBase traz os tokens e os componentes compartilhados', () => {
  const css = cssBase();
  assert.match(css, /--text-primary/);
  assert.match(css, /\.abas-visualizacao button/);
  assert.match(css, /\.filtro-multi-item/);
});

test('markupAbas marca só a aba ativa', () => {
  const html = markupAbas([
    { id: 'aba-a', rotulo: 'A', svg: '<svg></svg>', ativa: true },
    { id: 'aba-b', rotulo: 'B', svg: '<svg></svg>', ativa: false },
  ]);
  assert.match(html, /id="aba-a"[^>]*class="aba-ativa"/);
  assert.doesNotMatch(html, /id="aba-b"[^>]*aba-ativa/);
});

test('scriptDesbloqueio não vaza senha nem dado identificador', () => {
  const js = scriptDesbloqueio();
  assert.match(js, /decifrarComSenha/);
  assert.doesNotMatch(js, /SUP-/);
});

// A partir daqui: o que o orçamento (página já publicada) depende que a casca
// emita. Cada asserção fixa um detalhe textual que, se mudar, quebraria o
// golden byte-a-byte de test/orcamento-html-inalterado.test.js -- aqui o
// diagnóstico vem apontado, lá vem só como offset da primeira divergência.

test('markupCabecalho monta a header-bar com título, subtítulo e logo', () => {
  const html = markupCabecalho({
    titulo: 'T',
    subtitulo: 'S',
    logo: '<img src="x" alt="">',
    recuo: '  ',
  });
  assert.strictEqual(html, [
    '  <div class="header-bar">',
    '    <img src="x" alt="">',
    '    <div class="header-bar-title">',
    '      <h1>T</h1>',
    '      <div class="generated">S</div>',
    '    </div>',
    '  </div>',
  ].join('\n'));
});

test('markupCabecalho sem logo deixa a linha vazia, não some com ela', () => {
  const linhas = markupCabecalho({ titulo: 'T', subtitulo: 'S' }).split('\n');
  assert.strictEqual(linhas.length, 7);
  assert.strictEqual(linhas[1], '  ');
});

test('markupAbas respeita a ordem e o recuo pedidos', () => {
  const html = markupAbas([
    { id: 'um', rotulo: 'Um', svg: '<svg/>', ativa: true },
    { id: 'dois', rotulo: 'Dois', svg: '<svg/>' },
  ], '    ');
  assert.strictEqual(html, [
    '    <div class="abas-visualizacao">',
    '      <button id="um" type="button" class="aba-ativa"><svg/>Um</button>',
    '      <button id="dois" type="button"><svg/>Dois</button>',
    '    </div>',
  ].join('\n'));
});

test('markupFiltros monta a faixa de seleção a partir da lista de filtros', () => {
  const html = markupFiltros([{ id: 'f-a', rotulo: 'Tudo' }]);
  assert.match(html, /^<div class="filtros">\n/);
  assert.match(html, /<div class="filtros-selecao">/);
  assert.match(html, /<div class="filtro-multi" id="f-a"><button type="button" class="filtro-multi-trigger">Tudo<svg class="filtro-multi-seta"/);
  assert.match(html, /<div class="filtro-multi-painel" hidden><\/div><\/div>/);
  assert.match(html, /<\/div>$/);
});

test('markupFiltros aceita classe extra, ações e bloco final, e respeita o recuo', () => {
  const html = markupFiltros([{ id: 'f-a', rotulo: 'Tudo' }], {
    recuo: '  ',
    classes: 'filtros-alertas',
    acoes: '<ACOES>',
    extra: '<EXTRA>',
  });
  assert.strictEqual(html, [
    '  <div class="filtros filtros-alertas">',
    '    <div class="filtros-selecao">',
    '      <div class="filtro-multi" id="f-a"><button type="button" class="filtro-multi-trigger">Tudo'
      + '<svg class="filtro-multi-seta" width="10" height="6" viewBox="0 0 10 6">'
      + '<path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" '
      + 'stroke-linecap="round" stroke-linejoin="round"/></svg></button>'
      + '<div class="filtro-multi-painel" hidden></div></div>',
    '    </div>',
    '<ACOES>',
    '<EXTRA>',
    '  </div>',
  ].join('\n'));
});

test('markupFiltros sem ações nem extra não deixa linha em branco no meio', () => {
  const html = markupFiltros([{ id: 'f-a', rotulo: 'Tudo' }], { recuo: '  ' });
  assert.strictEqual(html.split('\n').length, 5);
});

test('cssBase começa e termina sem as tags <style>, pra o chamador montá-las', () => {
  const css = cssBase();
  assert.doesNotMatch(css, /<\/?style>/);
  assert.match(css, /^ {2}:root \{/);
  assert.match(css, /\}$/);
});

test('scriptDesbloqueio traz o gate inteiro e liga os handlers do formulário', () => {
  const js = scriptDesbloqueio();
  for (const nome of ['base64ParaBytes', 'decifrarComSenha', 'mostrarErroSenha', 'tentarDesbloquear']) {
    assert.match(js, new RegExp('function ' + nome + '\\('));
  }
  assert.match(js, /getElementById\('btn-desbloquear'\)\.addEventListener\('click', tentarDesbloquear\)/);
  assert.match(js, /getElementById\('campo-senha'\)\.focus\(\)/);
});

test('a casca não carrega nada de origem externa nem senha embutida', () => {
  const tudo = cssBase() + scriptDesbloqueio() + markupFiltros([]) + markupAbas([]);
  assert.doesNotMatch(tudo, /https?:\/\/(?!www\.w3\.org)/);
  assert.doesNotMatch(tudo, /senha\s*=\s*['"][^'"]/);
});

test('scriptFiltros traz todas as primitivas de filtro esperadas, como declarações globais', () => {
  const js = scriptFiltros();
  for (const nome of [
    'escapeHtml', 'categoriaTipologia', 'linhasDistintas', 'capitalizarPalavras',
    'opcoesFiltro', 'atualizarRotuloFiltro', 'normalizarBusca', 'aplicarSelecaoExclusiva',
    'filtroExclui', 'indicesFiltrados', 'montarFiltroMulti', 'configurarAberturaFiltrosMulti',
  ]) {
    assert.match(js, new RegExp('function ' + nome + '\\('));
  }
});

test('scriptFiltros não vaza senha nem dado identificador', () => {
  const js = scriptFiltros();
  assert.doesNotMatch(js, /senha\s*=\s*['"][^'"]/);
  assert.doesNotMatch(js, /SUP-/);
});

test('montarFiltroMulti recebe estado e aoMudar como parâmetros explícitos -- sem fallback pra nenhum global fixo (é o que permite reusar entre páginas com estados diferentes)', () => {
  const js = scriptFiltros();
  assert.match(js, /function montarFiltroMulti\(cfg, registros, estado, aoMudar\)/);
  assert.doesNotMatch(js, /estado \|\| filtrosSelecionados/);
});
