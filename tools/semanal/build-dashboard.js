// tools/semanal/build-dashboard.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readXlsxSheet } = require('../comum/xlsx-reader.js');
// Mesma fonte de dados do orçamento (a MATRIZ viva + o estudo de linha de
// base) -- o Planejamento Semanal reparte os MESMOS registros mensais em
// semanas (ver tools/semanal/compute-semanal.js), não é uma planilha
// separada. Por isso reaproveita parse-matriz.js/parse-baseline.js/
// config.js de tools/orcamento/ em vez de duplicá-los aqui.
const { parseMatriz } = require('../orcamento/parse-matriz.js');
const { parseBaseline } = require('../orcamento/parse-baseline.js');
const { renderSemanal } = require('./render-semanal.js');
const config = require('../orcamento/config.js');

// A senha nunca vem de um arquivo do repositório -- só de variável de
// ambiente, lida na hora do build e descartada depois (mesmo raciocínio de
// tools/orcamento/build-dashboard.js: dist/planejamento-semanal.html também
// vai pra um GitHub Pages público).
function build({ outPath, today = new Date(), senha = process.env.ORCAMENTO_SENHA } = {}) {
  if (!senha) {
    throw new Error('Defina a variável de ambiente ORCAMENTO_SENHA antes de rodar o build (a senha nunca fica em um arquivo do repositório).');
  }

  const grid = readXlsxSheet(config.caminhoArquivo, config.nomeAba);
  const registros = parseMatriz(grid);

  const gridLinhaBase = readXlsxSheet(config.caminhoLinhaBase, config.nomeAbaLinhaBase);
  const { porChave } = parseBaseline(gridLinhaBase);
  // parseBaseline devolve um Map (porChave) -- JSON.stringify não sabe
  // serializar Map (viraria "{}", perdendo os dados em silêncio dentro do
  // blob cifrado). renderSemanal só faz JSON.stringify({registros, baseline}),
  // então quem chama precisa entregar algo que sobreviva a isso: um array
  // simples de entradas, no mesmo formato que test/semanal-build-dashboard.test.js
  // já usa (baseline: []).
  const baseline = Array.from(porChave, ([chave, dados]) => ({ chave, ...dados }));

  const html = renderSemanal({ registros, baseline, senha, geradoEm: today });

  const resolvedOutPath = outPath || path.join(__dirname, '..', '..', 'dist', 'planejamento-semanal.html');
  fs.mkdirSync(path.dirname(resolvedOutPath), { recursive: true });
  fs.writeFileSync(resolvedOutPath, html, 'utf8');
  console.log(`Wrote ${html.length} bytes to ${resolvedOutPath}`);
  return resolvedOutPath;
}

if (require.main === module) {
  try {
    build();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

module.exports = { build };
