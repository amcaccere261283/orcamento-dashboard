'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { mapearDemandasLab } = require('./mapear-demandas-lab.js');
const cdp = require('./cdp-client.js');

const SITE_ORIGIN = 'https://sond.com.br';
const OUT_PATH = path.join(__dirname, '..', '..', 'dist', 'demandas-lab-online.json');

async function main() {
  console.log('Checando conexao com o Chrome (CDP)...');
  await cdp.checarConexao();

  console.log('Buscando ensaios de lab pendentes (Link 5 -- detalhes-ensaios-programados)...');
  const { session, target } = await cdp.abrirSessao(`${SITE_ORIGIN}/detalhes-ensaios-programados/`);
  let linhas;
  try {
    const { headers, rows } = await cdp.rasparTabelaDataTable(session, '#table', { timeoutMs: 30000 });
    linhas = cdp.linhasComoObjetos({ headers, rows });
  } finally {
    await cdp.fecharSessao(session, target);
  }

  const { ensaios, excluidos } = mapearDemandasLab(linhas);
  console.log(`Pronto: ${ensaios.length} ensaio(s) pendente(s), ${excluidos} excluído(s) (Suporte Sondagens/SEG/SN).`);

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  // JSON, não CSV: 'criacao' já é Date aqui (dataDeTexto já rodou dentro de
  // mapearDemandasLab) -- build-dashboard.js reidrata as datas ao ler (ver
  // Task 12). Diferente de Sondagem, não existe parseAvancos/parseLab a
  // reaproveitar para este formato -- os campos JÁ são o shape final que
  // computeDemandas espera.
  fs.writeFileSync(OUT_PATH, JSON.stringify(ensaios.map(e => ({
    ...e, criacao: e.criacao ? e.criacao.toISOString() : null,
  })), null, 2), 'utf8');
  console.log(`Gravado em ${OUT_PATH}.`);
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { main };
