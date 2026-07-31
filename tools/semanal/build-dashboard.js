// tools/semanal/build-dashboard.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readXlsxSheet } = require('../comum/xlsx-reader.js');
// Mesma fonte de dados do orçamento (a MATRIZ viva + o estudo de linha de
// base) -- o Planejamento Semanal reparte os MESMOS registros mensais em
// semanas (ver tools/semanal/compute-semanal.js), não é uma planilha
// separada. Por isso reaproveita parse-matriz.js/parse-baseline.js/
// config.js de tools/orcamento/ em vez de duplicá-los aqui.
const { parseMatriz, locateColumns } = require('../orcamento/parse-matriz.js');
const { parseBaseline } = require('../orcamento/parse-baseline.js');
const { renderSemanal } = require('./render-semanal.js');
const { excelSerialParaData } = require('../comum/datas.js');
const { reconciliarLinhaBase, chaveMatriz } = require('../comum/linha-base.js');
const config = require('../orcamento/config.js');
const { parseAvancos } = require('./parse-avancos.js');
const { parseLab } = require('./parse-lab.js');
const { computeDemandas, reconciliarSups } = require('./compute-demandas.js');
const configDemandas = require('./config-demandas.js');
const configLab = require('./config-lab.js');

// Mesmo logo/avatar do orçamento (tools/orcamento/build-dashboard.js) --
// mesmos arquivos em assets/, mesma função de carregar, duplicada aqui de
// propósito (Node-only, 2 chamadores só, não vale um módulo comum novo pra
// isso). Ausência do arquivo não quebra o build -- loadDataUri devolve
// undefined, e renderSemanal trata isso como "sem logo/sem marca d'água".
const LOGO_PATH = path.join(__dirname, '..', '..', 'assets', 'logo-suporte-infra-negativo.png');
const ICON_PATH = path.join(__dirname, '..', '..', 'assets', 'logo-alvo.png');

function loadDataUri(filePath) {
  if (!fs.existsSync(filePath)) return undefined;
  const buf = fs.readFileSync(filePath);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

// parseBaseline devolve um Map (porChave) -- JSON.stringify não sabe
// serializar Map (viraria "{}", perdendo os dados em silêncio dentro do
// blob cifrado). renderSemanal só faz JSON.stringify({registros, baseline}),
// então quem chama precisa entregar algo que sobreviva a isso: um array
// simples de entradas, no mesmo formato que test/semanal-build-dashboard.test.js
// já usa (baseline: []). Extraída como função pura (em vez de ficar inline
// em build()) pra dar pra testar sem precisar montar um .xlsx sintético --
// ver test/semanal-build-dashboard.test.js.
//
// As chaves que saem daqui são as da MATRIZ (`sup||tipologia` crus), NÃO as
// do estudo de linha de base: reconciliarLinhaBase (tools/comum/linha-base.js)
// aplica a MESMA tradução que o orçamento aplica em anexarPrevistoInicial
// (LAB.C -> 'LAB.', LAB.E -> 'LAB. ESPECIAL', e os 7 SUPs renomeados/
// renovados). Sem isso, chaveBaseline em compute-balanco.js -- que procura a
// chave CRUA, e é o cliente, não pode carregar os mapas -- não acharia nada
// para essas linhas e a base "Previsto Inicial" viraria semBase:true em ~1/3
// da grade real, indistinguível de contrato novo. Por isso 'registros' é
// obrigatório: é deles que sai o lado esquerdo da chave.
function baselineParaCliente(porChave, registros) {
  const { porChaveMatriz } = reconciliarLinhaBase(registros, porChave);
  return Array.from(porChaveMatriz, ([chave, dados]) => ({ chave, ...dados }));
}

// Furo/ensaio cuja combinação (sup, tipologia) não existe como registro na
// MATRIZ não tem "onde" contar -- ficaria fora do Realizado/Demandas
// Pendentes da Tabela Semanal em silêncio, mesmo sendo trabalho real
// (achado de 2026-08-01: primeiro em 409 ensaios de laboratório/mês, depois
// generalizado ao notar o mesmo problema em furos de Sondagem -- SP
// mostrava 1.506 no acompanhamento contra 1.519 numa contagem direta na
// planilha, 13 furos com SUP fora da MATRIZ). A MATRIZ já tem um registro
// "Diversos" com Previsto próprio pra cada uma das suas 10 tipologias
// (inclusive LAB.C/LAB.E) -- decisão do dono do projeto: SUP não cadastrado
// na MATRIZ SEMPRE redireciona pra Diversos, sem exceção, em vez de ser
// descartado. Função pura e agnóstica ao tipo de item (funciona pra
// ensaios de laboratório E furos de Sondagem/Avanços -- os dois só
// precisam de 'sup'/'tipologia'), mesmo padrão de baselineParaCliente
// acima, pra testar sem planilha sintética.
//
// Tipologias sem registro Diversos na MATRIZ (SEG.A, SEG.V, Especiais --
// só existem no Avanços, sem equivalente na MATRIZ; SP.F e as outras 3
// reclassificações de 2026-08-01 -- ver tools/comum/tipologias-avancos.js
// -- já saem de rotularTipologia coladas numa das 10 tipologias da MATRIZ,
// então não chegam aqui como rótulo próprio) continuam de fora mesmo
// depois do redirecionamento: a chave vira 'Diversos||<tipologia>', que
// também não existe entre os registros, então o item continua sem "onde"
// contar. Isso é uma limitação estrutural (não há Previsto pra atribuir a
// algo que a MATRIZ não modela), não um bug desta função.
function redirecionarSupsDesconhecidos(itens, registros) {
  const chavesConhecidas = new Set(registros.map(r => chaveMatriz(r.sup, r.tipologia)));
  let redirecionados = 0;
  const saida = itens.map(item => {
    if (chavesConhecidas.has(chaveMatriz(item.sup, item.tipologia))) return item;
    redirecionados++;
    return Object.assign({}, item, { sup: 'Diversos' });
  });
  return { itens: saida, redirecionados };
}

// A senha nunca vem de um arquivo do repositório -- só de variável de
// ambiente, lida na hora do build e descartada depois (mesmo raciocínio de
// tools/orcamento/build-dashboard.js: dist/planejamento-semanal.html também
// vai pra um GitHub Pages público).
function build({ outPath, today = new Date(), senha = process.env.ORCAMENTO_SENHA } = {}) {
  if (!senha) {
    throw new Error('Defina a variável de ambiente ORCAMENTO_SENHA antes de rodar o build (a senha nunca fica em um arquivo do repositório).');
  }

  const grid = readXlsxSheet(config.caminhoArquivo, config.nomeAba);
  const registros = parseMatriz(grid);

  // Os 12 meses da MATRIZ, como datas -- MESMA derivação de
  // tools/orcamento/build-dashboard.js. renderSemanal precisa deles para
  // calcularVigenteIdx (tools/comum/datas.js) saber se 'today' está dentro,
  // antes ou depois do ano da planilha, em vez de assumir ano corrente.
  const columns = locateColumns(grid);
  const headerRow = grid[1];
  const periodos = columns.equipesMeses.map(col => excelSerialParaData(headerRow[col]));

  const gridLinhaBase = readXlsxSheet(config.caminhoLinhaBase, config.nomeAbaLinhaBase);
  const { porChave } = parseBaseline(gridLinhaBase);
  const baseline = baselineParaCliente(porChave, registros);

  // Terceira fonte desta página, e a única de EXECUÇÃO (uma linha por furo).
  // Falha com o caminho na mensagem em vez de deixar vazar um ENOENT cru: um
  // caminho errado em cache já travou uma sessão inteira neste projeto (ver
  // CLAUDE.md, item da aba Gerencial).
  let gridAvancos;
  try {
    gridAvancos = readXlsxSheet(configDemandas.caminhoArquivo, configDemandas.nomeAba);
  } catch (err) {
    throw new Error(`Não consegui ler a aba "${configDemandas.nomeAba}" de ${configDemandas.caminhoArquivo} (o Google Drive está montado em G:?). Erro original: ${err.message}`);
  }
  const { furos: furosLidos, descartadas, semDataTermino, cancelamentoIlegivel, deslocamentos } = parseAvancos(gridAvancos);

  // Quarta fonte desta página: ensaios de laboratório JÁ CONCLUÍDOS (aba
  // "Lab Concluido", mesmo workbook de Avanços -- ver config-lab.js).
  // Alimenta só Realizado/Tendência de LAB.C/LAB.E na Tabela Semanal, nunca
  // a aba Demandas nem Demandas Pendentes (ver o comentário em
  // computeDemandas, compute-demandas.js). Mesmo tratamento de erro de
  // caminho que Avanços -- ver o comentário logo acima.
  let gridLab;
  try {
    gridLab = readXlsxSheet(configLab.caminhoArquivo, configLab.nomeAba);
  } catch (err) {
    throw new Error(`Não consegui ler a aba "${configLab.nomeAba}" de ${configLab.caminhoArquivo} (o Google Drive está montado em G:?). Erro original: ${err.message}`);
  }
  const { ensaios: ensaiosLidos, descartadas: ensaiosDescartados } = parseLab(gridLab);
  const { itens: ensaios, redirecionados: ensaiosRedirecionados } = redirecionarSupsDesconhecidos(ensaiosLidos, registros);
  console.log(`Lab: ${ensaiosLidos.length} ensaio(s) lido(s), ${ensaiosDescartados} linha(s) descartada(s) (lixo "TESTE" ou vazia), ${ensaiosRedirecionados} ensaio(s) redirecionado(s) pra "Diversos" (SUP sem registro LAB.C/LAB.E na MATRIZ).`);

  // Mesmo redirecionamento aplicado aos furos de Sondagem/Avanços -- ver o
  // comentário de redirecionarSupsDesconhecidos acima. Usa furosLidos (não
  // redirecionado) pra reconciliarSups logo abaixo: o relatório de
  // desencontro de SUP existe pra dar visibilidade de quais SUPs reais a
  // MATRIZ não conhece, e "Diversos" mascararia isso (ele SEMPRE existe na
  // MATRIZ, então apareceria como "SUP conhecido" no relatório).
  const { itens: furos, redirecionados: furosRedirecionados } = redirecionarSupsDesconhecidos(furosLidos, registros);
  const demandas = computeDemandas(furos, periodos, ensaios);
  console.log(`Demandas: ${furosLidos.length} furos lidos, ${descartadas} linha(s) vazia(s) descartada(s), ${deslocamentos} linha(s) de "deslocamento" descartada(s) (furo impenetrável reposicionado, não é demanda nova), ${furosRedirecionados} furo(s) redirecionado(s) pra "Diversos" (SUP sem registro na MATRIZ pra aquela tipologia), ${semDataTermino} furo(s) concluído(s) sem data de término (nunca saem do estoque), ${cancelamentoIlegivel} cancelada(s) sem data legível (ficam no estoque).`);

  // Relatório dos DOIS lados do desencontro de SUP, com os furos ORIGINAIS
  // (furosLidos, não redirecionados -- ver o comentário acima). Nada é
  // descartado -- isto é só visibilidade, e existe porque silenciar o que
  // não casa foi o Critical da Fase 1 (ver tools/comum/linha-base.js).
  const sups = reconciliarSups(furosLidos, registros);
  console.log(`Demandas/SUP: ${sups.furosSemSupNaMatriz} furo(s) em ${sups.soNoAvancos.length} SUP(s) que a MATRIZ não tem (${sups.soNoAvancos.join(', ') || 'nenhum'}); ${sups.soNaMatriz.length} SUP(s) da MATRIZ sem nenhum furo (${sups.soNaMatriz.join(', ') || 'nenhum'}).`);

  const html = renderSemanal({
    registros, baseline, demandas, periodos, senha, geradoEm: today,
    logoDataUri: loadDataUri(LOGO_PATH), iconDataUri: loadDataUri(ICON_PATH),
  });

  const resolvedOutPath = outPath || path.join(__dirname, '..', '..', 'dist', 'planejamento-semanal.html');
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

module.exports = { build, baselineParaCliente, redirecionarSupsDesconhecidos };
