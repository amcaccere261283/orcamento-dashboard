// tools/orcamento/parse-propostas-ganhas.js
'use strict';
const fs = require('node:fs');
const { listZipEntries, readZipEntry } = require('../comum/zip-reader.js');
const { parseWorkbookSheets, readXlsxSheetFromBuffer } = require('../comum/xlsx-reader.js');

// Porta de parse_texto/reconstruir_saldo_positivo.py (extrato-gerencial-
// mensal, sibling repo, Python) -- já validada contra dado real nesta mesma
// sessão. Lê o Radar de Demandas (aba "propostas-<data>"), acha as propostas
// com status GANHA que ainda não têm contrato formalizado na MATRIZ nem
// liberação cadastrada na SOND, e devolve uma linha por (proposta,
// tipologia) achada no texto livre da coluna "objeto" (ou, na falta disso,
// numa nota manual digitada em alguma outra célula da mesma linha).
//
// A entrada "some sozinha" da lista quando o contrato correspondente aparece
// na MATRIZ ou no liberadoSond desta mesma rodada -- ver montarPropostasGanhas
// (dedup no fim).

// Dicionário de sinônimos do texto livre de PROPOSTAS -> tipologia canônica
// que o funil usa. DELIBERADAMENTE pequeno e conferido à mão -- não é o
// mesmo mapa de tools/comum/tipologias-avancos.js (aquele traduz o
// vocabulário cru da aba Avanços da Sond; este traduz como o time de
// propostas escreve à mão no Radar de Demandas: "Shelby", "Denison", "SPT"
// etc). Não faz sentido fundir os dois.
const SINONIMOS = {
  'BL IND': 'BL', 'BL': 'BL',
  'CPTU': 'CPTU',
  'DENISON': 'DN', 'DEN': 'DN', 'DN': 'DN',
  'PI': 'PI',
  'SPT': 'SP', 'SP': 'SP',
  'SM.F': 'SM.F', 'SM': 'SM',
  'SHELBY': 'SH', 'SH': 'SH',
  'SR': 'SR',
  'ST': 'ST',
  'VT': 'VT',
};

// Colunas obrigatórias da aba de propostas, resolvidas SEMPRE pelo rótulo da
// linha 1 (nunca por posição fixa) -- ver resolverColunas.
const COLUNAS_OBRIGATORIAS = ['sup', 'status', 'contratante', 'clienteFinal', 'objeto'];

function celulaTexto(v) {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

// "3.000,5" -> 3000.5. Mesma convenção pt-BR do resto do projeto (ponto de
// milhar, vírgula decimal).
function parseNumero(s) {
  return parseFloat(s.trim().replace(/\./g, '').replace(',', '.'));
}

// Extrai {tipologia canônica: quantidade somada} de um texto livre tipo
// "SPT: 100 und / SM: 100 und / ST: 100 und". Segmentos separados por "|" OU
// "/" (propostas diferentes usam delimitadores diferentes); cada segmento
// precisa bater no regex "<fase> <número>" -- o \d obrigatório no início do
// número é o que impede uma vírgula solta de prosa (ex.: "ST, SPT, SM, PI e
// Ensaios de Laboratório") de ser lida como um número falso. "LAB" é
// ignorado de propósito (laboratório tem fonte própria, fora deste funil).
// Fase sem sinônimo conhecido vai para naoMapeados em vez de ser descartada
// em silêncio -- quem chama decide como surfar isso (ver montarPropostasGanhas).
function parseTexto(texto) {
  const valores = {};
  const naoMapeados = [];
  for (let seg of String(texto || '').split(/[|/]/)) {
    seg = seg.trim();
    if (!seg) continue;
    const m = /^([A-Za-zÀ-ÿ.]+(?:\s+[A-Za-zÀ-ÿ]+)?)\s*:?\s+(\d[\d.,]*)/.exec(seg);
    if (!m) continue;
    const fase = m[1].trim().toUpperCase();
    const num = m[2];
    if (fase === 'LAB') continue;
    const canonico = SINONIMOS[fase];
    if (canonico === undefined) {
      naoMapeados.push([fase, seg]);
      continue;
    }
    valores[canonico] = (valores[canonico] || 0) + parseNumero(num);
  }
  return { valores, naoMapeados };
}

// Acha a aba de propostas do workbook por PREFIXO ("propostas", case-
// insensitive) -- o nome real inclui a data em que a aba foi exportada
// (ex.: "propostas-2026-09-08 (1)") e muda a cada corte novo. Zero ou 2+
// abas batendo o prefixo falha alto: "falhar é barato" é a filosofia do
// resto do projeto, e adivinhar aqui arriscaria ler a aba errada em silêncio.
function acharAbaPropostas(buffer) {
  const zipEntries = listZipEntries(buffer);
  const workbookEntry = zipEntries.get('xl/workbook.xml');
  if (!workbookEntry) throw new Error('Radar de Demandas: buffer não é um .xlsx válido (falta xl/workbook.xml)');
  const workbookXml = readZipEntry(buffer, workbookEntry).toString('utf8');
  const sheets = parseWorkbookSheets(workbookXml);
  const encontradas = sheets.filter(s => /^propostas/i.test(s.name));
  if (encontradas.length !== 1) {
    const todas = sheets.map(s => s.name).join(', ') || '(nenhuma)';
    const nomesEncontrados = encontradas.map(s => s.name).join(', ') || '(nenhuma)';
    throw new Error(
      `Radar de Demandas: esperava exatamente 1 aba começando com "propostas" (case-insensitive), encontrei ${encontradas.length} (${nomesEncontrados}). Abas disponíveis no workbook: ${todas}.`
    );
  }
  return encontradas[0].name;
}

// Resolve as colunas obrigatórias pelo RÓTULO da linha 1 da aba (nunca por
// posição fixa -- a ordem real das colunas não é garantida entre revisões).
// Falta de qualquer uma das 5 falha alto, listando todas de uma vez.
function resolverColunas(headerRow) {
  if (!headerRow) throw new Error('Aba de propostas: linha de cabeçalho (linha 1) está vazia');
  const porNome = {};
  headerRow.forEach((valor, col) => {
    const nome = celulaTexto(valor);
    if (nome && !(nome in porNome)) porNome[nome] = col;
  });
  const faltando = COLUNAS_OBRIGATORIAS.filter(nome => !(nome in porNome));
  if (faltando.length) {
    throw new Error(`Aba de propostas: coluna(s) obrigatória(s) não encontrada(s) no cabeçalho: ${faltando.join(', ')}.`);
  }
  const colunas = {};
  COLUNAS_OBRIGATORIAS.forEach(nome => { colunas[nome] = porNome[nome]; });
  return colunas;
}

// Base do SUP (formato "dddd-dd", ex. "8224-25") extraída de um valor cru
// que pode vir como "SUP-8224-25" (coluna sup do Radar), "8224-25" (nota
// manual) ou "SUP-8224-25 (AB)" (registro.sup da MATRIZ / chave do
// liberadoSond). null se o valor não contém o padrão.
// Convenção de saída deste módulo: todo `sup` devolvido por
// montarPropostasGanhas já está normalizado NESTA forma "dddd-dd" (sem
// prefixo "SUP-", sem sufixo de sigla) -- quem for montar uma string de
// exibição a partir dele decide o prefixo/sufixo na hora de renderizar.
function extrairSupBase(valorCru) {
  const m = /(\d{4}-\d{2})/.exec(celulaTexto(valorCru));
  return m ? m[1] : null;
}

// Constrói, para a aba INTEIRA de propostas (não só as linhas GANHA -- uma
// nota manual pode estar em qualquer linha), um mapa supBase -> texto da
// nota. Cada linha além do cabeçalho tem TODAS as células não-vazias
// concatenadas com "," (algumas notas reais vêm partidas em várias células
// por causa de uma vírgula perdida no texto colado original) e testadas
// contra /^\s*(\d{4}-\d{2})\s*-\s*(.*)$/. A primeira linha que casar um
// supBase vence -- não há sinal de que duplicatas devam se sobrescrever.
function montarNotasManuais(grid) {
  const notas = {};
  for (let r = 2; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    const textoLinha = row
      .filter(v => v !== undefined && v !== null && String(v).trim() !== '')
      .map(v => String(v).trim())
      .join(',');
    if (!textoLinha) continue;
    const m = /^\s*(\d{4}-\d{2})\s*-\s*(.*)$/.exec(textoLinha);
    if (!m) continue;
    const supBase = m[1];
    if (!(supBase in notas)) notas[supBase] = m[2];
  }
  return notas;
}

// grid já parseado (readXlsxSheetFromBuffer) -> lista de propostas GANHAS
// ainda não formalizadas, uma entrada por (proposta, tipologia achada).
// Separada de montarPropostasGanhas só pra facilitar teste sem precisar
// montar um .xlsx sintético pra cada caso de parseTexto/dedup.
function extrairPropostasGanhas(grid, { registros, liberadoSond } = {}) {
  const headerRow = grid[1];
  const colunas = resolverColunas(headerRow);
  const notasManuais = montarNotasManuais(grid);

  const resultado = [];
  for (let r = 2; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    const status = celulaTexto(row[colunas.status]);
    if (status !== 'GANHA') continue;

    const supBase = extrairSupBase(row[colunas.sup]);
    if (!supBase) {
      console.warn(`AVISO: proposta GANHA sem SUP reconhecível ("${celulaTexto(row[colunas.sup])}") -- não entra no funil de Demandas.`);
      continue;
    }

    const objeto = celulaTexto(row[colunas.objeto]);
    let { valores, naoMapeados } = parseTexto(objeto);
    let origem = 'objeto';
    if (Object.keys(valores).length === 0 && notasManuais[supBase] !== undefined) {
      const resultadoNota = parseTexto(notasManuais[supBase]);
      valores = resultadoNota.valores;
      naoMapeados = naoMapeados.concat(resultadoNota.naoMapeados);
      origem = 'nota manual';
    }

    naoMapeados.forEach(([fase, seg]) => {
      console.warn(`AVISO: proposta ${supBase}: tipologia não reconhecida "${fase}" em "${seg}" -- não entra no funil de Demandas.`);
    });

    if (Object.keys(valores).length === 0) continue;

    const cliente = celulaTexto(row[colunas.contratante]);
    const clienteFinal = celulaTexto(row[colunas.clienteFinal]);
    for (const [tipologia, quantidade] of Object.entries(valores)) {
      resultado.push({ sup: supBase, cliente, clienteFinal, tipologia, quantidade, origem });
    }
  }

  // Dedup: some da lista todo supBase que já apareça formalizado na MATRIZ
  // (registros) ou já liberado na SOND nesta mesma rodada (liberadoSond) --
  // é assim que a proposta "desaparece sozinha" assim que o contrato vira
  // realidade, sem intervenção manual.
  const supsJaFormalizados = new Set();
  (registros || []).forEach(registro => {
    const base = extrairSupBase(registro && registro.sup);
    if (base) supsJaFormalizados.add(base);
  });
  Object.keys(liberadoSond || {}).forEach(chave => {
    const base = extrairSupBase(chave.split('||')[0]);
    if (base) supsJaFormalizados.add(base);
  });

  return resultado.filter(item => !supsJaFormalizados.has(item.sup));
}

// Ponto de entrada: lê o Radar de Demandas do disco, acha a aba de
// propostas por prefixo, e devolve as propostas GANHAS ainda não
// formalizadas (dedupadas contra registros/liberadoSond).
//
// OPCIONAL, mesmo padrão dos outros `caminho*Online` de build-dashboard.js
// (caminhoDemandasSondagemOnline, caminhoDemandasLabOnline,
// caminhoLiberadoSondOnline): o arquivo mora num drive de rede (G:\) que
// pode não estar montado numa máquina qualquer (CI, notebook de outro
// colaborador) -- diferente da MATRIZ/linha de base, que são fundamentais
// pro resto do dashboard, propostas GANHAS é um adicional. Sem o arquivo, o
// build segue (aviso no console); só a etapa "propostas GANHAS ainda não
// formalizadas" do funil de Demandas fica de fora.
function montarPropostasGanhas({ registros, liberadoSond, caminhoRadarDemandas }) {
  if (!fs.existsSync(caminhoRadarDemandas)) {
    console.warn(`AVISO: ${caminhoRadarDemandas} não encontrado (ou inacessível -- confira se o drive de rede está montado) -- funil de Demandas fica sem a etapa "propostas GANHAS ainda não formalizadas".`);
    return [];
  }
  const buffer = fs.readFileSync(caminhoRadarDemandas);
  const nomeAba = acharAbaPropostas(buffer);
  const grid = readXlsxSheetFromBuffer(buffer, nomeAba);
  return extrairPropostasGanhas(grid, { registros, liberadoSond });
}

module.exports = {
  montarPropostasGanhas, extrairPropostasGanhas, acharAbaPropostas, resolverColunas,
  parseTexto, extrairSupBase, montarNotasManuais, SINONIMOS,
};
