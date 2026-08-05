'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseCsvGrid } = require('../tools/semanal/parse-matriz-cliente.js');
const { parseAvancos, locateColunasAvancos } = require('../tools/semanal/parse-avancos.js');

// Fumaça contra o CSV combinado DE VERDADE (dist/avancos-online.csv ou
// docs/avancos-online.csv, gerado por tools/semanal/atualizar-avancos-online.js
// a partir dos exports por contrato -- ver task-3-report.md em
// .superpowers/sdd/2026-08-05-avancos-online/). As outras suítes desta feature
// rodam sobre fixtures sintéticas, que provam a LÓGICA de combinarGradesAvancos
// mas não pegariam um arquivo publicado truncado/corrompido -- é exatamente
// esse tipo de falha (build parcial publicado por engano) que este teste
// existe pra pegar antes que chegue no dashboard ao vivo.
//
// Roda a MESMA cadeia que build-dashboard.js usa de verdade: lê o CSV,
// parseCsvGrid (mesmo parser que o botão "Atualizar dados" usa no navegador),
// unshift(null) pra reproduzir a diferença de indexação (cabeçalho do CSV
// combinado está em grid[0], mas parseAvancos espera grid[1] -- mesmo truque
// documentado em build-dashboard.js e render-semanal.js), locateColunasAvancos
// no cabeçalho, parseAvancos na grade inteira.
//
// Pula (não falha) se nenhum dos dois arquivos existir neste worktree --
// mesma convenção dos outros *-planilha-real.test.js (um colaborador que
// nunca rodou o fetch script não pode ficar com a suíte vermelha).
const RAIZ = path.join(__dirname, '..');
const CANDIDATOS = [
  path.join(RAIZ, 'dist', 'avancos-online.csv'),
  path.join(RAIZ, 'docs', 'avancos-online.csv'),
];
const CAMINHO_CSV = CANDIDATOS.find((p) => fs.existsSync(p));

test('o CSV combinado de Avanços publicado (dist/ ou docs/) é lido e parseado sem erro, com furos reais', { skip: CAMINHO_CSV ? false : 'nem dist/avancos-online.csv nem docs/avancos-online.csv existem neste worktree -- rode tools/semanal/atualizar-avancos-online.js primeiro' }, () => {
  const texto = fs.readFileSync(CAMINHO_CSV, 'utf8');
  const grid = parseCsvGrid(texto);
  grid.unshift(null);

  assert.doesNotThrow(() => locateColunasAvancos(grid[1]), 'cabeçalho do CSV publicado deveria ter todas as colunas obrigatórias');

  let resultado;
  assert.doesNotThrow(() => { resultado = parseAvancos(grid); }, 'parseAvancos não deveria lançar sobre o CSV publicado');

  assert.ok(resultado.furos.length > 0, 'CSV publicado deveria render pelo menos um furo lido');

  const comDataLegivel = resultado.furos.some((f) => f.terminoSondagem !== null || f.criacaoOS !== null);
  assert.ok(comDataLegivel, 'pelo menos um furo deveria ter Termino Sondagem ou Criação da OS legível -- senão as datas do CSV publicado estão vindo ilegíveis em silêncio');
});
