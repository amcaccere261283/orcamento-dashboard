// tools/orcamento/build-dashboard.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readXlsxSheet } = require('../comum/xlsx-reader.js');
const { parseMatriz, locateColumns } = require('./parse-matriz.js');
const { parseBaseline } = require('./parse-baseline.js');
const { renderDashboard } = require('./render-dashboard.js');
const { excelSerialParaData } = require('../comum/datas.js');
// Os dois mapas de reconciliação (TIP_MAP_LINHA_BASE/SUP_MAP_LINHA_BASE)
// moravam AQUI e, por isso, a página do Planejamento Semanal casava chaves
// cruas e errava em silêncio em ~1/3 da grade. Agora vivem em
// tools/comum/linha-base.js, consumidos pelas duas páginas -- ver o
// comentário de cabeçalho de lá.
const { reconciliarLinhaBase, chaveMatriz } = require('../comum/linha-base.js');
const config = require('./config.js');
const { parseCsvGrid } = require('../semanal/parse-matriz-cliente.js');
const { parseAvancos } = require('../semanal/parse-avancos.js');
const { parseLab } = require('../semanal/parse-lab.js');
const { redirecionarSupsDesconhecidos, chegadasMensaisPorRegistro } = require('../semanal/compute-demandas.js');

const RESUMO_ZERO = { pico: 0, media: 0, prod: 0, dias: 0 };

// Anexa previstoInicial em cada registro, casando por SUP+tipologia com a
// linha de base via reconciliarLinhaBase (tools/comum/linha-base.js): tenta
// o SUP da própria MATRIZ primeiro; se não achar (nem com a tipologia
// traduzida), tenta o nome mapeado em SUP_MAP_LINHA_BASE antes de desistir.
// Sem match nenhum, fica tudo zero (não null: "não fazia parte do estudo
// original" é uma resposta certa, diferente de "não tinha dado reportado
// ainda" nas outras séries).
// Devolve também as chaves da linha de base que NINGUÉM na MATRIZ atual
// reivindicou (mesmo depois do mapeamento manual) -- essa soma nunca
// aparece na coluna Previsto Inicial da tabela hoje, então é informação
// que build() deve logar pra quem for reconciliar os ~110MM não ficar sem
// saber que uma fatia ficou de fora por não casar, não por ser zero de verdade.
function anexarPrevistoInicial(registros, baseline) {
  const zero12 = () => Array(12).fill(0);
  const { porChaveMatriz, chavesUsadas } = reconciliarLinhaBase(registros, baseline.porChave);
  registros.forEach(registro => {
    const dados = porChaveMatriz.get(chaveMatriz(registro.sup, registro.tipologia));
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

// Lê as mesmas 4 fontes online que tools/semanal/build-dashboard.js já usa
// pra Demandas (avancos-online.csv + lab-online.csv, obrigatórios; os dois
// "pendentes" são opcionais -- sem eles o backlog ainda não executado fica
// de fora, mas o build não quebra) e devolve {chaveMatriz: [12 chegadas por
// mês]} pro Gráfico do orçamento, dimensão Volume -- ver
// docs/superpowers/specs/2026-08-13-demandas-no-grafico-orcamento-design.md.
// Os dois pipelines (semanal e orçamento) leem a MESMA MATRIZ por parsers
// diferentes, então redirecionarSupsDesconhecidos roda de novo aqui contra
// os `registros` do ORÇAMENTO -- não reaproveita o resultado da semanal.
function montarDemandasChegadasMensais({
  registros, periodos, caminhoAvancosOnline, caminhoDemandasSondagemOnline, caminhoLabOnline, caminhoDemandasLabOnline,
}) {
  let gridAvancos;
  try {
    gridAvancos = parseCsvGrid(fs.readFileSync(caminhoAvancosOnline, 'utf8'));
  } catch (err) {
    throw new Error(
      `Não consegui ler ${caminhoAvancosOnline}. Rode "node tools/semanal/atualizar-avancos-online.js" primeiro ` +
      `(precisa do Chrome aberto com --remote-debugging-port=9222, logado em sond.com.br). Erro original: ${err.message}`
    );
  }
  if (fs.existsSync(caminhoDemandasSondagemOnline)) {
    const gridPendentes = parseCsvGrid(fs.readFileSync(caminhoDemandasSondagemOnline, 'utf8'));
    for (let i = 1; i < gridPendentes.length; i++) gridAvancos.push(gridPendentes[i]);
  } else {
    console.warn(`AVISO: ${caminhoDemandasSondagemOnline} não encontrado -- Demandas do Gráfico não inclui furos ainda não executados. Rode "node tools/semanal/atualizar-demandas-sondagem-online.js".`);
  }
  gridAvancos.unshift(null);
  const { furos } = parseAvancos(gridAvancos);

  let gridLab;
  try {
    gridLab = parseCsvGrid(fs.readFileSync(caminhoLabOnline, 'utf8'));
    gridLab.unshift(null);
  } catch (err) {
    throw new Error(
      `Não consegui ler ${caminhoLabOnline}. Rode "node tools/semanal/atualizar-lab-online.js" primeiro ` +
      `(precisa do Chrome aberto com --remote-debugging-port=9222, logado em sond.com.br). Erro original: ${err.message}`
    );
  }
  const { ensaios: ensaiosLidos } = parseLab(gridLab);

  let ensaiosComPendentes = ensaiosLidos;
  if (fs.existsSync(caminhoDemandasLabOnline)) {
    const pendentesLab = JSON.parse(fs.readFileSync(caminhoDemandasLabOnline, 'utf8'))
      .map(e => ({ ...e, criacao: e.criacao ? new Date(e.criacao) : null, concluido: null }));
    ensaiosComPendentes = ensaiosLidos.concat(pendentesLab);
  } else {
    console.warn(`AVISO: ${caminhoDemandasLabOnline} não encontrado -- Demandas do Gráfico não inclui backlog de LAB.C/LAB.E. Rode "node tools/semanal/atualizar-demandas-lab-online.js".`);
  }

  const { itens: furosRedirecionados } = redirecionarSupsDesconhecidos(furos, registros);
  const { itens: ensaiosRedirecionados } = redirecionarSupsDesconhecidos(ensaiosComPendentes, registros);
  return chegadasMensaisPorRegistro(furosRedirecionados, ensaiosRedirecionados, periodos);
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
function build({
  outPath, today = new Date(), senha = process.env.ORCAMENTO_SENHA,
  caminhoAvancosOnline = path.join(__dirname, '..', '..', 'dist', 'avancos-online.csv'),
  caminhoDemandasSondagemOnline = path.join(__dirname, '..', '..', 'dist', 'demandas-sondagem-online.csv'),
  caminhoLabOnline = path.join(__dirname, '..', '..', 'dist', 'lab-online.csv'),
  caminhoDemandasLabOnline = path.join(__dirname, '..', '..', 'dist', 'demandas-lab-online.json'),
} = {}) {
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

  const demandasChegadasMensais = montarDemandasChegadasMensais({
    registros, periodos, caminhoAvancosOnline, caminhoDemandasSondagemOnline, caminhoLabOnline, caminhoDemandasLabOnline,
  });

  const html = renderDashboard({
    registros, periodos, generatedAt: today, senha, demandasChegadasMensais,
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

module.exports = { build, anexarPrevistoInicial, montarDemandasChegadasMensais };
