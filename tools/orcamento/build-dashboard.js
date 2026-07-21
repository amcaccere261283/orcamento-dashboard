// tools/orcamento/build-dashboard.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readXlsxSheet } = require('./xlsx-reader.js');
const { parseMatriz, locateColumns } = require('./parse-matriz.js');
const { renderDashboard } = require('./render-dashboard.js');
const { excelSerialParaData } = require('./datas.js');
const config = require('./config.js');

const LOGO_PATH = path.join(__dirname, '..', '..', 'assets', 'logo-suporte-infra-negativo.png');
const ICON_PATH = path.join(__dirname, '..', '..', 'assets', 'logo-alvo.png');

function loadDataUri(filePath) {
  if (!fs.existsSync(filePath)) return undefined;
  const buf = fs.readFileSync(filePath);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

// A senha nunca vem de um arquivo do repositório (nem daria pra usar uma
// fixa, já que o próprio dist/orcamento-dashboard.html é publicado no
// GitHub Pages) -- só de variável de ambiente, lida na hora do build e
// descartada depois. Quem roda o build precisa saber a senha; ela nunca
// fica escrita em nenhum lugar do código.
function build({ outPath, today = new Date(), senha = process.env.ORCAMENTO_SENHA } = {}) {
  if (!senha) {
    throw new Error('Defina a variável de ambiente ORCAMENTO_SENHA antes de rodar o build (a senha nunca fica em um arquivo do repositório).');
  }

  const grid = readXlsxSheet(config.caminhoArquivo, config.nomeAba);
  const registros = parseMatriz(grid);

  const columns = locateColumns(grid);
  const headerRow = grid[1];
  const periodos = columns.equipesMeses.map(col => excelSerialParaData(headerRow[col]));

  const html = renderDashboard({
    registros, periodos, generatedAt: today, senha,
    logoDataUri: loadDataUri(LOGO_PATH), iconDataUri: loadDataUri(ICON_PATH),
  });

  const resolvedOutPath = outPath || path.join(__dirname, '..', '..', 'dist', 'orcamento-dashboard.html');
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
