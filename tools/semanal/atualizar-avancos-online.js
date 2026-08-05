'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readXlsxSheetFromBuffer } = require('../comum/xlsx-reader.js');
const { gridParaCsv } = require('./csv-writer-avancos.js');
const { locateColunasAvancos } = require('./parse-avancos.js');
const cdp = require('./cdp-client.js');

const SITE_ORIGIN = 'https://sond.com.br';
const OUT_PATH = path.join(__dirname, '..', '..', 'dist', 'avancos-online.csv');

// Abaixo de 20% de contratos baixados com sucesso não é o padrão normal de
// "contrato sem sondagem ainda" (já visto entre ~40% e 56% de falha nesse
// motivo, documentado em falhas esperadas) -- é sinal de sessão/autenticação
// quebrada no Chrome (cookie expirado, redirecionado pra tela de login etc.),
// que faria QUASE TODO contrato falhar do mesmo jeito. Gravar o CSV nesse
// cenário substituiria um dado bom por um quase vazio, silenciosamente.
const TAXA_SUCESSO_MINIMA = 0.2;

// Junta as grades (uma por contrato) numa só, pronta pra virar CSV.
//
// CORREÇÃO (2026-08-05, achada rodando contra dados reais -- ver
// task-3-report.md): readXlsxSheetFromBuffer (tools/comum/xlsx-reader.js)
// indexa cada linha pelo número de linha LITERAL do Excel (parseSheetGrid,
// `grid[rowNumber] = row`), e o Excel numera a partir de 1, nunca 0 -- ou
// seja, grid[0] é SEMPRE undefined pra qualquer .xlsx real, e o cabeçalho
// (linha 1 do Excel) sempre cai em grid[1], dado em grid[2] em diante.
// Confirmado baixando um contrato real: grid[0]=undefined, grid[1]=
// ["Contrato","Tomador","Objeto",...], grid[2]=primeira linha de furo. Isso
// vale IGUALMENTE pro .xlsx original (Avanço Sond.xlsx, que parse-avancos.js
// já lê a partir de grid[1]) e pro export por contrato -- não existe
// diferença de formato entre as duas fontes, ao contrário do que o design
// doc registrou antes de testar contra dado real (corrigido lá também).
//
// Cabeçalho sai do PRIMEIRO contrato baixado (grid[1] dele), seguido das
// linhas de dado (grid[2] em diante) de TODOS os contratos, na ordem em que
// vieram -- o resultado é uma grade NORMAL, 0-indexada (linhas[0] =
// cabeçalho), pronta pra gridParaCsv. Não aborta a atualização inteira se
// algum contrato tiver cabeçalho diferente (mesmo template de tela pra
// todos, mas dado real pode variar) -- mas esse contrato tem suas linhas de
// dado PULADAS, mesmo tratamento de um download que falhou. Sem isso, as
// linhas seriam lidas sob os nomes de coluna do primeiro contrato (que não
// são as delas) e produziriam datas/SUPs errados que ainda assim parseiam
// sem erro -- exatamente o tipo de "cair calado numa métrica diferente" que
// este projeto trata como pior que faltar dado (ver CLAUDE.md).
function combinarGradesAvancos(grades) {
  if (!grades.length) throw new Error('combinarGradesAvancos: nenhum contrato baixado.');

  const cabecalho = grades[0][1] || [];
  const avisos = [];
  const linhas = [cabecalho];

  grades.forEach((grade, i) => {
    const cabecalhoAtual = grade[1] || [];
    if (i > 0 && cabecalhoAtual.join('|') !== cabecalho.join('|')) {
      avisos.push(`Contrato de índice ${i} tem cabeçalho diferente do primeiro contrato -- linhas de dado deste contrato PULADAS (não podem ser lidas sob o cabeçalho do primeiro sem risco de coluna errada).`);
      return;
    }
    for (let r = 2; r < grade.length; r++) {
      if (grade[r]) linhas.push(grade[r]);
    }
  });

  return { grid: linhas, avisos };
}

async function buscarContratosAtivos(session) {
  const tomadoras = await cdp.fetchJson(session, '/financeiro/get_tomadoras_contrato_financeiro_ativo_by_prestadora/prestador/1/');
  const contratos = [];
  for (const t of tomadoras) {
    const lista = await cdp.fetchJson(
      session,
      `/financeiro/get_contratos_financeiro_ativo_vigencia_indiferente_empresa_tomadora_by_prestadora/tomador/${t.tomadora_id}/prestador/1/`
    );
    for (const c of lista) {
      contratos.push({ tomadoraId: t.tomadora_id, tomadoraNome: t.tomadora_nome, contratoId: c.id, sup: c.nome });
    }
  }
  return contratos;
}

async function main() {
  console.log('Checando conexao com o Chrome (CDP)...');
  await cdp.checarConexao();
  const { session, target } = await cdp.abrirSessao(`${SITE_ORIGIN}/avanco-sondagens/`);

  try {
    console.log('Buscando contratos financeiros ativos...');
    const contratos = await buscarContratosAtivos(session);
    console.log(`${contratos.length} contrato(s) ativo(s) encontrado(s). Baixando...`);

    const grades = [];
    const falhas = [];
    for (const [i, c] of contratos.entries()) {
      try {
        const buffer = await cdp.fetchBuffer(session, `/avanco-sondagens-excel/tomador/${c.tomadoraId}/contrato-financeiro/${c.contratoId}/`);
        // Contratos sem nenhuma sondagem registrada ainda (ex.: recém
        // ativados) devolvem resposta VAZIA (0 bytes), não um .xlsx com só
        // cabeçalho -- confirmado 2026-08-05 baixando um caso real. Sem essa
        // checagem, cai no "Not a valid zip file" genérico do leitor de zip,
        // que não deixa claro se é bug ou só um contrato sem dado ainda.
        if (buffer.length === 0) {
          throw new Error('resposta vazia -- provavelmente contrato sem nenhuma sondagem registrada ainda');
        }
        const grid = readXlsxSheetFromBuffer(buffer, 'Worksheet');
        // grid[0] é sempre undefined (Excel numera linha a partir de 1) e
        // grid[1] é o cabeçalho -- dado de verdade vai de grid[2] em diante,
        // então a contagem é grid.length - 2, não - 1 (ver o comentário de
        // combinarGradesAvancos acima).
        grades.push(grid);
        console.log(`  [${i + 1}/${contratos.length}] ${c.sup}: ${Math.max(grid.length - 2, 0)} linha(s)`);
      } catch (err) {
        falhas.push({ sup: c.sup, erro: err.message });
        console.warn(`  [${i + 1}/${contratos.length}] ${c.sup}: FALHOU -- ${err.message}`);
      }
    }

    if (!grades.length) {
      throw new Error('Nenhum dos contratos foi baixado com sucesso -- abortando sem gravar (ver falhas acima).');
    }

    // Piso de falha parcial: roda ANTES de gravar, pra deixar o CSV bom que
    // já está em disco intocado se este for um run ruim (ver comentário de
    // TAXA_SUCESSO_MINIMA acima).
    const taxaSucesso = grades.length / contratos.length;
    if (taxaSucesso < TAXA_SUCESSO_MINIMA) {
      throw new Error(
        `Só ${grades.length}/${contratos.length} contratos (${(taxaSucesso * 100).toFixed(1)}%) foram baixados com ` +
        `sucesso -- abaixo do piso de ${(TAXA_SUCESSO_MINIMA * 100).toFixed(0)}%. Isso NÃO é o padrão normal de ` +
        `contratos sem sondagem ainda (esperado ~40-56% de "falha" por esse motivo) -- parece problema de ` +
        `sessão/autenticação no Chrome (cookie expirado, redirecionado pra login etc.). Abortando SEM gravar ` +
        `${OUT_PATH} para não substituir o CSV bom já publicado por um quase vazio. Reabra o Chrome logado em ` +
        `${SITE_ORIGIN} com --remote-debugging-port=9222 e rode de novo. Falhas: ${falhas.map((f) => `${f.sup}: ${f.erro}`).join('; ')}`
      );
    }

    const { grid, avisos } = combinarGradesAvancos(grades);
    avisos.forEach((a) => console.warn(`AVISO: ${a}`));

    // Valida que o cabeçalho combinado ainda é utilizável ANTES de gravar --
    // se uma coluna obrigatória sumiu (layout mudou, ou o único contrato que
    // sobrou pro cabeçalho tinha algo estranho), o CSV que sairia seria
    // malformado e parseAvancos() lançaria só depois, no build da página, sem
    // pista de qual etapa quebrou. Aborta sem gravar: protege o CSV bom que
    // já está em disco de ser sobrescrito por um que não dá pra ler.
    try {
      locateColunasAvancos(grid[0]);
    } catch (err) {
      throw new Error(
        `Cabeçalho combinado ficou inválido -- o CSV que seria gravado em ${OUT_PATH} não teria as colunas que ` +
        `parseAvancos() exige (ver tools/semanal/parse-avancos.js). Abortando SEM gravar, pra não sobrescrever o ` +
        `CSV bom já publicado com um malformado. Erro original: ${err.message}`
      );
    }

    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, gridParaCsv(grid), 'utf8');

    const totalFuros = grid.length - 1;
    console.log(
      `Pronto: ${grades.length}/${contratos.length} contrato(s) baixado(s) com sucesso, ` +
      `${totalFuros} linha(s) de furo combinadas, gravado em ${OUT_PATH}.`
    );
    if (falhas.length) {
      console.warn(`${falhas.length} contrato(s) falharam e ficaram DE FORA deste CSV: ${falhas.map((f) => f.sup).join(', ')}`);
    }
  } finally {
    await cdp.fecharSessao(session, target);
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { combinarGradesAvancos, main };
