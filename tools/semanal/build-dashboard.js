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
const { renderAlocacaoPagina } = require('./render-alocacao-pagina.js');
const { excelSerialParaData } = require('../comum/datas.js');
const { reconciliarLinhaBase, chaveMatriz } = require('../comum/linha-base.js');
const config = require('../orcamento/config.js');
const { parseAvancos } = require('./parse-avancos.js');
const { parseCsvGrid } = require('./parse-matriz-cliente.js');
const { parseLab } = require('./parse-lab.js');
const { computeDemandas, reconciliarSups, redirecionarSupsDesconhecidos, resolverSupConhecido } = require('./compute-demandas.js');
const { parseAbaEq, agregarEquipesAtivas, mesDaAbaEq } = require('./compute-equipes-ativas.js');
const { agregarEquipesRealizadoAlocado } = require('./compute-equipes-realizado-alocado.js');
const { agregarEquipesNaoProdutivas } = require('./compute-equipes-nao-produtivas.js');
const { rotularTipologia } = require('../comum/tipologias-avancos.js');
const { resolverCoordenadasPorSup } = require('./coordenadas-sup.js');
const configDemandas = require('./config-demandas.js');
const { lerAvisoAtualizacaoVolume, ultimaAtualizacaoOkIso } = require('./coordenacao-volume.js');

// Mesmo logo/avatar do orçamento (tools/orcamento/build-dashboard.js) --
// mesmos arquivos em assets/, mesma função de carregar, duplicada aqui de
// propósito (Node-only, 2 chamadores só, não vale um módulo comum novo pra
// isso). Ausência do arquivo não quebra o build -- loadDataUri devolve
// undefined, e renderSemanal trata isso como "sem logo/sem marca d'água".
const LOGO_PATH = path.join(__dirname, '..', '..', 'assets', 'logo-suporte-infra-negativo.png');
const ICON_PATH = path.join(__dirname, '..', '..', 'assets', 'logo-alvo.png');

// Assets da marca Suporte Infra pra aba Mapa (fonte Nimbus Sans Extd + textura de
// fundo), tirados do site ao vivo do projeto irmão "Mapa Sondagens" -- mesma marca.
// Mesmo padrão de ausência não quebra o build (loadDataUri devolve undefined).
const NIMBUS_REGULAR_PATH = path.join(__dirname, '..', '..', 'assets', 'mapa-alocacao', 'nimbus-sans-extd.otf');
const NIMBUS_BLACK_PATH = path.join(__dirname, '..', '..', 'assets', 'mapa-alocacao', 'nimbus-sans-extd-black.otf');
const TEXTURA_MAPA_PATH = path.join(__dirname, '..', '..', 'assets', 'mapa-alocacao', 'textura-fundo.png');

// mime (opcional, achado 6 da revisão final): antes hardcoded 'image/png'
// pra QUALQUER arquivo, inclusive os dois .otf da Nimbus Sans Extd -- os
// navegadores ignoram o MIME de uma data URI dentro de @font-face quando o
// format() está presente (é o caso aqui, ver cssFontesMapa), então isso
// provavelmente já funcionava, mas "provavelmente, nunca verificado" não é
// bom o bastante pra um data URI que ninguém confere byte a byte depois do
// build. Default 'image/png' preserva todo call site existente sem mudança.
function loadDataUri(filePath, mime) {
  if (!fs.existsSync(filePath)) return undefined;
  const buf = fs.readFileSync(filePath);
  return `data:${mime || 'image/png'};base64,${buf.toString('base64')}`;
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

// Roster publicado por atualizar-equipes-online.js (dist/equipes-roster-online.csv),
// cabeçalho CABECALHO_ROSTER em atualizar-equipes-online.js
// ("IdEquipe,DiaEpoch,Estado,NoDefault,Os,Nome,Servicos") -- só as 3
// primeiras colunas interessam aqui (agregarEquipesRealizadoAlocado só lê
// idEquipe/diaEpoch/estado); as 4 seguintes existem para outros consumidores
// (nenhum neste módulo) e são ignoradas por posição, não por nome -- mesmo
// parser posicional simples que o resto do projeto usa pra CSV plano.
function parseRosterOnlineCsvBruto(csvTexto) {
  const linhas = (csvTexto || '').trim().split('\n').slice(1);
  const saida = [];
  for (const linha of linhas) {
    if (!linha) continue;
    const partes = linha.split(',');
    const dia = Number(partes[1]);
    if (!Number.isFinite(dia)) continue;
    saida.push({ idEquipe: partes[0], diaEpoch: dia, estado: partes[2] });
  }
  return saida;
}

// Produção publicada por atualizar-equipes-online.js (dist/equipes-online.csv),
// cru desde 2026-08-10: "IdEquipe,SUP,Tipo,DiaEpoch" -- substitui o antigo
// pré-agregado "SUP,Tipo,DiaEpoch,Fracao" (a fração agora é calculada no
// cruzamento com o roster, ver montarEquipesRealizado abaixo).
//
// UltimaFotoEpoch (2026-08-28, coluna [4]): decide, dentro do MESMO dia,
// qual sessão (SUP) de uma equipe foi a mais recente -- ver
// equipes-alocaveis.js (indexarProducaoOnline/ultimoRealizadoAte). Ausente
// num CSV de um build anterior a esta mudança (só 4 colunas): partes[4] é
// undefined, Number(undefined) é NaN, e ultimaFotoEpoch sai undefined --
// indexarProducaoOnline já trata isso como 0 (fallback), sem lançar. Nunca
// use lerLinhasComCabecalho aqui: este parser sempre foi posicional/sem
// trava de formato (diferente do fetcher), de propósito -- é o único jeito
// de um CSV de 4 colunas continuar legível depois desta mudança.
function parseProducaoOnlineCsv(csvTexto) {
  const linhas = (csvTexto || '').trim().split('\n').slice(1);
  const saida = [];
  for (const linha of linhas) {
    if (!linha) continue;
    const partes = linha.split(',');
    const dia = Number(partes[3]);
    if (!Number.isFinite(dia)) continue;
    const ultimaFotoEpoch = Number(partes[4]);
    saida.push({
      idEquipe: partes[0], sup: partes[1], tipo: partes[2], diaEpoch: dia,
      ultimaFotoEpoch: Number.isFinite(ultimaFotoEpoch) ? ultimaFotoEpoch : undefined,
    });
  }
  return saida;
}

// Substitui parseEquipesFracaoCsv (aposentada em 2026-08-10, recuperação de
// branch em 2026-08-11 -- ver
// docs/superpowers/specs/2026-08-10-equipes-realizado-roster-link6-link7-design.md
// e docs/superpowers/plans/2026-08-10-equipes-realizado-roster-link6-link7.md).
// Cruza roster (Link 6) + produção crua (Link 7) via
// agregarEquipesRealizadoAlocado (compute-equipes-realizado-alocado.js, com
// carry-forward de 45 dias) e resolve o SUP de cada linha de produção contra
// a MATRIZ (resolverSupConhecido) -- mesmo redirecionamento pra "Diversos"
// que furos/ensaios já levam. Extraída como função pura (mesmo espírito da
// antecessora) pra ser testável sem tocar em fs/path/MATRIZ real -- ver
// test/semanal-build-dashboard-fontes-novas.test.js.
//
// Devolve { equipesPorDia: null, ativos, foraDaJanela } quando o cruzamento
// não produz nenhum par utilizável -- build() decide manter a fonte de
// reserva (ativas/mobilizadas) nesse caso.
function montarEquipesRealizado({ rosterCsv, producaoCsv, registros }) {
  const roster = parseRosterOnlineCsvBruto(rosterCsv);
  const producao = parseProducaoOnlineCsv(producaoCsv);
  const resultado = agregarEquipesRealizadoAlocado({ roster, producao });
  if (!Object.keys(resultado.porDia).length) {
    return { equipesPorDia: null, ativos: resultado.ativos, foraDaJanela: resultado.foraDaJanela };
  }
  // resolverSup construída UMA VEZ fora do loop -- mesmo achado da revisão
  // final de branch, 2026-08-08 (ver o comentário simétrico na antecessora).
  const resolverSup = resolverSupConhecido(registros || []);
  const porDiaResolvido = {};
  for (const [chave, mapa] of Object.entries(resultado.porDia)) {
    const [sup, tipo] = chave.split('||');
    const chaveResolvida = resolverSup(sup, tipo) + '||' + tipo;
    if (!porDiaResolvido[chaveResolvida]) porDiaResolvido[chaveResolvida] = {};
    for (const [dia, fracao] of Object.entries(mapa)) {
      porDiaResolvido[chaveResolvida][dia] = (porDiaResolvido[chaveResolvida][dia] || 0) + fracao;
    }
  }
  return { equipesPorDia: porDiaResolvido, ativos: resultado.ativos, foraDaJanela: resultado.foraDaJanela };
}


// A senha nunca vem de um arquivo do repositório -- só de variável de
// ambiente, lida na hora do build e descartada depois (mesmo raciocínio de
// tools/orcamento/build-dashboard.js: dist/planejamento-semanal.html também
// vai pra um GitHub Pages público).
// Sheet espelho da aba EQ da planilha de equipes, publicada como CSV em
// 2026-08-03. O gid é fixo para sempre: quem resolve qual aba mensal copiar é
// o Apps Script (tools/semanal/apps-script-espelho-eq.gs), a cada 30 min.
const URL_ESPELHO_EQ = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ7SaAZI8VwQaZD0nPxtOyw56b1XmKfqDTC6qSkj-1PAQr4A8ihTY4vZCOhF4PuMNIYm_-hN_CNdNrX/pub?gid=199381651&single=true&output=csv';

// Aba PESSOAS da MESMA planilha de equipes (fileId 1Mgj87eSKMO4Gh2aHQWChNl5YC
// H2vatMDC2fCNuxB8TU -- igual ao tools/matriz/config.js do repositório-mãe,
// que já parseia esta aba pra outro dashboard). Decide, desde 2026-08-27,
// QUEM aparece no quadro da Alocação Equipes -- coluna ATV=TRUE (checkbox
// manual, coluna B). Diferente da espelho de EQ acima, PESSOAS é uma aba
// ÚNICA (não muda de gid todo mês) e já está compartilhada com "qualquer um
// com o link pode ver" -- dá pra ler o /export direto, sem Apps Script
// espelhando nada.
const URL_PESSOAS = 'https://docs.google.com/spreadsheets/d/1Mgj87eSKMO4Gh2aHQWChNl5YCH2vatMDC2fCNuxB8TU/export?format=csv&gid=1744884054';

async function buscarPessoasAtivas() {
  try {
    const resposta = await fetch(URL_PESSOAS, { redirect: 'follow' });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    return await resposta.text();
  } catch (err) {
    console.warn(`Equipes ativas (PESSOAS): não consegui ler a aba (${err.message}). O quadro da Alocação Equipes segue sem o filtro de ativas -- ninguém sai por causa disso.`);
    return null;
  }
}

// Busca a espelho. NUNCA derruba o build: esta é a única fonte do projeto que
// vem por rede, e o dashboard inteiro (Tabela, Gráficos, Demandas, e o próprio
// Balanço em volume/financeiro) continua correto sem ela. Falhou, o Δ equipes
// fica sem dado e a página avisa -- decisão do dono do projeto: "ficar sem dado
// e avisar", nunca cair calado numa métrica diferente.
async function buscarEspelhoEq() {
  try {
    const resposta = await fetch(URL_ESPELHO_EQ, { redirect: 'follow' });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    return await resposta.text();
  } catch (err) {
    console.warn(`Equipes ativas: não consegui ler a Sheet espelho da aba EQ (${err.message}). O Δ equipes vai ficar sem dado, com aviso na página.`);
    return null;
  }
}

// furos (do Avanço Sond) + csv da espelho -> o que o cliente precisa para o
// Δ equipes ATIVAS. Devolve equipesPorDia (substituindo as mobilizadas) e
// equipesPeriodo -- o {ano, mes} que a espelho cobre, que é o que a página usa
// para saber se pode mostrar a barra no mês escolhido.
//
// O campo se chama equipesPeriodo (e não equipesAtivasPeriodo) desde 2026-08-05:
// ele descreve a cobertura de QUALQUER fonte que tenha vencido a disputa por
// equipesPorDia, e quem o lê (foraDaCoberturaDeEquipes, compute-balanco.js) não
// pode se importar com qual foi. Ver o comentário longo lá.
function montarEquipesAtivas(furos, csvEspelho) {
  // tipologiaPorSondador só depende de 'furos' -- por isso é calculada ANTES
  // das duas saídas antecipadas abaixo (sem csvEspelho/período reconhecível),
  // e vai em TODA saída desta função. build() precisa dele fora daqui também
  // (equipes PRODUTIVAS, a fonte online que vira a prioridade #1 do Δ
  // equipes -- ver o bloco logo depois da chamada a montarEquipesAtivas em
  // build()), e antes ele era uma variável local presa a este escopo.
  //
  // OS -> SUP, e sondador -> tipologia mais frequente dos furos dele (é o que
  // desempata as equipes com Serviços múltiplo, tipo "ST | PI | BL").
  const osParaSup = {};
  const contagem = {};
  furos.forEach((f) => {
    if (f.os && f.sup && !osParaSup[f.os]) osParaSup[f.os] = f.sup;
    if (f.sondador && f.tipologia) {
      const chave = `${f.sondador}||${f.tipologia}`;
      contagem[chave] = (contagem[chave] || 0) + 1;
    }
  });
  const melhor = {};
  Object.keys(contagem).forEach((chave) => {
    const [sondador, tipologia] = chave.split('||');
    if (!melhor[sondador] || contagem[chave] > melhor[sondador].n) {
      melhor[sondador] = { tipologia, n: contagem[chave] };
    }
  });
  const tipologiaPorSondador = {};
  Object.keys(melhor).forEach((s) => { tipologiaPorSondador[s] = melhor[s].tipologia; });

  // equipesCsv viaja para o cliente porque a aba Alocação Equipes recomputa o
  // roster a cada troca de SEMANA (disponibilidade e última OS mudam com ela),
  // e a semana muda sem novo build. São ~119 linhas -- cabe folgado no payload.
  // null, e não '', quando não há espelho: string vazia parseia para "zero
  // equipes", indistinguível de "a planilha está vazia". osParaSup segue a
  // mesma regra: só viaja junto do CSV que ele ajudaria a interpretar.
  if (!csvEspelho) return { equipesPeriodo: null, tipologiaPorSondador, equipesCsv: null, osParaSup: null };

  const periodo = mesDaAbaEq(csvEspelho);
  if (!periodo) {
    console.warn('Equipes ativas: a espelho não trouxe cabeçalho de data reconhecível -- Δ equipes fica sem dado.');
    // Sem {ano, mes} o cliente não sabe a que mês os dias do CSV pertencem --
    // um roster sem calendário é pior que nenhum, então também vai null aqui.
    return { equipesPeriodo: null, tipologiaPorSondador, equipesCsv: null, osParaSup: null };
  }

  const equipes = parseAbaEq(csvEspelho);
  const r = agregarEquipesAtivas({
    equipes, osParaSup, tipologiaPorSondador,
    nomesSondadores: Object.keys(tipologiaPorSondador),
    rotularTipologia: rotularTipologia,
    ano: periodo.ano, mes: periodo.mes,
  });

  const ativos = r.diasPorEstado.mobilizada + r.diasPorEstado.campoSemFuro;
  const apropriados = Object.keys(r.porDia)
    .reduce((total, chave) => total + Object.values(r.porDia[chave]).reduce((a, b) => a + b, 0), 0);
  console.log(
    `Equipes ATIVAS (${String(periodo.mes).padStart(2, '0')}/${periodo.ano}): ${ativos} equipe-dia ativos `
    + `(${r.diasPorEstado.mobilizada} mobilizada + ${r.diasPorEstado.campoSemFuro} em campo sem furo), `
    + `${apropriados} apropriados a um par (SUP, tipologia); `
    + `${r.naoApropriadas} sem OS no mês e ${r.semTipologia} sem tipologia ficam fora. `
    + `Fora da conta: ${r.diasPorEstado.fora} férias/baixada, ${r.diasPorEstado.naoEquipe} não-equipe.`
  );
  const textosNovos = Object.keys(r.textosNoDefault);
  if (textosNovos.length) {
    const amostra = textosNovos.slice(0, 5).map((t) => JSON.stringify(t.slice(0, 30))).join(', ');
    console.log(`Equipes ATIVAS: ${textosNovos.length} texto(s) de dia não catalogados entraram como "em campo" pelo default -- revise se algum for ausência: ${amostra}${textosNovos.length > 5 ? ' ...' : ''}`);
  }

  // osParaSup viaja para o cliente pelo MESMO motivo de equipesCsv (comentário
  // acima): a aba Alocação Equipes usa este mapa (equipesDoQuadro,
  // tools/semanal/equipes-alocaveis.js) para achar supRealizado/colunaRealizada
  // a partir da última OS vista nos furos -- sem ele "Repor o realizado" não
  // tem o que semear. Medido: ~1.960 entradas, negligenciável no payload.
  return { equipesPorDia: r.porDia, equipesPeriodo: periodo, tipologiaPorSondador, equipesCsv: csvEspelho, osParaSup };
}

// Todo o LEVANTAMENTO de dados do build, sem senha e sem escrever nada em
// disco: MATRIZ + linha de base + as fontes online já baixadas em dist/,
// terminando em { registros, demandas } -- o mesmo par que o cliente recebe
// como window.__REGISTROS__/window.__DEMANDAS__.
//
// Extraída de dentro de build() em 2026-08-31 para o CLI de congelamento
// (tools/semanal/congelar-tendencia-semanal.js) poder recalcular a tendência
// da semana alvo a partir EXATAMENTE do mesmo dado que a página publicada
// mostra, sem cifrar nem renderizar HTML nenhum. build() continua fazendo o
// que fazia -- só chama esta função no lugar do trecho que foi cortado.
//
// periodos/baseline vêm no mesmo retorno porque build() precisa dos dois logo
// em seguida e recomputá-los custaria reler as duas planilhas; quem só quer o
// par do CLI simplesmente ignora os dois campos extras.
async function montarRegistrosEDemandas() {
  const equipesAtivasCsv = await buscarEspelhoEq();
  const pessoasAtivasCsv = await buscarPessoasAtivas();

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
  // Fonte online (2026-08-05): substitui o Avanço Sond.xlsx local por um CSV
  // combinado dos exports de cada contrato ativo, gerado por
  // tools/semanal/atualizar-avancos-online.js (roda à parte, não a cada
  // build -- ver docs/superpowers/specs/2026-08-05-avancos-online-design.md).
  // O unshift(null) reproduz a mesma diferença de indexação que
  // gridCsvComoXlsx() já trata no navegador (live-refresh.js): o CSV
  // combinado tem cabeçalho na linha 0, mas parseAvancos espera cabeçalho em
  // grid[1] (o formato do .xlsx original, que tem uma linha em branco antes).
  const CAMINHO_AVANCOS_ONLINE = path.join(__dirname, '..', '..', 'dist', 'avancos-online.csv');
  const CAMINHO_DEMANDAS_SONDAGEM_ONLINE = path.join(__dirname, '..', '..', 'dist', 'demandas-sondagem-online.csv');
  let gridAvancos;
  try {
    const csvTexto = fs.readFileSync(CAMINHO_AVANCOS_ONLINE, 'utf8');
    gridAvancos = parseCsvGrid(csvTexto);
  } catch (err) {
    throw new Error(
      `Não consegui ler ${CAMINHO_AVANCOS_ONLINE}. Rode ` +
      `"node tools/semanal/atualizar-avancos-online.js" primeiro (precisa do Chrome ` +
      `aberto com --remote-debugging-port=9222, logado em sond.com.br). Erro original: ${err.message}`
    );
  }
  // Demandas pendentes de sondagem (Link 2 + 3) são OPCIONAIS: sem o arquivo,
  // o build continua com Realizado normal, só sem os furos ainda não
  // executados no estoque de Demandas -- mesmo espírito de robustez que
  // equipes-online.csv já tem (ver mais abaixo).
  // Coordenadas por SUP (aba Mapa da Alocação Equipes, 2026-08-26).
  //
  // CADA grid é resolvido com o PRÓPRIO cabeçalho, nunca com o do outro. Os
  // dois arquivos NÃO andam em lockstep: as coordenadas nasceram só no Link 2
  // (pendentes), e o Link 1 (avanços) só ganha as colunas quando alguém
  // rerraspar o histórico inteiro -- o que pode demorar dias. Resolver o grid
  // COMBINADO pelo cabeçalho do primeiro (que é o do avanços) devolvia {} em
  // silêncio, com 5.724 coordenadas presentes no arquivo de pendentes e
  // invisíveis: zero pino no mapa, sem erro nenhum. É o mesmo modo de falha
  // que o CLAUDE.md descreve para o cache ("o combinador usa o cabeçalho do
  // PRIMEIRO grid para todos").
  //
  // A ordem do merge importa: o avanços entra por último e SOBRESCREVE o
  // pendente do mesmo SUP -- furo já executado tem coordenada mais confiável
  // que furo ainda por executar. Hoje o avanços não traz nenhuma, então na
  // prática vence o pendente; quando ele passar a trazer, a preferência já
  // está no lugar certo.
  let coordenadasPorSup = {};
  if (fs.existsSync(CAMINHO_DEMANDAS_SONDAGEM_ONLINE)) {
    const gridPendentes = parseCsvGrid(fs.readFileSync(CAMINHO_DEMANDAS_SONDAGEM_ONLINE, 'utf8'));
    coordenadasPorSup = resolverCoordenadasPorSup(gridPendentes[0], gridPendentes.slice(1));
    // Só as linhas de dado (índice 1 em diante) entram no grid combinado. O
    // cabeçalho do pendentes pode ter colunas a MAIS no fim (Latitude/
    // Longitude) -- inofensivo para parseAvancos, que resolve por NOME a
    // partir do cabeçalho do avanços e simplesmente ignora as sobrando.
    for (let i = 1; i < gridPendentes.length; i++) gridAvancos.push(gridPendentes[i]);
  } else {
    console.warn(`AVISO: ${CAMINHO_DEMANDAS_SONDAGEM_ONLINE} não encontrado -- Demandas Pendentes de sondagem não inclui furos ainda não executados. Rode "node tools/semanal/atualizar-demandas-sondagem-online.js".`);
  }
  Object.assign(coordenadasPorSup, resolverCoordenadasPorSup(gridAvancos[0], gridAvancos.slice(1)));
  console.log(`Coordenadas: ${Object.keys(coordenadasPorSup).length} SUP(s) com lat/long -- a aba Mapa desenha um pino por SUP resolvido; o resto vai pro painel "sem localização".`);
  gridAvancos.unshift(null);
  const { furos: furosLidos, descartadas, semDataTermino, cancelamentoIlegivel, deslocamentos } = parseAvancos(gridAvancos);

  // Quarta fonte desta página: ensaios de laboratório REALIZADOS. Alimenta só
  // Realizado/Tendência de LAB.C/LAB.E na Tabela Semanal, nunca a aba Demandas
  // nem Demandas Pendentes (ver o comentário em computeDemandas,
  // compute-demandas.js). Mesmo tratamento de erro de caminho que Avanços --
  // ver o comentário logo acima.
  //
  // Fonte online (2026-08-05): APOSENTOU a aba "Lab Concluido" do
  // `Avanço Sond.xlsx` local (coluna "Concluído Dia") em favor de um CSV de
  // ensaios REALIZADOS (coluna "Ensaiado Dia"), gerado por
  // tools/semanal/atualizar-lab-online.js -- roda à parte, não a cada build. A
  // aba local não tem mais NENHUM consumidor no repositório (o config e o teste
  // de planilha real dela foram removidos em 2026-08-05: parseLab exige
  // "Ensaiado Dia", que aquela aba nunca teve e nunca vai ter). Mesmo
  // unshift(null) de Avanços -- ver
  // docs/superpowers/specs/2026-08-05-lab-e-equipes-online-design.md.
  const CAMINHO_LAB_ONLINE = path.join(__dirname, '..', '..', 'dist', 'lab-online.csv');
  let gridLab;
  try {
    const csvTexto = fs.readFileSync(CAMINHO_LAB_ONLINE, 'utf8');
    gridLab = parseCsvGrid(csvTexto);
    gridLab.unshift(null);
  } catch (err) {
    throw new Error(
      `Não consegui ler ${CAMINHO_LAB_ONLINE}. Rode "node tools/semanal/atualizar-lab-online.js" ` +
      `primeiro (precisa do Chrome aberto com --remote-debugging-port=9222, logado em sond.com.br). ` +
      `Erro original: ${err.message}`
    );
  }
  const { ensaios: ensaiosLidos, descartadas: ensaiosDescartados } = parseLab(gridLab);

  // Demandas de lab pendentes (Link 4 + 5): ensaios ainda não realizados,
  // juntados aos REALIZADOS (ensaiosLidos) antes do redirecionamento de SUP
  // desconhecido -- mesmo espírito de robustez que Demandas de sondagem
  // (opcional via fs.existsSync, ver acima). 'concluido: null' marca cada
  // pendente como ainda não concluído pro mesmo formato que parseLab produz.
  const CAMINHO_DEMANDAS_LAB_ONLINE = path.join(__dirname, '..', '..', 'dist', 'demandas-lab-online.json');
  let ensaiosComPendentes = ensaiosLidos;
  if (fs.existsSync(CAMINHO_DEMANDAS_LAB_ONLINE)) {
    const pendentesLab = JSON.parse(fs.readFileSync(CAMINHO_DEMANDAS_LAB_ONLINE, 'utf8'))
      .map((e) => ({ ...e, criacao: e.criacao ? new Date(e.criacao) : null, concluido: null }));
    ensaiosComPendentes = ensaiosLidos.concat(pendentesLab);
    console.log(`Demandas de lab: ${pendentesLab.length} ensaio(s) pendente(s) incluído(s).`);
  } else {
    console.warn(`AVISO: ${CAMINHO_DEMANDAS_LAB_ONLINE} não encontrado -- Demandas Pendentes de LAB.C/LAB.E não inclui backlog. Rode "node tools/semanal/atualizar-demandas-lab-online.js".`);
  }

  const { itens: ensaios, redirecionados: ensaiosRedirecionados } = redirecionarSupsDesconhecidos(ensaiosComPendentes, registros);
  console.log(`Lab: ${ensaiosLidos.length} ensaio(s) lido(s), ${ensaiosDescartados} linha(s) descartada(s) (lixo "TESTE" ou vazia), ${ensaiosRedirecionados} ensaio(s) redirecionado(s) pra "Diversos" (SUP sem registro LAB.C/LAB.E na MATRIZ).`);

  // Mesmo redirecionamento aplicado aos furos de Sondagem/Avanços -- ver o
  // comentário de redirecionarSupsDesconhecidos acima. Usa furosLidos (não
  // redirecionado) pra reconciliarSups logo abaixo: o relatório de
  // desencontro de SUP existe pra dar visibilidade de quais SUPs reais a
  // MATRIZ não conhece, e "Diversos" mascararia isso (ele SEMPRE existe na
  // MATRIZ, então apareceria como "SUP conhecido" no relatório).
  const { itens: furos, redirecionados: furosRedirecionados } = redirecionarSupsDesconhecidos(furosLidos, registros);
  const demandas = computeDemandas(furos, periodos, ensaios);
  demandas.coordenadasPorSup = coordenadasPorSup;
  // Equipes Realizado: 1 origem só (2026-08-21) -- roster (Link 6) + produção
  // (Link 7) online, bloco "Δ equipes REALIZADO" logo abaixo. Até aqui havia
  // uma cascata de 3 fontes (mobilizadas via Sondador do Avanço Sond ->
  // ATIVAS via Sheet espelho da aba EQ -> REALIZADO via Link 6+7), e nenhuma
  // delas avisava na tela qual tinha vencido -- decisão do dono do projeto:
  // sem Link 6+7, a célula fica "sem dado" (nunca troca de fonte em
  // silêncio), mesma filosofia que o projeto já aplica a Demandas Pendentes.
  // 'mobilizadas (Avanço Sond)' (compute-equipes-mobilizadas.js) saiu de uso
  // aqui -- ver o histórico da mudança se precisar recuperar essa fonte.
  demandas.equipesPeriodo = null;
  let fonteEquipes = 'sem dado';
  // equipesCsv/osParaSup (Sheet espelho da aba EQ) continuam sendo buscados:
  // a aba Alocação Equipes precisa deles (quadro de roster, popup de cada
  // equipe, Equipes não-produtivas mais abaixo) -- só equipesPorDia
  // (Realizado) parou de vir daqui. tipologiaPorSondador desestruturado À
  // PARTE (nunca entra em 'demandas') porque 'demandas' é JSON.stringify'd
  // por inteiro pro blob cifrado do HTML -- ver renderSemanal() mais abaixo;
  // equipesPorDia sai fora do Object.assign pelo mesmo motivo prático:
  // reservado exclusivamente para o bloco REALIZADO (Link 6+7) logo abaixo.
  //
  // equipesPeriodo TAMBÉM sai fora e vira 'equipesRosterPeriodo' -- achado
  // ao revisar esta mudança: compute-balanco.js usa demandas.equipesPeriodo
  // pra decidir foraDaCoberturaDeEquipes (se o mês selecionado está DENTRO
  // do que equipesPorDia cobre), e a aba Alocação usa o MESMO campo pra
  // decidir se o roster da Sheet EQ é do mês em tela (somenteLeitura). Os
  // dois sentidos coincidiam enquanto ATIVAS era fonte de equipesPorDia --
  // agora que só o Link 6+7 alimenta o Realizado (sempre 'sem restrição de
  // mês', period null), manter os dois no mesmo campo faria o Balanço LER
  // cobertura da Sheet EQ para um dado que não vem mais dela. Alocação passa
  // a ler 'equipesRosterPeriodo'; Balanço continua em 'equipesPeriodo',
  // agora sempre null (nunca mais restringido por mês, e nunca aliás
  // 'errado' quando faltar Link 6+7 -- ver o comentário 20 linhas abaixo).
  const {
    tipologiaPorSondador: _tipologiaPorSondador,
    equipesPorDia: _equipesAtivasPorDia,
    equipesPeriodo: equipesRosterPeriodo,
    ...resultadoEquipesAtivas
  } = montarEquipesAtivas(furos, equipesAtivasCsv);
  Object.assign(demandas, resultadoEquipesAtivas);
  demandas.equipesRosterPeriodo = equipesRosterPeriodo;
  // pessoasCsv viaja para o cliente pelo MESMO motivo de equipesCsv: a aba
  // Alocação Equipes recomputa equipesDoQuadro a cada troca de semana, e é lá
  // (não aqui) que o filtro de ATV=TRUE é aplicado -- ver equipes-alocaveis.js.
  // null quando a busca falha, nunca '' (mesma convenção de equipesCsv):
  // string vazia parsearia para "ninguém ativo", que apagaria o quadro
  // inteiro em vez de simplesmente não filtrar nada.
  demandas.pessoasCsv = pessoasAtivasCsv;

  // Δ equipes REALIZADO (2026-08-10, recuperado e reintegrado em 2026-08-11
  // depois de um git reset --hard ter descartado esta branch -- ver
  // docs/superpowers/specs/2026-08-10-equipes-realizado-roster-link6-link7-design.md
  // e docs/superpowers/plans/2026-08-10-equipes-realizado-roster-link6-link7.md).
  // Cruza roster (Link 6, dist/equipes-roster-online.csv, multi-mês) + produção
  // CRUA (Link 7, dist/equipes-online.csv, "IdEquipe,SUP,Tipo,DiaEpoch" desde
  // 2026-08-10) via montarEquipesRealizado, com carry-forward de 45 dias pra
  // quem está ativo mas não produziu no dia. Substitui a versão "PRODUTIVAS
  // (Link 7)" de 2026-08-09 (pré-agregada, "SUP,Tipo,DiaEpoch,Fracao" -- o
  // parser antigo, parseEquipesFracaoCsv, não serve mais porque o fetcher
  // mudou o formato do CSV). Continua sendo a PRIMEIRA prioridade pro Δ
  // equipes -- ativas (aba EQ, montarEquipesAtivas acima) e mobilizadas
  // (furos) continuam como reserva se qualquer um dos dois CSVs faltar ou não
  // produzir nenhum par utilizável.
  //
  // NOTA DE INTEGRAÇÃO (2026-08-11): a spec original mandava também aposentar
  // buscarEspelhoEq()/montarEquipesAtivas por completo, lendo Ativas/Não-
  // produtivas do mesmo equipes-roster-online.csv. Essa parte NÃO foi
  // reintegrada -- ela predata a aba Alocação Equipes (equipes-alocaveis.js),
  // que precisa do CSV CRU inteiro da Sheet espelho (Líderes, Habilitação,
  // Veículo, Equipamento, Tenda, Tomador, Sinalização -- colunas que
  // equipes-roster-online.csv nunca carregou, nem na versão de 7 colunas) pra
  // montar o quadro e o popup de cada equipe. buscarEspelhoEq/montarEquipesAtivas
  // continuam EXATAMENTE como estavam antes desta rodada: única fonte de
  // equipesCsv/osParaSup (consumidos pela aba Alocação) e fallback #2 de
  // equipesPorDia/equipesPeriodo (ATIVAS aba EQ), logo acima.
  const CAMINHO_PRODUCAO_ONLINE = path.join(__dirname, '..', '..', 'dist', 'equipes-online.csv');
  const CAMINHO_ROSTER_ONLINE = path.join(__dirname, '..', '..', 'dist', 'equipes-roster-online.csv');
  if (fs.existsSync(CAMINHO_PRODUCAO_ONLINE) && fs.existsSync(CAMINHO_ROSTER_ONLINE)) {
    const rosterCsv = fs.readFileSync(CAMINHO_ROSTER_ONLINE, 'utf8');
    const producaoCsv = fs.readFileSync(CAMINHO_PRODUCAO_ONLINE, 'utf8');
    // producaoOnline (2026-08-26) viaja pro cliente pelo MESMO motivo de
    // equipesCsv/osParaSup (comentário em montarEquipesAtivas, acima): a aba
    // Alocação Equipes usa esta produção crua do Link 7 (equipes-alocaveis.js)
    // para achar supRealizado/colunaRealizada -- ver
    // docs/superpowers/specs/2026-08-26-realizado-alocacao-via-producao-sond-design.md.
    // Independente do cruzamento abaixo (montarEquipesRealizado) ter sucesso
    // ou não -- Alocação e o Δ equipes REALIZADO da Tabela Semanal são
    // consumidores independentes do mesmo CSV.
    demandas.producaoOnline = parseProducaoOnlineCsv(producaoCsv);
    const { equipesPorDia, ativos, foraDaJanela } = montarEquipesRealizado({ rosterCsv, producaoCsv, registros });
    if (equipesPorDia) {
      demandas.equipesPorDia = equipesPorDia;
      // Roster cobre múltiplos meses (backfill anual) -- declarar um mês só
      // aqui apagaria o Δ equipes de todos os outros (mesmo raciocínio que
      // parseEquipesFracaoCsv já documentava pra equipesPeriodo).
      demandas.equipesPeriodo = null;
      fonteEquipes = 'REALIZADO (roster Link 6 + produção Link 7)';
      console.log(`Equipes REALIZADO: ${ativos} equipe-dia ativa(s), ${foraDaJanela} sem produção dentro de 45 dias (redistribuída(s) proporcionalmente entre os SUPs do mesmo dia; só ficam de fora nos dias em que NENHUMA equipe se alocou).`);
    } else {
      console.warn('Equipes REALIZADO: roster+produção não produziram nenhum par utilizável -- mantendo a fonte de reserva (ativas/mobilizadas).');
    }
  } else {
    console.warn(`Equipes REALIZADO: falta ${CAMINHO_PRODUCAO_ONLINE} ou ${CAMINHO_ROSTER_ONLINE} -- rode "node tools/semanal/atualizar-equipes-online.js". Sem fallback -- a Tabela Semanal fica sem dado de Equipes até o CSV existir (2026-08-21: fim da cascata de fontes, ver o comentário acima de 'fonteEquipes').`);
  }

  // 'equipesAtivoPorDia'/historico.json (retrato do dashboard Matriz, outro
  // projeto deste repositório-mãe) foi REMOVIDO em 2026-08-21: desde a troca
  // pra Realizado via roster+produção (Link 6+7, 2026-08-10) nenhum lugar do
  // render consumia mais esse campo -- só sobrava a chamada de rede e o
  // campo morto no payload. Se precisar recuperar, ver o histórico da
  // mudança e compute-equipes-ativo-matriz.js (module ainda existe, só não é
  // mais chamado daqui).

  // Equipes NÃO produtivas (2026-08-05): informação separada do Δ equipes,
  // nunca somada nele -- mesma fonte (aba EQ) que "ativas" já usa acima, sem
  // busca nova (reaproveita o MESMO equipesAtivasCsv já obtido).
  demandas.equipesNaoProdutivas = null;
  if (equipesAtivasCsv) {
    const periodoEq = mesDaAbaEq(equipesAtivasCsv);
    if (periodoEq) {
      const equipesEq = parseAbaEq(equipesAtivasCsv);
      demandas.equipesNaoProdutivas = agregarEquipesNaoProdutivas({ equipes: equipesEq, ano: periodoEq.ano, mes: periodoEq.mes }).porDiaPorMotivo;
    }
  }

  const paresComEquipe = Object.keys(demandas.equipesPorDia || {}).length;
  // Sondador vazio é esperado, não perda: PENDENTE e CANCELADO não têm quem
  // executou (medido em 2026-08-03: CONCLUIDO/EXECUTADO com ZERO vazios).
  // O que o build vigia é o contrário -- um furo EXECUTADO sem sondador seria
  // sinal de mudança na planilha, e aí a conta de equipes começaria a
  // subestimar em silêncio.
  const executadosSemSondador = furos.filter(
    (f) => !f.sondador && (f.status === 'CONCLUIDO' || f.status === 'EXECUTADO')
  ).length;
  const aviso = executadosSemSondador
    ? ` ATENÇÃO: ${executadosSemSondador} furo(s) CONCLUIDO/EXECUTADO sem Sondador -- estes ficam fora da conta de equipes.`
    : ' Todo furo executado tem Sondador (os vazios são PENDENTE/CANCELADO, que não ocupam equipe).';
  // "em uso" e não "mobilizada": desde 2026-08-03 este mapa pode ter vindo das
  // equipes ATIVAS (aba EQ) em vez das mobilizadas, e o log estava contando um
  // enquanto dizia o outro. Desde 2026-08-05 há TRÊS fontes possíveis, então
  // 'fonteEquipes' é atribuída em cada ramo que de fato troca equipesPorDia --
  // inferir a fonte de um campo aqui embaixo foi o que fez o log errar antes.
  const coberturaEquipes = demandas.equipesPeriodo
    ? `${String(demandas.equipesPeriodo.mes).padStart(2, '0')}/${demandas.equipesPeriodo.ano}`
    : 'ano inteiro (sem restrição de mês)';
  console.log(`Equipes: ${paresComEquipe} par(es) (SUP, tipologia) no mapa em uso -- fonte: ${fonteEquipes}, cobertura: ${coberturaEquipes}.${aviso}`);
  console.log(`Demandas: ${furosLidos.length} furos lidos, ${descartadas} linha(s) vazia(s) descartada(s), ${deslocamentos} linha(s) de "deslocamento" descartada(s) (furo impenetrável reposicionado, não é demanda nova), ${furosRedirecionados} furo(s) redirecionado(s) pra "Diversos" (SUP sem registro na MATRIZ pra aquela tipologia), ${semDataTermino} furo(s) concluído(s) sem data de término (nunca saem do estoque), ${cancelamentoIlegivel} cancelada(s) sem data legível (ficam no estoque).`);

  // Relatório dos DOIS lados do desencontro de SUP, com os furos ORIGINAIS
  // (furosLidos, não redirecionados -- ver o comentário acima). Nada é
  // descartado -- isto é só visibilidade, e existe porque silenciar o que
  // não casa foi o Critical da Fase 1 (ver tools/comum/linha-base.js).
  const sups = reconciliarSups(furosLidos, registros);
  console.log(`Demandas/SUP: ${sups.furosSemSupNaMatriz} furo(s) em ${sups.soNoAvancos.length} SUP(s) que a MATRIZ não tem (${sups.soNoAvancos.join(', ') || 'nenhum'}); ${sups.soNaMatriz.length} SUP(s) da MATRIZ sem nenhum furo (${sups.soNaMatriz.join(', ') || 'nenhum'}).`);

  return { registros, demandas, periodos, baseline };
}

// Snapshot de tendência congelada (2026-08-31), gravado pelo CLI
// tools/semanal/congelar-tendencia-semanal.js toda sexta 22h e versionado em
// docs/ (é servido pelo Pages junto com a página). OPCIONAL, mesmo padrão
// condicional de demandas-sondagem-online.csv: sem o arquivo o build roda
// normalmente e o global sai {} -- nunca undefined, senão o cliente teria de
// checar em cada leitura.
const CAMINHO_CONGELADO_SEMANAL = path.join(__dirname, '..', '..', 'docs', 'tendencia-congelada-semanal.json');
function lerCongeladoSemanal() {
  if (!fs.existsSync(CAMINHO_CONGELADO_SEMANAL)) return {};
  return JSON.parse(fs.readFileSync(CAMINHO_CONGELADO_SEMANAL, 'utf8'));
}

async function build({ outPath, today = new Date(), senha = process.env.ORCAMENTO_SENHA } = {}) {
  if (!senha) {
    throw new Error('Defina a variável de ambiente ORCAMENTO_SENHA antes de rodar o build (a senha nunca fica em um arquivo do repositório).');
  }

  const { registros, demandas, periodos, baseline } = await montarRegistrosEDemandas();

  const CAMINHO_HEARTBEAT_VOLUME = path.join(__dirname, '..', '..', 'dist', 'heartbeat-atualizacao-volume.csv');
  const avisoAtualizacao = lerAvisoAtualizacaoVolume(CAMINHO_HEARTBEAT_VOLUME);
  // Aviso "sem atualização hoje" (2026-08-21): ISO cru da última linha 'ok',
  // pro cliente decidir se está atrasado comparando com o próprio relógio --
  // ver o comentário em coordenacao-volume.js (ultimaAtualizacaoOkIso).
  const ultimaAtualizacaoOkIsoValor = ultimaAtualizacaoOkIso(CAMINHO_HEARTBEAT_VOLUME);

  const html = renderSemanal({
    registros, baseline, demandas, periodos, senha, geradoEm: today,
    logoDataUri: loadDataUri(LOGO_PATH), iconDataUri: loadDataUri(ICON_PATH),
    avisoAtualizacao, ultimaAtualizacaoOkIso: ultimaAtualizacaoOkIsoValor,
    congeladoSemanal: lerCongeladoSemanal(),
  });

  const resolvedOutPath = outPath || path.join(__dirname, '..', '..', 'dist', 'planejamento-semanal.html');
  fs.mkdirSync(path.dirname(resolvedOutPath), { recursive: true });
  fs.writeFileSync(resolvedOutPath, html, 'utf8');
  console.log(`Wrote ${html.length} bytes to ${resolvedOutPath}`);

  const htmlAlocacao = renderAlocacaoPagina({
    registros, demandas, periodos, senha, geradoEm: today,
    logoDataUri: loadDataUri(LOGO_PATH), iconDataUri: loadDataUri(ICON_PATH),
    avisoAtualizacao, ultimaAtualizacaoOkIso: ultimaAtualizacaoOkIsoValor,
    nimbusRegularDataUri: loadDataUri(NIMBUS_REGULAR_PATH, 'font/otf'),
    nimbusBlackDataUri: loadDataUri(NIMBUS_BLACK_PATH, 'font/otf'),
    texturaMapaDataUri: loadDataUri(TEXTURA_MAPA_PATH),
  });
  // Deriva do MESMO diretório de resolvedOutPath (não de um caminho fixo
  // pra dist/) -- build({ outPath: '...' }) existe pra permitir redirecionar
  // um build (ex.: testes), e um caminho fixo aqui ignoraria esse contrato
  // em silêncio: escreveria o primeiro arquivo em outPath e mesmo assim
  // sobrescreveria dist/alocacao-equipes.html do repositório. mkdirSync já
  // rodou pra este diretório acima (é o mesmo de resolvedOutPath), então não
  // precisa rodar de novo aqui.
  const outPathAlocacao = path.join(path.dirname(resolvedOutPath), 'alocacao-equipes.html');
  fs.writeFileSync(outPathAlocacao, htmlAlocacao, 'utf8');
  console.log(`Wrote ${htmlAlocacao.length} bytes to ${outPathAlocacao}`);

  return resolvedOutPath;
}

if (require.main === module) {
  try {
    build().catch((err) => { console.error(err); process.exit(1); });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

module.exports = {
  build, montarRegistrosEDemandas, baselineParaCliente, redirecionarSupsDesconhecidos, montarEquipesAtivas,
  montarEquipesRealizado, parseRosterOnlineCsvBruto, parseProducaoOnlineCsv,
};
