'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { gridParaCsv } = require('./csv-writer-avancos.js');
const { locateColunasLab } = require('./parse-lab.js');
const cdp = require('./cdp-client.js');

const SITE_ORIGIN = 'https://sond.com.br';
const OUT_PATH = path.join(__dirname, '..', '..', 'dist', 'lab-online.csv');

function mesAnoDeHoje() {
  const hoje = new Date();
  return { mes: String(hoje.getMonth() + 1).padStart(2, '0'), ano: String(hoje.getFullYear()) };
}

async function main() {
  console.log('Checando conexao com o Chrome (CDP)...');
  await cdp.checarConexao();

  const { mes, ano } = mesAnoDeHoje();
  const url = `${SITE_ORIGIN}/extrato-ensaios-realizados/mes/${mes}/ano/${ano}/`;
  console.log(`Buscando ${url}...`);

  const { session, target } = await cdp.abrirSessao(url);
  try {
    const tabela = await cdp.rasparTabelaDataTable(session, '.producao-grid');
    console.log(`${tabela.rows.length} linha(s) de ensaio lidas.`);

    if (!tabela.rows.length) {
      throw new Error('Nenhuma linha encontrada -- abortando sem gravar (sessao expirada, ou mes sem ensaio ainda?).');
    }

    // Valida que o cabeçalho ainda tem as colunas obrigatórias ANTES de
    // gravar -- mesmo raciocínio de atualizar-avancos-online.js: protege o
    // CSV bom já publicado de ser sobrescrito por um que não dá pra ler.
    locateColunasLab([undefined, tabela.headers]);

    const grid = [tabela.headers, ...tabela.rows];
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, gridParaCsv(grid), 'utf8');
    console.log(`Pronto: ${tabela.rows.length} ensaio(s) gravado(s) em ${OUT_PATH}.`);
  } finally {
    await cdp.fecharSessao(session, target);
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { main, mesAnoDeHoje };
