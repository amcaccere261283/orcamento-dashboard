'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { mapearProducaoTotal } = require('./mapear-producao-total.js');
const { gridParaCsv } = require('./csv-writer-avancos.js');
const { locateColunasAvancos } = require('./parse-avancos.js');
const cdp = require('./cdp-client.js');

const SITE_ORIGIN = 'https://sond.com.br';
const OUT_PATH = path.join(__dirname, '..', '..', 'dist', 'avancos-online.csv');
const CACHE_DIR = path.join(__dirname, '..', '..', 'dist', 'cache');
const DESDE = { ano: 2025, mes: 1 };

// Cobertura desde 2025-01 (decidido com o usuário) até o mês de 'hoje',
// inclusive. Só o ÚLTIMO item é o mês corrente -- todos os anteriores já
// fecharam e são candidatos a cache (execução passada não muda).
function mesesParaBuscar(hoje) {
  const anoAtual = hoje.getUTCFullYear();
  const mesAtual = hoje.getUTCMonth() + 1;
  const meses = [];
  let ano = DESDE.ano;
  let mes = DESDE.mes;
  while (ano < anoAtual || (ano === anoAtual && mes <= mesAtual)) {
    const ehMesCorrente = ano === anoAtual && mes === mesAtual;
    meses.push({ ano, mes, ehMesCorrente });
    mes++;
    if (mes > 12) { mes = 1; ano++; }
  }
  return meses;
}

function caminhoCache(ano, mes) {
  return path.join(CACHE_DIR, `producao-total-${ano}-${String(mes).padStart(2, '0')}.csv`);
}

// Busca um mês (Link 1). Mês corrente é sempre buscado de novo; mês fechado
// só é buscado se o cache não existir -- execução já concluída não muda.
async function buscarMes(session, ano, mes, ehMesCorrente) {
  const cache = caminhoCache(ano, mes);
  if (!ehMesCorrente && fs.existsSync(cache)) {
    return fs.readFileSync(cache, 'utf8');
  }
  const mm = String(mes).padStart(2, '0');
  const url = `${SITE_ORIGIN}/extrato-producao-total/mes/${mm}/ano/${ano}/`;
  const { session: sessaoMes, target } = await cdp.abrirSessao(url);
  try {
    const { headers, rows } = await cdp.rasparTabelaDataTable(sessaoMes, '.producao-grid', { timeoutMs: 30000 });
    const linhas = cdp.linhasComoObjetos({ headers, rows });
    const { header, rows: rowsMapeadas } = mapearProducaoTotal(linhas);
    const csv = gridParaCsv([header, ...rowsMapeadas]);
    if (!ehMesCorrente) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(cache, csv, 'utf8');
    }
    return csv;
  } finally {
    await cdp.fecharSessao(sessaoMes, target);
  }
}

async function main() {
  console.log('Checando conexao com o Chrome (CDP)...');
  await cdp.checarConexao();

  const meses = mesesParaBuscar(new Date());
  console.log(`Buscando ${meses.length} mes(es) de extrato-producao-total (2025-01 ate o mes corrente)...`);

  const grids = [];
  const falhas = [];
  for (const m of meses) {
    try {
      const csv = await buscarMes(null, m.ano, m.mes, m.ehMesCorrente);
      const linhas = csv.trim().split('\n').length - 1;
      grids.push(csv);
      console.log(`  ${m.ano}-${String(m.mes).padStart(2, '0')}${m.ehMesCorrente ? ' (corrente)' : ''}: ${linhas} linha(s)`);
    } catch (err) {
      falhas.push({ mes: `${m.ano}-${String(m.mes).padStart(2, '0')}`, erro: err.message });
      console.warn(`  ${m.ano}-${String(m.mes).padStart(2, '0')}: FALHOU -- ${err.message}`);
    }
  }

  if (!grids.length) {
    throw new Error('Nenhum mês foi baixado com sucesso -- abortando sem gravar (ver falhas acima).');
  }

  // Concatena: cabeçalho do primeiro grid + linhas de dado de TODOS (o
  // cabeçalho é sempre o mesmo, produzido por mapearProducaoTotal).
  const header = grids[0].split('\n')[0];
  const linhasDado = grids.flatMap((csv) => csv.trim().split('\n').slice(1));
  const csvFinal = [header, ...linhasDado].join('\n') + '\n';

  try {
    locateColunasAvancos(header.split(','));
  } catch (err) {
    throw new Error(`Cabeçalho combinado ficou inválido -- abortando SEM gravar ${OUT_PATH}. Erro original: ${err.message}`);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, csvFinal, 'utf8');

  console.log(`Pronto: ${grids.length}/${meses.length} mes(es) combinados, ${linhasDado.length} linha(s), gravado em ${OUT_PATH}.`);
  if (falhas.length) {
    console.warn(`${falhas.length} mes(es) falharam e ficaram DE FORA: ${falhas.map((f) => f.mes).join(', ')}`);
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { mesesParaBuscar, main };
