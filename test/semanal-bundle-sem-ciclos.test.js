'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// REGRESSÃO DO CICLO DE REQUIRE (2026-08-31)
// ============================================================================
// tools/semanal/render-aba-consolidado.js passou a consumir serieDaSemana de
// compute-relatorio-semanal.js, que por sua vez importava blocosPorSup/
// tipologiasPresentes DE VOLTA do Consolidado -- um ciclo de require mútuo.
//
// No Node o ciclo passa despercebido (o cache do require devolve o
// module.exports parcialmente preenchido e, por sorte de ordem, tudo funciona).
// No BUNDLE do navegador não: buildBrowserBundle concatena os arquivos como
// TEXTO na ordem de BUNDLE_ARQUIVOS e reescreve cada require() same-dir para
// uma leitura de MODULOS['<arquivo>'], executada na hora em que a IIFE do
// módulo roda -- só UMA direção do ciclo pode estar registrada, e a outra lê
// undefined. Efeito medido antes do fix: 114 testes de wireup quebrando com
// "Cannot destructure property 'serieDaSemana' of
// 'MODULOS.compute-relatorio-semanal.js' as it is undefined".
//
// Estes dois testes são estáticos de propósito: valem para QUALQUER par de
// módulos de tools/semanal/, não só o que quebrou desta vez.

const DIR_SEMANAL = path.join(__dirname, '..', 'tools', 'semanal');
const RE_REQUIRE_SAME_DIR = /require\(['"]\.\/([^'"]+\.js)['"]\)/g;

function dependenciasSameDir(arquivo) {
  const fonte = fs.readFileSync(path.join(DIR_SEMANAL, arquivo), 'utf8');
  const deps = [];
  let m;
  RE_REQUIRE_SAME_DIR.lastIndex = 0;
  while ((m = RE_REQUIRE_SAME_DIR.exec(fonte)) !== null) {
    // Auto-referência só aparece em comentário/exemplo de uso: não é aresta.
    if (m[1] !== arquivo && deps.indexOf(m[1]) === -1) deps.push(m[1]);
  }
  return deps;
}

test('nenhum módulo de tools/semanal/ participa de um ciclo de require same-dir', () => {
  const arquivos = fs.readdirSync(DIR_SEMANAL).filter((n) => n.endsWith('.js'));
  const grafo = {};
  arquivos.forEach((a) => { grafo[a] = dependenciasSameDir(a); });

  // Busca em profundidade com marcação de cinza/preto: um vértice cinza
  // reencontrado é uma aresta de retorno, ou seja, um ciclo.
  const estado = {};
  const ciclos = [];
  function visitar(no, caminho) {
    if (estado[no] === 'preto') return;
    if (estado[no] === 'cinza') { ciclos.push(caminho.slice(caminho.indexOf(no)).concat(no).join(' -> ')); return; }
    estado[no] = 'cinza';
    (grafo[no] || []).forEach((dep) => {
      if (!Object.prototype.hasOwnProperty.call(grafo, dep)) return; // arquivo inexistente: outro teste pega
      visitar(dep, caminho.concat(no));
    });
    estado[no] = 'preto';
  }
  arquivos.forEach((a) => visitar(a, []));

  assert.deepStrictEqual(ciclos, [], 'ciclo(s) de require same-dir em tools/semanal/: ' + ciclos.join(' | '));
});

test('render-aba-consolidado.js e compute-relatorio-semanal.js compartilham blocosPorSup/tipologiasPresentes por consolidado-hierarquia.js', () => {
  const hierarquia = require('../tools/semanal/consolidado-hierarquia.js');
  const consolidado = require('../tools/semanal/render-aba-consolidado.js');
  const relatorio = require('../tools/semanal/compute-relatorio-semanal.js');

  assert.strictEqual(typeof hierarquia.blocosPorSup, 'function');
  assert.strictEqual(typeof hierarquia.tipologiasPresentes, 'function');
  // O Consolidado continua RE-EXPORTANDO as duas: a API pública dele não mudou
  // (test/semanal-render-aba-consolidado.test.js importa daqui).
  assert.strictEqual(consolidado.blocosPorSup, hierarquia.blocosPorSup);
  assert.strictEqual(consolidado.tipologiasPresentes, hierarquia.tipologiasPresentes);
  // E o relatório continua vendo serieDaSemana -- prova de que o require do
  // Consolidado para cá resolve de verdade, não um objeto meio pronto do ciclo.
  assert.strictEqual(typeof relatorio.serieDaSemana, 'function');

  // compute-relatorio-semanal.js não pode voltar a importar do Consolidado.
  const fonteRelatorio = fs.readFileSync(path.join(DIR_SEMANAL, 'compute-relatorio-semanal.js'), 'utf8');
  assert.ok(fonteRelatorio.indexOf("require('./render-aba-consolidado.js')") === -1,
    'compute-relatorio-semanal.js voltou a importar de render-aba-consolidado.js -- o ciclo reabriria');
});

test('nos dois bundles do navegador, todo módulo é registrado em MODULOS antes de ser lido', () => {
  const paginas = paginasComBundle();
  Object.keys(paginas).forEach((nomePagina) => {
    const html = paginas[nomePagina];
    const registros = [];
    const reRegistro = /MODULOS\['([^']+)'\] = \(function\(\) \{/g;
    let m;
    while ((m = reRegistro.exec(html)) !== null) registros.push({ nome: m[1], pos: m.index });
    assert.ok(registros.length > 0, nomePagina + ': nenhum módulo bundlado encontrado');

    const posRegistro = {};
    registros.forEach((r) => { posRegistro[r.nome] = r.pos; });

    // O bundle vive num <script> só dele (render-semanal.js/
    // render-alocacao-pagina.js), e protegeFechamentoScript escapa qualquer
    // '</script' que apareça dentro do código -- então o primeiro '</script>'
    // depois do último registro é o fim do bundle. Só as leituras DENTRO dele
    // dependem da ordem: o script de cliente roda depois de tudo registrado, e
    // lá um módulo ausente pode ser opcional de propósito (a página de Alocação
    // não bundla compute-equipes-realizado-alocado.js, ver o comentário em
    // BUNDLE_ARQUIVOS_ALOCACAO).
    const fimBundle = html.indexOf('</script>', registros[registros.length - 1].pos);
    assert.ok(fimBundle !== -1, nomePagina + ': não achei o fim do <script> do bundle');

    const reLeitura = /MODULOS\['([^']+)'\]/g;
    while ((m = reLeitura.exec(html)) !== null) {
      if (m.index > fimBundle) break;
      const nome = m[1];
      // Comentários dentro dos próprios módulos citam MODULOS['<arquivo>'] /
      // MODULOS['arquivo.js'] como forma genérica -- só conta o que é um
      // arquivo de verdade em tools/semanal/.
      if (!fs.existsSync(path.join(DIR_SEMANAL, nome))) continue;
      // ... e comentários de linha (// ...) dentro dos módulos citam módulos
      // pelo nome real, sem ler nada de verdade.
      const inicioLinha = html.lastIndexOf('\n', m.index) + 1;
      const antes = html.slice(inicioLinha, m.index);
      if (antes.indexOf('//') !== -1) continue;
      if (posRegistro[nome] === m.index) continue; // é o próprio registro
      // Leitura no script de cliente (depois de todo o bundle) passa de graça
      // por esta mesma comparação -- não precisa de tratamento à parte.
      assert.ok(posRegistro[nome] !== undefined,
        nomePagina + ": MODULOS['" + nome + "'] é lido mas o módulo não está no bundle");
      assert.ok(posRegistro[nome] < m.index,
        nomePagina + ": MODULOS['" + nome + "'] é lido ANTES de ser registrado -- ordem de BUNDLE_ARQUIVOS errada ou ciclo de require");
    }
  });
});

// --- fixtures mínimas para renderizar as duas páginas -----------------------

const SENHA_FAKE = 'senha-fake-de-teste-e2e-nao-e-a-real';
const PERIODOS_2026 = Array.from({ length: 12 }, (_, mes) => new Date(Date.UTC(2026, mes, 1)));
const DEMANDAS_VAZIAS = { tipologias: [], totais: {}, porRegistroEventos: {} };

function registroSintetico() {
  const zeros = new Array(12).fill(0);
  const bloco = () => ({
    equipes: new Array(12).fill(2), volume: zeros, financeiro: zeros,
    equipesResumo: { pico: 2, media: 2, prod: 8, dias: 25 },
    volumeResumo: { total: 0, totalInicial: 0, ticket: 1 },
    financeiroResumo: { total: 0, totalInicial: 0 },
  });
  return {
    sup: 'SUP-0001-24', grupo: 'Grupo-Sintetico-Beta', tomador: 'Tomador-Sintetico-Alfa',
    tipologia: 'ST', previsto: bloco(), realizado: bloco(), total: bloco(),
  };
}

function paginasComBundle() {
  const { renderSemanal } = require('../tools/semanal/render-semanal.js');
  const { renderAlocacaoPagina } = require('../tools/semanal/render-alocacao-pagina.js');
  const payload = {
    registros: [registroSintetico()], baseline: [], demandas: DEMANDAS_VAZIAS,
    periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: new Date('2026-07-15T00:00:00Z'),
  };
  return {
    'planejamento-semanal.html': renderSemanal(payload),
    'alocacao-equipes.html': renderAlocacaoPagina(payload),
  };
}
