'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { gridParaCsv } = require('./csv-writer-avancos.js');
const cdp = require('./cdp-client.js');

const SITE_ORIGIN = 'https://sond.com.br';
const OUT_PATH = path.join(__dirname, '..', '..', 'dist', 'equipes-produtivas-online.csv');

function primeiroEUltimoDiaDoMes(data) {
  const ano = data.getFullYear();
  const mes = data.getMonth();
  const primeiro = new Date(ano, mes, 1);
  const ultimo = new Date(ano, mes + 1, 0);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { de: fmt(primeiro), ate: fmt(ultimo) };
}

async function main() {
  console.log('Checando conexao com o Chrome (CDP)...');
  await cdp.checarConexao();

  const { de, ate } = primeiroEUltimoDiaDoMes(new Date());
  const url = `${SITE_ORIGIN}/campo/fotos/de/${de}/ate/${ate}/tabela/1/`;
  console.log(`Buscando ${url}...`);

  const { session, target } = await cdp.abrirSessao(url);
  try {
    const tabela = await cdp.rasparTabelaDataTable(session, '#table', { timeoutMs: 45000 });
    console.log(`${tabela.rows.length} linha(s) de foto lidas.`);

    if (!tabela.rows.length) {
      throw new Error('Nenhuma linha encontrada -- abortando sem gravar (sessao expirada, ou mes sem foto ainda?).');
    }
    if (!tabela.headers.includes('Contrato Financeiro') || !tabela.headers.includes('Sondador') || !tabela.headers.includes('Data')) {
      throw new Error(`Cabeçalho inesperado (sem Contrato Financeiro/Sondador/Data): ${tabela.headers.join(', ')} -- abortando sem gravar.`);
    }

    const grid = [tabela.headers, ...tabela.rows];
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, gridParaCsv(grid), 'utf8');
    console.log(`Pronto: ${tabela.rows.length} linha(s) gravada(s) em ${OUT_PATH}.`);
  } finally {
    await cdp.fecharSessao(session, target);
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { main, primeiroEUltimoDiaDoMes };
