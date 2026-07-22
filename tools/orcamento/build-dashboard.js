// tools/orcamento/build-dashboard.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readXlsxSheet } = require('./xlsx-reader.js');
const { parseMatriz, locateColumns } = require('./parse-matriz.js');
const { parseBaseline } = require('./parse-baseline.js');
const { renderDashboard } = require('./render-dashboard.js');
const { excelSerialParaData } = require('./datas.js');
const config = require('./config.js');

// LAB.C/LAB.E (rótulo da MATRIZ viva) equivalem a LAB./LAB. ESPECIAL na
// linha de base (mesma tradução usada em toda a integração com arquivos
// externos deste projeto -- ver o Apps Script e a análise da MATRIZ real).
const TIP_MAP_LINHA_BASE = { 'LAB.C': 'LAB.', 'LAB.E': 'LAB. ESPECIAL' };
const RESUMO_ZERO = { pico: 0, media: 0, prod: 0, dias: 0 };

// Anexa previstoInicial em cada registro, casando por SUP+tipologia com a
// linha de base -- se não achar o SUP (ou a tipologia) lá, fica tudo zero
// (não null: "não fazia parte do estudo original" é uma resposta certa,
// diferente de "não tinha dado reportado ainda" nas outras séries).
// Devolve também as chaves da linha de base que NINGUÉM na MATRIZ atual
// reivindicou (SUP renomeado/renovado desde o estudo original, ou usando
// nome descritivo em vez de código SUP-nnnn-aa lá) -- essa soma nunca
// aparece na coluna Previsto Inicial da tabela hoje, então é informação
// que build() deve logar pra quem for reconciliar os ~110MM não ficar sem
// saber que uma fatia ficou de fora por não casar, não por ser zero de verdade.
function anexarPrevistoInicial(registros, baseline) {
  const zero12 = () => Array(12).fill(0);
  const chavesUsadas = new Set();
  registros.forEach(registro => {
    const tipologiaBaseline = TIP_MAP_LINHA_BASE[registro.tipologia] || registro.tipologia;
    const chave = `${registro.sup}||${tipologiaBaseline}`;
    chavesUsadas.add(chave);
    const dados = baseline.porChave.get(chave);
    registro.previstoInicial = {
      equipes: dados ? dados.equipes : zero12(),
      equipesResumo: RESUMO_ZERO,
      volume: dados ? dados.volume : zero12(),
      volumeResumo: { total: 0, totalInicial: 0, ticket: 0 },
      financeiro: dados ? dados.financeiro : zero12(),
      financeiroResumo: { total: 0, totalInicial: 0 },
    };
  });

  let somaSemMatch = 0;
  let chavesSemMatch = 0;
  for (const [chave, dados] of baseline.porChave.entries()) {
    if (chavesUsadas.has(chave)) continue;
    chavesSemMatch++;
    somaSemMatch += dados.financeiro.reduce((a, b) => a + (b || 0), 0);
  }
  return { chavesSemMatch, somaSemMatch };
}

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

  const gridLinhaBase = readXlsxSheet(config.caminhoLinhaBase, config.nomeAbaLinhaBase);
  const baseline = parseBaseline(gridLinhaBase);
  console.log(`Linha de base: financeiro somado = R$ ${baseline.somaFinanceiroConferencia.toLocaleString('pt-BR')} (esperado ~110MM -- confere ${config.nomeAbaLinhaBase})`);
  const { chavesSemMatch, somaSemMatch } = anexarPrevistoInicial(registros, baseline);
  if (chavesSemMatch > 0) {
    console.log(`Linha de base: ${chavesSemMatch} combinações SUP+tipologia (R$ ${somaSemMatch.toLocaleString('pt-BR')}) não casaram com nenhum registro da MATRIZ atual -- SUP renomeado/renovado desde o estudo original, ou nome descritivo em vez de código. Não aparecem na coluna Previsto Inicial da tabela.`);
  }

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
