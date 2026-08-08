'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { mapearProducaoTotal } = require('./mapear-producao-total.js');
const { gridParaCsv } = require('./csv-writer-avancos.js');
const { parseCsvGrid } = require('./parse-matriz-cliente.js');
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
// Devolve o GRID (array de arrays: [header, ...rows]) -- nunca texto CSV já
// serializado, pra concatenação em main() não precisar cortar por '\n' (o que
// corromperia campos com quebra de linha interna, ex. "Observações de
// campo"). O cache em disco continua sendo texto CSV (formato de arquivo);
// ao ler do cache, reparseia pra grid com parseCsvGrid.
async function buscarMes(session, ano, mes, ehMesCorrente) {
  const cache = caminhoCache(ano, mes);
  if (!ehMesCorrente && fs.existsSync(cache)) {
    return parseCsvGrid(fs.readFileSync(cache, 'utf8'));
  }
  const mm = String(mes).padStart(2, '0');
  const url = `${SITE_ORIGIN}/extrato-producao-total/mes/${mm}/ano/${ano}/`;
  const { session: sessaoMes, target } = await cdp.abrirSessao(url);
  try {
    const { headers, rows } = await cdp.rasparTabelaDataTable(sessaoMes, '.producao-grid', { timeoutMs: 30000 });
    const linhas = cdp.linhasComoObjetos({ headers, rows });
    const { header, rows: rowsMapeadas } = mapearProducaoTotal(linhas);
    const grid = [header, ...rowsMapeadas];
    if (!ehMesCorrente) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(cache, gridParaCsv(grid), 'utf8');
    }
    return grid;
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
      const grid = await buscarMes(null, m.ano, m.mes, m.ehMesCorrente);
      const linhas = grid.length - 1;
      grids.push(grid);
      console.log(`  ${m.ano}-${String(m.mes).padStart(2, '0')}${m.ehMesCorrente ? ' (corrente)' : ''}: ${linhas} linha(s)`);
    } catch (err) {
      falhas.push({ mes: `${m.ano}-${String(m.mes).padStart(2, '0')}`, erro: err.message });
      console.warn(`  ${m.ano}-${String(m.mes).padStart(2, '0')}: FALHOU -- ${err.message}`);
    }
  }

  if (!grids.length) {
    throw new Error('Nenhum mês foi baixado com sucesso -- abortando sem gravar (ver falhas acima).');
  }

  // Concatena os GRIDS (arrays de arrays), não texto CSV: cabeçalho do
  // primeiro grid + linhas de dado de TODOS (o cabeçalho é sempre o mesmo,
  // produzido por mapearProducaoTotal). Serializa com gridParaCsv só UMA VEZ,
  // no final, sobre o array combinado -- assim campos com quebra de linha
  // interna (ex. "Observações de campo") ficam corretamente entre aspas e
  // não são confundidos com fim de linha.
  const header = grids[0][0];
  const linhasDado = grids.flatMap((grid) => grid.slice(1));
  const gridFinal = [header, ...linhasDado];

  try {
    locateColunasAvancos(header);
  } catch (err) {
    throw new Error(`Cabeçalho combinado ficou inválido -- abortando SEM gravar ${OUT_PATH}. Erro original: ${err.message}`);
  }

  const csvFinal = gridParaCsv(gridFinal);
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
