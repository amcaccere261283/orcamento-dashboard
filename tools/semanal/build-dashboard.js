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
const { parseMatriz, locateColumns } = require('../orcamento/parse-matriz.js');
const { parseBaseline } = require('../orcamento/parse-baseline.js');
const { renderSemanal } = require('./render-semanal.js');
const { excelSerialParaData } = require('../comum/datas.js');
const { reconciliarLinhaBase } = require('../comum/linha-base.js');
const config = require('../orcamento/config.js');

// parseBaseline devolve um Map (porChave) -- JSON.stringify não sabe
// serializar Map (viraria "{}", perdendo os dados em silêncio dentro do
// blob cifrado). renderSemanal só faz JSON.stringify({registros, baseline}),
// então quem chama precisa entregar algo que sobreviva a isso: um array
// simples de entradas, no mesmo formato que test/semanal-build-dashboard.test.js
// já usa (baseline: []). Extraída como função pura (em vez de ficar inline
// em build()) pra dar pra testar sem precisar montar um .xlsx sintético --
// ver test/semanal-build-dashboard.test.js.
//
// As chaves que saem daqui são as da MATRIZ (`sup||tipologia` crus), NÃO as
// do estudo de linha de base: reconciliarLinhaBase (tools/comum/linha-base.js)
// aplica a MESMA tradução que o orçamento aplica em anexarPrevistoInicial
// (LAB.C -> 'LAB.', LAB.E -> 'LAB. ESPECIAL', e os 7 SUPs renomeados/
// renovados). Sem isso, chaveBaseline em compute-balanco.js -- que procura a
// chave CRUA, e é o cliente, não pode carregar os mapas -- não acharia nada
// para essas linhas e a base "Previsto Inicial" viraria semBase:true em ~1/3
// da grade real, indistinguível de contrato novo. Por isso 'registros' é
// obrigatório: é deles que sai o lado esquerdo da chave.
function baselineParaCliente(porChave, registros) {
  const { porChaveMatriz } = reconciliarLinhaBase(registros, porChave);
  return Array.from(porChaveMatriz, ([chave, dados]) => ({ chave, ...dados }));
}

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

  // Os 12 meses da MATRIZ, como datas -- MESMA derivação de
  // tools/orcamento/build-dashboard.js. renderSemanal precisa deles para
  // calcularVigenteIdx (tools/comum/datas.js) saber se 'today' está dentro,
  // antes ou depois do ano da planilha, em vez de assumir ano corrente.
  const columns = locateColumns(grid);
  const headerRow = grid[1];
  const periodos = columns.equipesMeses.map(col => excelSerialParaData(headerRow[col]));

  const gridLinhaBase = readXlsxSheet(config.caminhoLinhaBase, config.nomeAbaLinhaBase);
  const { porChave } = parseBaseline(gridLinhaBase);
  const baseline = baselineParaCliente(porChave, registros);

  const html = renderSemanal({ registros, baseline, periodos, senha, geradoEm: today });

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

module.exports = { build, baselineParaCliente };
