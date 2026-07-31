'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildBrowserBundle } = require('../tools/comum/browser-bundle.js');

test('concatena na ordem e resolve require entre módulos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
  fs.writeFileSync(path.join(dir, 'a.js'), "'use strict';\nfunction dobro(n){return n*2;}\nmodule.exports = { dobro };\n");
  fs.writeFileSync(path.join(dir, 'b.js'), "'use strict';\nconst { dobro } = require('./a.js');\nfunction quadruplo(n){return dobro(dobro(n));}\nmodule.exports = { quadruplo };\n");

  const bundle = buildBrowserBundle(dir, ['a.js', 'b.js']);
  assert.doesNotMatch(bundle, /require\(/, 'nenhum require pode sobrar');
  assert.doesNotMatch(bundle, /module\.exports/, 'nenhum module.exports pode sobrar');

  const quadruplo = new Function(bundle + '; return MODULOS["b.js"].quadruplo;')();
  assert.strictEqual(quadruplo(3), 12);
});

test('arquivosEmOrdem é parâmetro -- duas chamadas com listas diferentes não vazam módulo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
  fs.writeFileSync(path.join(dir, 'a.js'), "'use strict';\nfunction dobro(n){return n*2;}\nmodule.exports = { dobro };\n");
  fs.writeFileSync(path.join(dir, 'c.js'), "'use strict';\nfunction triplo(n){return n*3;}\nmodule.exports = { triplo };\n");

  const bundleSoA = buildBrowserBundle(dir, ['a.js']);
  assert.doesNotMatch(bundleSoA, /triplo/, 'c.js não foi pedido, não pode aparecer');

  const bundleSoC = buildBrowserBundle(dir, ['c.js']);
  assert.doesNotMatch(bundleSoC, /dobro/, 'a.js não foi pedido, não pode aparecer');
});

// fs.readFileSync não normaliza quebra de linha, e este repositório roda
// com core.autocrlf=true -- sem normalizar, um bundle construído a partir
// de um checkout Windows (arquivo em CRLF no disco) sairia diferente de um
// construído a partir de um checkout Linux (LF), e o HTML publicado
// passaria a depender de como o repositório foi clonado. Mesmo raciocínio
// de test/comum-calculo-equipes.test.js: materializa a condição gravando
// uma cópia do arquivo-fonte em CRLF antes de bundlar.
test('bundle não carrega CR mesmo com o arquivo-fonte em CRLF no disco (clone Windows)', () => {
  const conteudoLF = "'use strict';\nfunction dobro(n) {\n  return n * 2;\n}\nmodule.exports = { dobro };\n";

  const dirCRLF = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-crlf-'));
  const arquivoCRLF = path.join(dirCRLF, 'a.js');
  fs.writeFileSync(arquivoCRLF, conteudoLF.replace(/\n/g, '\r\n'));
  // Sem isto o teste viraria vácuo caso o fixture deixasse de estar em CRLF.
  assert.match(fs.readFileSync(arquivoCRLF, 'utf8'), /\r\n/, 'o fixture precisava estar em CRLF');

  const bundleDeCRLF = buildBrowserBundle(dirCRLF, ['a.js']);
  assert.doesNotMatch(bundleDeCRLF, /\r/, 'nenhum CR pode sobrar no bundle');

  const dirLF = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-lf-'));
  fs.writeFileSync(path.join(dirLF, 'a.js'), conteudoLF);
  const bundleDeLF = buildBrowserBundle(dirLF, ['a.js']);

  // E o texto tem que ser o MESMO do bundle construído a partir da fonte em
  // LF, não só livre de CR -- prova que é normalização, não truncamento.
  assert.strictEqual(bundleDeCRLF, bundleDeLF);
});

test('dir omitido usa __dirname do módulo (tools/comum)', () => {
  // buildBrowserBundle(undefined, []) não deve lançar por falta de dir --
  // com lista vazia, nenhum arquivo é lido, só exercita o fallback.
  const bundle = buildBrowserBundle(undefined, []);
  assert.match(bundle, /var MODULOS = \{\};/);
});

// Task 9 (compute-balanco.js) foi o primeiro módulo de tools/semanal/ a
// precisar de uma dependência FORA do próprio diretório do bundle
// (tools/comum/calculo-equipes.js) -- até aqui só existiam requires
// './arquivo.js' entre módulos do mesmo diretório. A regex antiga não
// reconhecia '../algo/arquivo.js' e deixava a linha como está, o que vira
// `ReferenceError: require is not defined` no navegador assim que a IIFE do
// MODULOS correspondente roda -- e o teste em Node passava do mesmo jeito,
// porque no Node o require funciona de verdade (é exatamente o tipo de
// falha que só aparece em produção).
test('require de módulo FORA do diretório do bundle é removido, não vira MODULOS[...]', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
  fs.writeFileSync(path.join(dir, 'usaDependenciaExterna.js'),
    "'use strict';\nconst { somaGlobal } = require('../outroDiretorio/dependencia-externa.js');\nfunction total(a, b) { return somaGlobal(a, b); }\nmodule.exports = { total };\n");

  const bundle = buildBrowserBundle(dir, ['usaDependenciaExterna.js']);
  assert.doesNotMatch(bundle, /require\(/, 'nenhum require pode sobrar, nem o de fora do diretório');
  assert.doesNotMatch(bundle, /outroDiretorio/, 'a linha de require inteira precisa sumir, não só a palavra require');

  // somaGlobal só existe porque este teste a declara ANTES do bundle -- é
  // exatamente o papel que fonteParaCliente() cumpre de verdade na página
  // (injetada num <script> anterior ao bundle).
  const total = new Function(`
    function somaGlobal(a, b) { return a + b; }
    ${bundle}
    return MODULOS['usaDependenciaExterna.js'].total;
  `)();
  assert.strictEqual(total(2, 3), 5);
});

test('sem a global pré-existente, o require removido vira ReferenceError -- prova que a dependência é real, não um passe automático', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
  fs.writeFileSync(path.join(dir, 'usaDependenciaExterna.js'),
    "'use strict';\nconst { somaGlobal } = require('../outroDiretorio/dependencia-externa.js');\nfunction total(a, b) { return somaGlobal(a, b); }\nmodule.exports = { total };\n");

  const bundle = buildBrowserBundle(dir, ['usaDependenciaExterna.js']);
  const total = new Function(`${bundle}\nreturn MODULOS['usaDependenciaExterna.js'].total;`)();
  assert.throws(() => total(2, 3), /somaGlobal is not defined/);
});

// Prova de ponta a ponta com os módulos REAIS da Task 9: monta o bundle de
// tools/semanal/compute-balanco.js (que faz
// require('../comum/calculo-equipes.js')), injeta fonteParaCliente() antes
// dele -- exatamente como a Task 10 vai precisar fazer em render-semanal.js
// -- avalia tudo com `new Function` (o mesmo motor de execução de um
// <script> de navegador, sem 'require' disponível) e confirma que
// mediaEquipesPonderada resolve e devolve o valor certo: a média PONDERADA
// por dias de um acumulado de 2 meses (jan=15 dias, fev=30 dias), não a
// soma nem a média simples.
test('compute-balanco.js bundlado + fonteParaCliente() resolve mediaEquipesPonderada de verdade no navegador', () => {
  const { fonteParaCliente, mediaEquipesPonderada, DIAS_PREMISSA_MES } = require('../tools/comum/calculo-equipes.js');
  const { buildBrowserBundle: buildReal } = require('../tools/comum/browser-bundle.js');
  const dirSemanal = path.join(__dirname, '..', 'tools', 'semanal');

  // compute-semanal.js precisa entrar no bundle ANTES: compute-balanco.js
  // agora também consome diaEpoch de lá (achado de 2026-08-01, Realizado do
  // Avanço Sond em Mês Vigente) -- mesma ordem de dependência que
  // BUNDLE_ARQUIVOS usa em render-semanal.js.
  const bundle = buildReal(dirSemanal, ['compute-semanal.js', 'compute-balanco.js']);
  assert.doesNotMatch(bundle, /require\(/, 'compute-balanco.js bundlado não pode deixar nenhum require sobrando');

  const scriptDeNavegador = `
    ${fonteParaCliente()}
    ${bundle}
    return MODULOS['compute-balanco.js'];
  `;
  const ComputeBalancoNoNavegador = new Function(scriptDeNavegador)();

  const previsto = { volume: new Array(12).fill(0), equipes: new Array(12).fill(0), financeiro: new Array(12).fill(0) };
  const realizado = { volume: new Array(12).fill(0), equipes: new Array(12).fill(0), financeiro: new Array(12).fill(0) };
  previsto.equipes[0] = 2; previsto.equipes[1] = 4;
  realizado.volume[0] = 10; realizado.volume[1] = 10;

  const entrada = {
    registros: [{ sup: 'SUP-0003-24', tipologia: 'ST', previsto, realizado, total: previsto }],
    indices: [0], tipologia: 'ST', base: 'previsto', dimensao: 'volume', periodo: 'acumuladoAteMes',
    vigenteIdx: 1, baseline: [],
  };

  const linhasNavegador = ComputeBalancoNoNavegador.calcularLinhas(entrada);
  const esperado = mediaEquipesPonderada(previsto.equipes, 0, 2);

  assert.strictEqual(linhasNavegador[0].equipesBase, esperado);
  assert.strictEqual(linhasNavegador[0].equipesBase, (2 * DIAS_PREMISSA_MES[0] + 4 * DIAS_PREMISSA_MES[1]) / (DIAS_PREMISSA_MES[0] + DIAS_PREMISSA_MES[1]));
  assert.ok(linhasNavegador[0].equipesBase < 6, 'não pode ser a soma (2+4=6) -- prova que é média, não soma');
});

test('protege </script literal dentro de um módulo bundlado', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
  fs.writeFileSync(path.join(dir, 'a.js'), "'use strict';\nfunction html(){return '<div></script>';}\nmodule.exports = { html };\n");

  const bundle = buildBrowserBundle(dir, ['a.js']);
  assert.doesNotMatch(bundle, /<\/script/i, 'a tag real de fechamento não pode sobrar sem escape');
  assert.match(bundle, /<\\\/script/i);
});
