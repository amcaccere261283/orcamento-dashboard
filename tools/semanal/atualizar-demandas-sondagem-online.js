'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { juntarPendentesSondagem } = require('./mapear-demandas-sondagem.js');
const { gridParaCsv } = require('./csv-writer-avancos.js');
const { locateColunasAvancos } = require('./parse-avancos.js');
const cdp = require('./cdp-client.js');

const SITE_ORIGIN = 'https://sond.com.br';
const OUT_PATH = path.join(__dirname, '..', '..', 'dist', 'demandas-sondagem-online.csv');

async function main() {
  console.log('Checando conexao com o Chrome (CDP)...');
  await cdp.checarConexao();

  console.log('Buscando pendentes (Link 2 -- maps-sondagens)...');
  const { session: s2, target: t2 } = await cdp.abrirSessao(`${SITE_ORIGIN}/maps-sondagens/tabela/inicial/1/`);
  let linhasLink2;
  try {
    const { headers, rows } = await cdp.rasparTabelaDataTable(s2, 'table', { timeoutMs: 30000 });
    linhasLink2 = cdp.linhasComoObjetos({ headers, rows });
  } finally {
    await cdp.fecharSessao(s2, t2);
  }
  console.log(`  ${linhasLink2.length} furo(s) pendente(s) encontrado(s).`);

  console.log('Buscando avanço por OS (Link 3 -- avanco-sondagens)...');
  const { session: s3, target: t3 } = await cdp.abrirSessao(`${SITE_ORIGIN}/avanco-sondagens/`);
  let linhasLink3;
  try {
    const { headers, rows } = await cdp.rasparTabelaDataTable(s3, '#avanco-grid', { timeoutMs: 30000 });
    linhasLink3 = cdp.linhasComoObjetos({ headers, rows });
  } finally {
    await cdp.fecharSessao(s3, t3);
  }
  console.log(`  ${linhasLink3.length} linha(s) de OS+Tipo encontrada(s).`);

  const { header, rows, semContrato } = juntarPendentesSondagem(linhasLink2, linhasLink3);
  if (semContrato > 0) {
    console.warn(`AVISO: ${semContrato} furo(s) pendente(s) do Link 2 sem OS correspondente no Link 3 -- ficaram DE FORA (sem Contrato pra atribuir).`);
  }

  try {
    locateColunasAvancos(header);
  } catch (err) {
    throw new Error(`Cabeçalho ficou inválido -- abortando SEM gravar ${OUT_PATH}. Erro original: ${err.message}`);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, gridParaCsv([header, ...rows]), 'utf8');
  console.log(`Pronto: ${rows.length} furo(s) pendente(s) gravado(s) em ${OUT_PATH}.`);
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { main };
