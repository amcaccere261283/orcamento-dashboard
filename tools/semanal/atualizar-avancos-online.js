'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { mapearProducaoTotal, HEADER_SAIDA } = require('./mapear-producao-total.js');
const { gridParaCsv } = require('./csv-writer-avancos.js');
const { parseCsvGrid } = require('./parse-matriz-cliente.js');
const { locateColunasAvancos } = require('./parse-avancos.js');
const { hojeNoFusoProjeto } = require('../comum/datas.js');
const cdp = require('./cdp-client.js');

const SITE_ORIGIN = 'https://sond.com.br';
const OUT_PATH = path.join(__dirname, '..', '..', 'dist', 'avancos-online.csv');
const CACHE_DIR = path.join(__dirname, '..', '..', 'dist', 'cache');
const DESDE = { ano: 2025, mes: 1 };

// Cobertura desde 2025-01 (decidido com o usuário) até o mês de 'hoje',
// inclusive. Só o ÚLTIMO item é o mês corrente -- todos os anteriores já
// fecharam e são candidatos a cache (execução passada não muda).
function mesesParaBuscar(hoje) {
  // UTC-3 desde 2026-08-10 ("considerar o utc-3 sempre"). Importa porque o
  // guard de "mês corrente falhou -> aborta sem gravar" (ver main) usaria,
  // nas últimas 3h de cada mês em UTC, um mês que ainda nem começou aqui.
  const { ano: anoAtual, mes: mesAtual } = hojeNoFusoProjeto(hoje);
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
// Devolve { grid, excluidos } -- grid é array de arrays ([header, ...rows]),
// nunca texto CSV já serializado, pra concatenação em main() não precisar
// cortar por '\n' (o que corromperia campos com quebra de linha interna, ex.
// "Observações de campo"). O cache em disco continua sendo texto CSV
// (formato de arquivo, já excluído); ao ler do cache, reparseia pra grid com
// parseCsvGrid e excluidos vem 0 -- a exclusão já aconteceu na execução que
// gravou o cache, não há como recontar sobre um CSV que já saiu filtrado.
// Um cache gravado por uma versão ANTERIOR do mapeador tem outro conjunto de
// colunas. Sem esta checagem, meses fechados voltariam do disco no formato
// velho e o mês corrente viria no novo: main() usa o cabeçalho do PRIMEIRO
// grid para todos, então as colunas de quase todo o histórico ficariam
// deslocadas em silêncio -- a mesma classe de erro que o guard de cabeçalho
// combinado já evita na saída. Cache com formato divergente é tratado como
// inexistente e rebuscado. (Necessário em 2026-08-10, quando HEADER_SAIDA
// encolheu de 12 para 9 colunas.)
function cacheUtilizavel(grid) {
  const cabecalho = (grid && grid[0]) || [];
  return HEADER_SAIDA.length === cabecalho.length
    && HEADER_SAIDA.every((rotulo, i) => String(cabecalho[i] || '').trim() === rotulo);
}

async function buscarMes(ano, mes, ehMesCorrente) {
  const cache = caminhoCache(ano, mes);
  if (!ehMesCorrente && fs.existsSync(cache)) {
    const grid = parseCsvGrid(fs.readFileSync(cache, 'utf8'));
    if (cacheUtilizavel(grid)) return { grid, excluidos: 0 };
    console.warn(`  cache de ${ano}-${String(mes).padStart(2, '0')} está no formato antigo -- rebuscando.`);
  }
  const mm = String(mes).padStart(2, '0');
  const url = `${SITE_ORIGIN}/extrato-producao-total/mes/${mm}/ano/${ano}/`;
  const { session: sessaoMes, target } = await cdp.abrirSessao(url);
  try {
    const { headers, rows } = await cdp.rasparTabelaDataTable(sessaoMes, '.producao-grid', { timeoutMs: 30000 });
    const linhas = cdp.linhasComoObjetos({ headers, rows });
    const { header, rows: rowsMapeadas, excluidos } = mapearProducaoTotal(linhas);
    const grid = [header, ...rowsMapeadas];
    if (!ehMesCorrente) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(cache, gridParaCsv(grid), 'utf8');
    }
    return { grid, excluidos };
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
  let excluidosTotal = 0;
  for (const m of meses) {
    try {
      const { grid, excluidos } = await buscarMes(m.ano, m.mes, m.ehMesCorrente);
      const linhas = grid.length - 1;
      grids.push(grid);
      excluidosTotal += excluidos;
      console.log(`  ${m.ano}-${String(m.mes).padStart(2, '0')}${m.ehMesCorrente ? ' (corrente)' : ''}: ${linhas} linha(s)`);
    } catch (err) {
      falhas.push({ mes: `${m.ano}-${String(m.mes).padStart(2, '0')}`, erro: err.message, ehMesCorrente: m.ehMesCorrente });
      console.warn(`  ${m.ano}-${String(m.mes).padStart(2, '0')}: FALHOU -- ${err.message}`);
    }
  }

  if (!grids.length) {
    throw new Error('Nenhum mês foi baixado com sucesso -- abortando sem gravar (ver falhas acima).');
  }

  // Achado da revisão final de branch (2026-08-08): meses FECHADOS vêm do
  // cache local na maioria das execuções (só o mês corrente busca CDP toda
  // vez -- ver buscarMes), então uma sessão CDP quebrada normalmente derruba
  // SÓ o mês corrente. Sem este guard, o build seguia em frente com um
  // console.warn e regravava avancos-online.csv sem o mês corrente -- o
  // Realizado do mês em curso ficava perto de zero, silenciosamente, sem
  // nenhum sinal além de um log que ninguém olha. Mesmo espírito de "nunca
  // substituir dado bom por dado ruim" que o resto do projeto já segue (ver
  // o guard de cabeçalho inválido logo abaixo). Meses FECHADOS que falharem
  // continuam só avisando -- o cache local já cobre a maioria dos casos, e
  // abortar por um mês fechado isolado seria trocar disponibilidade por um
  // rigor que o dado antigo já satisfaz.
  const falhaMesCorrente = falhas.find((f) => f.ehMesCorrente);
  if (falhaMesCorrente) {
    throw new Error(
      `O mês CORRENTE (${falhaMesCorrente.mes}) falhou ao buscar -- abortando SEM gravar ${OUT_PATH} ` +
      `pra não substituir o CSV bom já publicado por um sem o mês em curso (o Realizado ficaria perto de ` +
      `zero em silêncio). Erro original: ${falhaMesCorrente.erro}`
    );
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
  if (excluidosTotal > 0) {
    console.log(`${excluidosTotal} linha(s) excluída(s) no total (Suporte Sondagens/SEG/SN).`);
  }
  if (falhas.length) {
    console.warn(`${falhas.length} mes(es) falharam e ficaram DE FORA: ${falhas.map((f) => f.mes).join(', ')}`);
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { mesesParaBuscar, cacheUtilizavel, main };
