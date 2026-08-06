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
const { parseCsvGrid } = require('./parse-matriz-cliente.js');
const { parseLab } = require('./parse-lab.js');
const { computeDemandas, reconciliarSups, redirecionarSupsDesconhecidos, resolverSupConhecido } = require('./compute-demandas.js');
const { agregarEquipesPorDia } = require('./compute-equipes-mobilizadas.js');
const { parseAbaEq, agregarEquipesAtivas, mesDaAbaEq } = require('./compute-equipes-ativas.js');
const { agregarEquipesProdutivas } = require('./compute-equipes-produtivas.js');
const { agregarEquipesNaoProdutivas } = require('./compute-equipes-nao-produtivas.js');
const { rotularTipologia } = require('../comum/tipologias-avancos.js');
const configDemandas = require('./config-demandas.js');

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


// A senha nunca vem de um arquivo do repositório -- só de variável de
// ambiente, lida na hora do build e descartada depois (mesmo raciocínio de
// tools/orcamento/build-dashboard.js: dist/planejamento-semanal.html também
// vai pra um GitHub Pages público).
// Sheet espelho da aba EQ da planilha de equipes, publicada como CSV em
// 2026-08-03. O gid é fixo para sempre: quem resolve qual aba mensal copiar é
// o Apps Script (tools/semanal/apps-script-espelho-eq.gs), a cada 30 min.
const URL_ESPELHO_EQ = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ7SaAZI8VwQaZD0nPxtOyw56b1XmKfqDTC6qSkj-1PAQr4A8ihTY4vZCOhF4PuMNIYm_-hN_CNdNrX/pub?gid=199381651&single=true&output=csv';

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

  if (!csvEspelho) return { equipesPeriodo: null, tipologiaPorSondador };

  const periodo = mesDaAbaEq(csvEspelho);
  if (!periodo) {
    console.warn('Equipes ativas: a espelho não trouxe cabeçalho de data reconhecível -- Δ equipes fica sem dado.');
    return { equipesPeriodo: null, tipologiaPorSondador };
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

  return { equipesPorDia: r.porDia, equipesPeriodo: periodo, tipologiaPorSondador };
}

async function build({ outPath, today = new Date(), senha = process.env.ORCAMENTO_SENHA } = {}) {
  const equipesAtivasCsv = await buscarEspelhoEq();
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
  // Fonte online (2026-08-05): substitui o Avanço Sond.xlsx local por um CSV
  // combinado dos exports de cada contrato ativo, gerado por
  // tools/semanal/atualizar-avancos-online.js (roda à parte, não a cada
  // build -- ver docs/superpowers/specs/2026-08-05-avancos-online-design.md).
  // O unshift(null) reproduz a mesma diferença de indexação que
  // gridCsvComoXlsx() já trata no navegador (render-semanal.js): o CSV
  // combinado tem cabeçalho na linha 0, mas parseAvancos espera cabeçalho em
  // grid[1] (o formato do .xlsx original, que tem uma linha em branco antes).
  const CAMINHO_AVANCOS_ONLINE = path.join(__dirname, '..', '..', 'dist', 'avancos-online.csv');
  let gridAvancos;
  try {
    const csvTexto = fs.readFileSync(CAMINHO_AVANCOS_ONLINE, 'utf8');
    gridAvancos = parseCsvGrid(csvTexto);
    gridAvancos.unshift(null);
  } catch (err) {
    throw new Error(
      `Não consegui ler ${CAMINHO_AVANCOS_ONLINE}. Rode ` +
      `"node tools/semanal/atualizar-avancos-online.js" primeiro (precisa do Chrome ` +
      `aberto com --remote-debugging-port=9222, logado em sond.com.br). Erro original: ${err.message}`
    );
  }
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
  // Equipes mobilizadas por (SUP, tipologia) e por dia -- alimenta o Δ equipes
  // do Balanço de massa (ver compute-equipes-mobilizadas.js). Sai dos furos JÁ
  // redirecionados, igual computeDemandas acima, para que "Diversos" agregue os
  // mesmos SUPs nos dois lugares. Só de Sondagem: os ensaios de Lab não têm
  // sondador (é outra operação, dentro do laboratório).
  demandas.equipesPorDia = agregarEquipesPorDia(furos);
  // As mobilizadas cobrem o ANO INTEIRO do Avanço Sond, então não há mês a
  // restringir: equipesPeriodo null é o que diz "sem restrição" pra
  // foraDaCoberturaDeEquipes (compute-balanco.js). As duas fontes de maior
  // prioridade abaixo SOBRESCREVEM os dois campos JUNTOS -- separá-los é o bug
  // que a revisão final de 2026-08-05 pegou: dado de um mês só com o gate
  // desligado desenha Δ equipes quase zero, sem aviso, em qualquer mês passado.
  demandas.equipesPeriodo = null;
  let fonteEquipes = 'mobilizadas (Avanço Sond)';
  // Δ equipes ATIVAS (2026-08-03): substitui as mobilizadas acima quando a
  // Sheet espelho da aba EQ responde. Assíncrono e tolerante de propósito --
  // ver buscarEquipesAtivas.
  //
  // tipologiaPorSondador é desestruturado À PARTE (nunca entra em 'demandas')
  // porque 'demandas' é JSON.stringify'd por inteiro pro blob cifrado do HTML
  // -- ver renderSemanal() mais abaixo. Anexar essa chave inflaria o payload
  // sem nenhum consumidor no cliente: quem precisa dela é só o bloco de
  // equipes PRODUTIVAS logo abaixo, ainda dentro de build().
  const { tipologiaPorSondador, ...resultadoEquipesAtivas } = montarEquipesAtivas(furos, equipesAtivasCsv);
  Object.assign(demandas, resultadoEquipesAtivas);
  if (demandas.equipesPeriodo) fonteEquipes = 'ATIVAS (aba EQ)';

  // Δ equipes PRODUTIVAS (2026-08-05): fonte online (campo/fotos), vira a
  // PRIMEIRA prioridade pro Δ equipes -- ativas (aba EQ, acima) e mobilizadas
  // (furos) continuam como reserva se o CSV novo não existir ou não produzir
  // nenhum dia utilizável. Ver
  // docs/superpowers/specs/2026-08-05-lab-e-equipes-online-design.md.
  const CAMINHO_EQUIPES_PRODUTIVAS = path.join(__dirname, '..', '..', 'dist', 'equipes-produtivas-online.csv');
  if (fs.existsSync(CAMINHO_EQUIPES_PRODUTIVAS)) {
    try {
      const csvProdutivas = fs.readFileSync(CAMINHO_EQUIPES_PRODUTIVAS, 'utf8');
      const gridProdutivas = parseCsvGrid(csvProdutivas);
      const cabecalho = gridProdutivas[0] || [];
      const linhasProdutivas = gridProdutivas.slice(1).map((linha) => {
        const obj = {};
        cabecalho.forEach((h, i) => { if (h) obj[h] = linha[i]; });
        return obj;
      });
      // resolverSup: MESMA regra de redirecionarSupsDesconhecidos que furos e
      // ensaios já aplicam acima -- par (contrato, tipologia) que a MATRIZ não
      // conhece vai pra "Diversos" em vez de sumir. Sem isso, agora que
      // produtivas é a fonte PRIMÁRIA do Δ equipes, todo contrato fora da MATRIZ
      // baixaria o número principal em silêncio. Injetado (e não resolvido lá
      // dentro) para compute-equipes-produtivas.js seguir sem conhecer a MATRIZ,
      // do mesmo jeito que não conhece fs nem CDP.
      const {
        porDia: porDiaProdutivas,
        semTipologia: semTipologiaProdutivas,
        redirecionados: produtivasRedirecionadas,
        periodo: periodoProdutivas,
      } = agregarEquipesProdutivas({
        linhas: linhasProdutivas,
        tipologiaPorSondador,
        rotularTipologia,
        resolverSup: resolverSupConhecido(registros),
      });
      if (Object.keys(porDiaProdutivas).length) {
        demandas.equipesPorDia = porDiaProdutivas;
        // equipesPeriodo JUNTO com equipesPorDia, sempre -- ver o comentário nas
        // mobilizadas acima. periodoProdutivas sai do próprio dado (o mês mais
        // frequente entre os dias contados), não de um relógio: o build pode
        // rodar num dia diferente do da busca.
        demandas.equipesPeriodo = periodoProdutivas;
        fonteEquipes = 'PRODUTIVAS (campo/fotos online)';
        const mesProdutivas = periodoProdutivas
          ? `${String(periodoProdutivas.mes).padStart(2, '0')}/${periodoProdutivas.ano}`
          : 'mês indeterminado';
        // "equipe-dia" é literal: semTipologia conta (sondador, dia) DISTINTO, não
        // linha de CSV. A tabela é uma linha por FOTO (~1.900/dia), e contar
        // linhas imprimia aqui um número de 5 dígitos que se leria como perda
        // catastrófica de dado sendo só artefato da contagem de fotos.
        console.log(
          `Equipes produtivas (${mesProdutivas}): fonte online em uso -- `
          + `${semTipologiaProdutivas} equipe-dia sem tipologia conhecida (fora da conta), `
          + `${produtivasRedirecionadas} par(es) (contrato, tipologia) redirecionado(s) pra "Diversos" `
          + `(contrato sem registro na MATRIZ pra aquela tipologia).`
        );
      } else {
        console.warn('Equipes produtivas: CSV existe mas não produziu nenhum dia utilizável -- mantendo a fonte de reserva (ativas/mobilizadas).');
      }
    } catch (err) {
      console.warn(`Equipes produtivas: falha ao ler ${CAMINHO_EQUIPES_PRODUTIVAS} (${err.message}) -- mantendo a fonte de reserva.`);
    }
  } else {
    console.warn(`Equipes produtivas: ${CAMINHO_EQUIPES_PRODUTIVAS} não existe -- rode "node tools/semanal/atualizar-equipes-produtivas-online.js". Mantendo a fonte de reserva (ativas/mobilizadas).`);
  }

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
    build().catch((err) => { console.error(err); process.exit(1); });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

module.exports = { build, baselineParaCliente, redirecionarSupsDesconhecidos };
