'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { cssBase, markupCabecalho, markupFiltros, markupAbas, scriptDesbloqueio, scriptFiltros } = require('../tools/comum/render-shell.js');
const { ITERACOES_PBKDF2 } = require('../tools/comum/criptografia.js');

// DOM mínimo o bastante pra SCRIPT_CLIENTE_GATE rodar de ponta a ponta dentro
// de um vm.createContext -- ele termina com duas chamadas síncronas em
// document.getElementById(...).addEventListener/.focus() (ligar o gate), que
// precisam de algo pra não lançar ao carregar o script. Mesmo padrão de
// criarSandboxDom em test/comum-filtros-wireup.test.js, reduzido ao mínimo
// que este arquivo exercita.
function elementoFalso() {
  return { addEventListener() {}, focus() {}, style: {} };
}

// Executa scriptDesbloqueio() de verdade num realm vm, com crypto.subtle e
// TextEncoder reais (Node >= 19 expõe os dois via node:crypto/globalThis) --
// é o que prova que derivarTokenSheet funciona no MESMO runtime que o
// navegador usa, em vez de só conferir por regex que a string existe no
// código-fonte (o que deixaria passar um bug de padding hex sem ninguém
// perceber até o token divergir do calculado por linha de comando).
function montarSandboxGate() {
  const sandbox = {
    document: { getElementById: elementoFalso },
    crypto: crypto.webcrypto,
    TextEncoder,
    Uint8Array,
    Array,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(scriptDesbloqueio(), sandbox, { filename: 'gate-cliente.js' });
  return sandbox;
}

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

// O token de congelamento (Task 5 do plano congelar-semana-botao): derivado
// da senha logo após decifrarComSenha resolver (senha já provada correta),
// pra o Apps Script poder autenticar quem chama sem guardar a senha crua em
// lugar nenhum. O token tem de ser PBKDF2-SHA256 da senha com SAL_TOKEN como
// sal, em hex minúsculo -- reproduzível fora do navegador com node:crypto,
// porque o usuário calcula o mesmo valor por linha de comando pra colar nas
// Script Properties do Apps Script (ver docs/implantar-apps-script-congelamento.md).
// Se a derivação mudar, o botão para de funcionar com "token recusado".
//
// Era 1 rodada de SHA-256 puro até 2026-09-01: um token vazado (ele chegava a
// viajar na query string de um GET) devolvia a senha do dashboard por
// dicionário/máscara em segundos, e com ela o blob público inteiro. O custo
// passou a ser o MESMO do blob (250.000 iterações, ITERACOES_PBKDF2 em
// tools/comum/criptografia.js) -- pago uma vez por desbloqueio, ao lado de um
// PBKDF2 idêntico que a página já paga.
test('derivarTokenSheet(senha), RODADA de verdade num sandbox vm, bate com o PBKDF2 calculado pelo Node', async () => {
  const fonte = scriptDesbloqueio();
  const m = fonte.match(/var SAL_TOKEN = '([^']+)'/);
  assert.ok(m, 'SAL_TOKEN precisa existir como constante literal no script do cliente');
  const sal = m[1];
  const mIter = fonte.match(/var ITERACOES_TOKEN = (\d+)/);
  assert.ok(mIter, 'ITERACOES_TOKEN precisa existir como constante literal no script do cliente');
  const iteracoes = Number(mIter[1]);
  assert.strictEqual(iteracoes, ITERACOES_PBKDF2,
    'o token usa o MESMO custo do blob -- se divergirem, a doc de implantação e o código deixam de bater');

  const sandbox = montarSandboxGate();
  assert.strictEqual(typeof sandbox.derivarTokenSheet, 'function');
  const tokenDoSandbox = await sandbox.derivarTokenSheet('senha-de-teste');

  const esperado = crypto.pbkdf2Sync('senha-de-teste', sal, iteracoes, 32, 'sha256').toString('hex');
  assert.match(esperado, /^[0-9a-f]{64}$/);
  assert.strictEqual(tokenDoSandbox, esperado, 'o token calculado pelo crypto.subtle do navegador tem de bater byte a byte com o pbkdf2Sync do Node -- é o cálculo que o usuário reproduz por linha de comando');
  // Regressão: uma rodada de SHA-256 do sal concatenado à senha era a derivação
  // antiga. Se voltar, o token vira de novo um oráculo barato pra senha.
  assert.notStrictEqual(tokenDoSandbox, crypto.createHash('sha256').update(sal + 'senha-de-teste').digest('hex'));
  assert.match(fonte, /window\.__TOKEN_SHEET__ = await derivarTokenSheet\(senha\)/);
});

test('o token e derivado depois de decifrarComSenha resolver e antes de montarDashboard', () => {
  const fonte = scriptDesbloqueio();
  const idxDecifrar = fonte.indexOf('decifrarComSenha(window.__DADOS_CIFRADOS__, senha)');
  const idxToken = fonte.indexOf('window.__TOKEN_SHEET__');
  const idxMontar = fonte.indexOf('montarDashboard(window.__REGISTROS__)');
  assert.ok(idxDecifrar !== -1 && idxToken !== -1 && idxMontar !== -1);
  assert.ok(idxDecifrar < idxToken && idxToken < idxMontar);
});

test('a senha crua não fica retida em nenhum global -- só o token derivado', () => {
  const fonte = scriptDesbloqueio();
  assert.doesNotMatch(fonte, /window\.__SENHA__/);
  assert.doesNotMatch(fonte, /window\.senha/);
});
