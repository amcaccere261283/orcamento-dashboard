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
const { rotularTipologia } = require('../comum/tipologias-avancos.js');
const config = require('./config.js');
const { parseCsvGrid } = require('../semanal/parse-matriz-cliente.js');
const { parseAvancos } = require('../semanal/parse-avancos.js');
const { parseLab } = require('../semanal/parse-lab.js');
const { redirecionarSupsDesconhecidos, chegadasMensaisPorRegistro, saldoAberturaPorRegistro } = require('../semanal/compute-demandas.js');
const { montarPropostasGanhas } = require('./parse-propostas-ganhas.js');
const { montarFunilDemandas } = require('./compute-demandas-funil.js');
const { gridParaCsv } = require('../semanal/csv-writer-avancos.js');
const { montarBacklog2026, gerarBacklog2026Online } = require('./compute-backlog-2026.js');

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
// de fora, mas o build não quebra) e devolve os dois insumos que o Gráfico
// do orçamento (dimensão Volume) precisa:
// - chegadasMensais: {chaveMatriz: [12 chegadas por mês]} -- a barra mensal.
// - saldoAbertura: {chaveMatriz: número} -- o estoque em aberto no fim do
//   ano ANTERIOR ao exibido, ponto de partida da linha Acumulado. Sem isso,
//   um contrato cuja carteira em execução veio majoritariamente de antes do
//   ano exibido mostra "Demandas acumulado" abaixo de "Realizado acumulado"
//   (achado ao vivo em 2026-08-13, SUP-8370-25/Rota Sorocabana -- ver
//   docs/superpowers/specs/2026-08-13-demandas-no-grafico-orcamento-design.md).
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

  const { itens: furosRedirecionados, redirecionados: furosRedirecionadosQtd } = redirecionarSupsDesconhecidos(furos, registros);
  const { itens: ensaiosRedirecionados, redirecionados: ensaiosRedirecionadosQtd } = redirecionarSupsDesconhecidos(ensaiosComPendentes, registros);
  const chegadasMensais = chegadasMensaisPorRegistro(furosRedirecionados, ensaiosRedirecionados, periodos);
  const saldoAbertura = saldoAberturaPorRegistro(furosRedirecionados, ensaiosRedirecionados, periodos);
  console.log(`Demandas do Gráfico: ${furos.length} furo(s) e ${ensaiosComPendentes.length} ensaio(s) lido(s), ${Object.keys(chegadasMensais).length} combinação(ões) SUP+tipologia com chegada em ${periodos[0].getUTCFullYear()}, ${Object.keys(saldoAbertura).length} combinação(ões) com saldo aberto em 31/12/${periodos[0].getUTCFullYear() - 1}, ${furosRedirecionadosQtd} furo(s) e ${ensaiosRedirecionadosQtd} ensaio(s) redirecionado(s) pra "Diversos" (SUP sem registro na MATRIZ do orçamento).`);
  return { chegadasMensais, saldoAbertura };
}

// Calibração manual do saldo de abertura de LAB.C + LAB.E (2026-09-09):
// saldoAberturaPorRegistro só enxerga o backlog que o histórico de
// furos/ensaios sabe reconstruir -- o dono do projeto tem um número real,
// medido fora deste pipeline, que o histórico não bate. Medido em 31/08/2026:
// 12.800 pontos de saldo (Convencional + Especial), contra 116.258 de
// Realizado acumulado -- ou seja, o Acumulado de Demandas em agosto/2026
// deveria fechar em 129.058 (12.800 + 116.258), não no que o pipeline calcula
// sozinho. calibrarSaldoAberturaLab mede a diferença entre esse alvo e o que
// o pipeline fecha HOJE (chegadas mensais recalculam a cada atualização de
// dado, então essa diferença também recalcula) e soma o que falta ao saldo de
// abertura de 'Diversos' -- mesmo bucket que já recebe furo/ensaio de SUP sem
// registro na MATRIZ -- proporcional ao saldo de abertura que LAB.C e LAB.E
// já tinham cada um. Como saldo de abertura entra uma vez só, em janeiro, e
// se soma em cada mês seguinte, esse ajuste desloca a curva INTEIRA (jan..dez)
// pelo mesmo valor -- é o mesmo resultado que "retroagir o acumulado mês a
// mês pelos valores mensais do gráfico" pediria à mão: os incrementos
// mensais (chegadas) não mudam, só o ponto de partida.
const ANO_ALVO_CALIBRACAO_LAB = 2026;
const MES_ALVO_CALIBRACAO_LAB = 7; // agosto, 0-indexado
const TIPOLOGIAS_CALIBRACAO_LAB = ['LAB.C', 'LAB.E'];
const VALOR_ALVO_ACUMULADO_CALIBRACAO_LAB = 129058;

function calibrarSaldoAberturaLab({ registros, periodos, chegadasMensais, saldoAbertura }) {
  const idxAlvo = periodos.findIndex(p => p.getUTCFullYear() === ANO_ALVO_CALIBRACAO_LAB && p.getUTCMonth() === MES_ALVO_CALIBRACAO_LAB);
  if (idxAlvo < 0) return saldoAbertura; // ano exibido não é o calibrado -- não se aplica

  const chavesPorTipologia = {};
  for (const tip of TIPOLOGIAS_CALIBRACAO_LAB) chavesPorTipologia[tip] = [];
  for (const r of registros) {
    if (chavesPorTipologia[r.tipologia]) chavesPorTipologia[r.tipologia].push(chaveMatriz(r.sup, r.tipologia));
  }

  let acumuladoAtual = 0;
  const saldoAtualPorTipologia = {};
  for (const tip of TIPOLOGIAS_CALIBRACAO_LAB) {
    let saldoTip = 0;
    let acumTip = 0;
    for (const chave of chavesPorTipologia[tip]) {
      saldoTip += saldoAbertura[chave] || 0;
      const mensal = chegadasMensais[chave];
      if (mensal) for (let i = 0; i <= idxAlvo; i++) acumTip += mensal[i];
    }
    saldoAtualPorTipologia[tip] = saldoTip;
    acumuladoAtual += saldoTip + acumTip;
  }

  const diferenca = VALOR_ALVO_ACUMULADO_CALIBRACAO_LAB - acumuladoAtual;
  if (diferenca === 0) return saldoAbertura;

  const somaSaldoAtual = TIPOLOGIAS_CALIBRACAO_LAB.reduce((soma, tip) => soma + saldoAtualPorTipologia[tip], 0);
  const saldoCalibrado = Object.assign({}, saldoAbertura);
  let distribuido = 0;
  TIPOLOGIAS_CALIBRACAO_LAB.forEach((tip, i) => {
    const ultimoDaLista = i === TIPOLOGIAS_CALIBRACAO_LAB.length - 1;
    const proporcao = somaSaldoAtual > 0 ? saldoAtualPorTipologia[tip] / somaSaldoAtual : 1 / TIPOLOGIAS_CALIBRACAO_LAB.length;
    // O último da lista fica com o resto da divisão -- garante que a soma dos
    // pedaços bate exatamente com 'diferenca', mesmo com arredondamento.
    const parcela = ultimoDaLista ? (diferenca - distribuido) : Math.round(diferenca * proporcao);
    distribuido += parcela;
    const chaveDiversos = chaveMatriz('Diversos', tip);
    saldoCalibrado[chaveDiversos] = (saldoCalibrado[chaveDiversos] || 0) + parcela;
  });

  console.log(`Calibração de saldo de abertura LAB.C+LAB.E: acumulado em agosto/2026 fechava em ${acumuladoAtual.toLocaleString('pt-BR')} sem ajuste, alvo é ${VALOR_ALVO_ACUMULADO_CALIBRACAO_LAB.toLocaleString('pt-BR')} -- ${diferenca >= 0 ? 'somado' : 'subtraído'} ${Math.abs(diferenca).toLocaleString('pt-BR')} ao saldo de abertura de 'Diversos' (LAB.C/LAB.E), proporcional ao saldo que cada um já tinha.`);

  return saldoCalibrado;
}

// Lê dist/liberado-sond-online.csv (OPCIONAL -- gerado por
// atualizar-liberado-sond.js, que precisa de chave de API e rede, então não
// roda em todo build local): uma linha por (contrato, sigla), com o volume
// PREVISTO/EXECUTADO/SALDO já cadastrado pra execução na SOND. Agrega por
// chaveMatriz(contrato, tipologia canônica) -- várias siglas cruas (SM,
// SM.F, SR, ...) caem no mesmo bucket da MATRIZ (rotularTipologia), somando
// prevista/executada/saldo entre elas. Sem o CSV, o build segue (aviso no
// console); o funil de Demandas só fica sem a etapa "liberado na SOND".
// Não recebe `registros` -- a agregação só depende do próprio CSV, o join
// com a MATRIZ acontece depois, no consumidor do funil (fora desta task).
// Exporta o lado "contratado" do funil de Demandas em CSV ABERTO (sem senha)
// -- dist/demandas-contratado-online.csv, consumido pelo build das medições
// (repositório matriz-equipes-source, tools/medicoes/build-dashboard.js) pra
// saber quais SUPs já estão contratados na MATRIZ (aba Demandas daqui), mesmo
// antes de aparecerem em liberado-sond-online.csv. Só linhas com tomador
// (veio da MATRIZ, não é órfã do liberadoSond -- ver montarFunilDemandas) e
// contratado > 0. Roda em TODO build normal -- a MATRIZ já é lida sempre,
// sem depender de nenhuma busca de API extra (diferente de
// liberado-sond-online.csv, que precisa do fetcher separado). Ver
// docs/superpowers/specs/2026-09-10-backlog-demandas-contratado-design.md
// no repositório matriz-equipes-source.
function gerarDemandasContratadoOnline(demandasFunilLinhas) {
  const linhasValidas = (demandasFunilLinhas || []).filter((l) => l.tomador && l.contratado > 0);
  const grid = [['Cliente', 'Contrato'], ...linhasValidas.map((l) => [l.tomador, l.sup])];
  return gridParaCsv(grid);
}

function montarLiberadoSond({ caminhoLiberadoSondOnline }) {
  if (!fs.existsSync(caminhoLiberadoSondOnline)) {
    console.warn(`AVISO: ${caminhoLiberadoSondOnline} não encontrado -- funil de Demandas fica sem a etapa "liberado na SOND". Rode "node tools/orcamento/atualizar-liberado-sond.js".`);
    return {};
  }

  const grid = parseCsvGrid(fs.readFileSync(caminhoLiberadoSondOnline, 'utf8'));
  const headerRow = grid[0] || [];
  const colContrato = headerRow.indexOf('Contrato');
  const colSigla = headerRow.indexOf('Sigla');
  const colPrevista = headerRow.indexOf('Prevista');
  const colExecutada = headerRow.indexOf('Executada');
  const colSaldo = headerRow.indexOf('Saldo');
  const faltando = ['Contrato', 'Sigla', 'Prevista', 'Executada', 'Saldo'].filter(nome => headerRow.indexOf(nome) === -1);
  if (faltando.length) {
    throw new Error(`${caminhoLiberadoSondOnline}: coluna(s) obrigatória(s) não encontrada(s) no cabeçalho: ${faltando.join(', ')}.`);
  }

  const liberadoSond = {};
  for (let i = 1; i < grid.length; i++) {
    const row = grid[i];
    if (!row || row.every(v => String(v || '').trim() === '')) continue;
    const contrato = row[colContrato];
    const tipologia = rotularTipologia(row[colSigla]);
    const chave = chaveMatriz(contrato, tipologia);
    if (!liberadoSond[chave]) liberadoSond[chave] = { prevista: 0, executada: 0, saldo: 0 };
    liberadoSond[chave].prevista += Number(row[colPrevista]) || 0;
    liberadoSond[chave].executada += Number(row[colExecutada]) || 0;
    liberadoSond[chave].saldo += Number(row[colSaldo]) || 0;
  }
  return liberadoSond;
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
  caminhoLiberadoSondOnline = path.join(__dirname, '..', '..', 'dist', 'liberado-sond-online.csv'),
  caminhoDemandasContratadoOnline = path.join(__dirname, '..', '..', 'dist', 'demandas-contratado-online.csv'),
  caminhoBacklog2026Online = path.join(__dirname, '..', '..', 'dist', 'backlog-2026-online.csv'),
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

  const { chegadasMensais: demandasChegadasMensais, saldoAbertura: demandasSaldoAberturaBruto } = montarDemandasChegadasMensais({
    registros, periodos, caminhoAvancosOnline, caminhoDemandasSondagemOnline, caminhoLabOnline, caminhoDemandasLabOnline,
  });
  const demandasSaldoAbertura = calibrarSaldoAberturaLab({
    registros, periodos, chegadasMensais: demandasChegadasMensais, saldoAbertura: demandasSaldoAberturaBruto,
  });

  const liberadoSond = montarLiberadoSond({ caminhoLiberadoSondOnline });
  const propostasGanhas = montarPropostasGanhas({ registros, liberadoSond, caminhoRadarDemandas: config.caminhoRadarDemandas });
  const { linhas: demandasFunilLinhas, propostasGanhas: demandasFunilPropostas } = montarFunilDemandas({ registros, liberadoSond, propostasGanhas });

  // Linhas "órfãs": chave do liberadoSond sem registro correspondente na
  // MATRIZ (montarFunilDemandas marca essas com tomador null -- ver o
  // comentário lá). Sem esse aviso elas ficam invisíveis no console --
  // 54 numa rodada real, quase sempre porque o `numero_contrato` do
  // catálogo (extrato-gerencial-mensal/contratos.yaml) não bate
  // caractere-a-caractere com o `sup` da MATRIZ (ex.: hífen faltando, tipo
  // "SUP8224-25 (RS)" em vez de "SUP-8224-25 (RS)") -- não é bug de junção,
  // é mismatch de dado; ver compute-demandas-funil.js. Listar os SUPs (até
  // 20) é o que deixa um humano notar esse tipo específico de erro de
  // digitação sem precisar decifrar o dashboard.
  const orfasFunilDemandas = demandasFunilLinhas.filter(linha => linha.tomador === null);
  if (orfasFunilDemandas.length > 0) {
    const sups = orfasFunilDemandas.map(linha => linha.sup);
    const detalhe = sups.length <= 20 ? `: ${sups.join(', ')}` : ' (lista grande demais para exibir, confira dist/liberado-sond-online.csv)';
    console.warn(`AVISO: funil de Demandas tem ${orfasFunilDemandas.length} linha(s) órfã(s) do liberadoSond sem registro correspondente na MATRIZ${detalhe}`);
  }

  const csvDemandasContratado = gerarDemandasContratadoOnline(demandasFunilLinhas);
  fs.mkdirSync(path.dirname(caminhoDemandasContratadoOnline), { recursive: true });
  fs.writeFileSync(caminhoDemandasContratadoOnline, csvDemandasContratado, 'utf8');

  // Realizado + tendência 2026 por SUP, em R$ (ver compute-backlog-2026.js)
  // -- aberto, sem senha, lido pelo Backlog das medições.
  const csvBacklog2026 = gerarBacklog2026Online(montarBacklog2026({ registros, periodos, today }));
  fs.mkdirSync(path.dirname(caminhoBacklog2026Online), { recursive: true });
  fs.writeFileSync(caminhoBacklog2026Online, csvBacklog2026, 'utf8');

  const html = renderDashboard({
    registros, periodos, generatedAt: today, senha, demandasChegadasMensais, demandasSaldoAbertura,
    liberadoSond, propostasGanhas,
    demandasFunilLinhas, demandasFunilPropostas,
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

module.exports = { build, anexarPrevistoInicial, montarDemandasChegadasMensais, calibrarSaldoAberturaLab, montarLiberadoSond, gerarDemandasContratadoOnline };
