'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseAbaEq } = require('./compute-equipes-ativas.js');
const { agregarEquipesFracao } = require('./compute-equipes-fracao.js');
const { diaEpoch } = require('./compute-semanal.js');
const { rotularTipologia } = require('../comum/tipologias-avancos.js');
const cdp = require('./cdp-client.js');

const SITE_ORIGIN = 'https://sond.com.br';
const SHEET_ID = '1Mgj87eSKMO4Gh2aHQWChNl5YCH2vatMDC2fCNuxB8TU';
const OUT_PATH = path.join(__dirname, '..', '..', 'dist', 'equipes-online.csv');
const JANELA_FALLBACK_DIAS = 45;

// A convenção de nomenclatura das abas "(EQ)" na planilha real NÃO é
// uniforme -- alguns meses usam nome completo, outros abreviação de 3
// letras (verificado ao vivo em 2026-08-08). Por isso não adivinhamos o
// nome exato: descobrimos os nomes reais das abas via CDP (acharAbaEq) e
// casamos com uma regex tolerante às duas formas.
const MESES_ALIASES = [
  ['JAN', 'JANEIRO'], ['FEV', 'FEVEREIRO'], ['MAR', 'MARÇO', 'MARCO'],
  ['ABR', 'ABRIL'], ['MAI', 'MAIO'], ['JUN', 'JUNHO'],
  ['JUL', 'JULHO'], ['AGO', 'AGOSTO'], ['SET', 'SETEMBRO'],
  ['OUT', 'OUTUBRO'], ['NOV', 'NOVEMBRO'], ['DEZ', 'DEZEMBRO'],
];

// Acha o nome EXATO da aba "(EQ)" do mês entre os nomes reais das abas da
// planilha (lidos do DOM via CDP, não adivinhados). `\(EQ\)\s*$` (fim de
// string) evita casar com "(EQ e SUP.)" ou "(EQP)".
function acharAbaEq(nomesReais, ano, mesIndice0) {
  const aliases = MESES_ALIASES[mesIndice0];
  const re = new RegExp('^\\s*' + ano + '\\s*-\\s*(' + aliases.join('|') + ')\\s*\\(EQ\\)\\s*$', 'i');
  const achada = (nomesReais || []).find((n) => re.test(n));
  if (!achada) {
    throw new Error(`Nenhuma aba "(EQ)" encontrada pra ${ano}, mês ${mesIndice0 + 1} entre as ${(nomesReais || []).length} abas da planilha. Abas disponíveis (amostra): ${(nomesReais || []).slice(0, 10).join(', ')}...`);
  }
  return achada;
}

// Acha o valor de uma coluna comparando o rótulo ignorando variação de
// espaçamento (a planilha real usa espaço duplo em algumas colunas, ex.
// "Data / Hora  Primeira Foto" -- não confiável usar a chave exata).
function colunaTolerante(linha, rotulo) {
  const alvo = rotulo.replace(/\s+/g, ' ').trim();
  for (const chave of Object.keys(linha || {})) {
    if (chave.replace(/\s+/g, ' ').trim() === alvo) return linha[chave];
  }
  return undefined;
}

const RE_DATA_HORA = /^(\d{2})\/(\d{2})\/(\d{4})/;
// O Link 7 traz o Tipo BRUTO (ex.: "SM", "SM.F", "SR", "CPTU", "SP.F", "BQ",
// "DN", "SN"...), o mesmo alfabeto de 21 rótulos que a aba Avanços do
// Avanço Sond.xlsx sempre usou -- não o rótulo de 10 tipologias que a
// MATRIZ conhece. Sem traduzir aqui, resolverSupConhecido(registros)(sup,
// tipo) (em build-dashboard.js/render-semanal.js) nunca acha o par na
// MATRIZ pra "SM"/"CPTU"/etc., redireciona pra "Diversos", e a chave final
// (ex. "Diversos||SM") nunca é lida por compute-balanco.js -- o Realizado de
// Equipes fica 0,0 pra essas tipologias em silêncio (achado da revisão final
// de branch, 2026-08-08). rotularTipologia (tools/comum/tipologias-avancos.js)
// é a MESMA tradução que parse-avancos.js já aplica pra Sondagem -- reaplicada
// aqui pra que equipes-online.csv já saia com o rótulo certo, igual todo o
// resto do projeto. Tipo desconhecido LANÇA (fail-loud, mesmo comportamento
// de rotularTipologia) -- não há "cair em Especiais por omissão" tolerável.
function parseLinhasLink7(linhasCru) {
  const saida = [];
  for (const l of linhasCru || []) {
    // Achado ao vivo em 2026-08-08: o cabeçalho real desta coluna tem
    // espaço DUPLO ("Data / Hora  Primeira Foto"), diferente da fixture de
    // teste original (espaço simples) -- o acesso direto por chave ficava
    // sempre undefined, e TODA linha era descartada em silêncio (0
    // sondagem-dia, sem erro nenhum). colunaTolerante ignora a variação de
    // espaçamento em vez de depender do nome exato vindo do DataTable.
    const bruto = String(colunaTolerante(l, 'Data / Hora Primeira Foto') || '').trim();
    const m = RE_DATA_HORA.exec(bruto);
    if (!m) continue;
    const dia = diaEpoch(new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))));
    // Link por NOME (Líder), não por ID -- ver comentário no topo de
    // compute-equipes-fracao.js: "ID Sondador" (pessoa) e o "ID" do roster
    // do Link 6 (equipe) são sistemas de ID diferentes, sem interseção real.
    saida.push({
      lider: String(l['Líder'] || '').trim(),
      sup: String(l['Contrato Financeiro'] || '').trim(),
      tipo: rotularTipologia(l['Tipo']),
      diaEpoch: dia,
    });
  }
  return saida;
}

async function main() {
  console.log('Checando conexao com o Chrome (CDP)...');
  await cdp.checarConexao();

  const hoje = new Date();
  const ano = hoje.getUTCFullYear();
  const mesIndice0 = hoje.getUTCMonth();

  console.log('Buscando roster de equipes (Link 6 -- descobrindo nome real da aba "(EQ)" do mês)...');
  const { session: s6, target: t6 } = await cdp.abrirSessao('https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit');
  let csvLink6;
  let aba;
  try {
    const nomesReais = await s6.evaluate(`
      Array.from(document.querySelectorAll('.docs-sheet-tab-name')).map(el => el.textContent)
    `);
    aba = acharAbaEq(nomesReais, ano, mesIndice0);
    console.log(`  Aba encontrada: "${aba}".`);
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(aba)}`;
    csvLink6 = await cdp.fetchTexto(s6, url);
  } finally {
    await cdp.fecharSessao(s6, t6);
  }
  const equipes = parseAbaEq(csvLink6);
  console.log(`  ${equipes.length} equipe(s) no roster.`);

  const fim = new Date(Date.UTC(ano, mesIndice0 + 1, 0));
  const inicioJanela = new Date(Date.now() - JANELA_FALLBACK_DIAS * 86400000);
  const fmtData = (d) => d.toISOString().slice(0, 10);
  console.log(`Buscando produção (Link 7 -- campo/sondagens, ${fmtData(inicioJanela)} a ${fmtData(fim)})...`);
  const { session: s7, target: t7 } = await cdp.abrirSessao(
    `${SITE_ORIGIN}/campo/sondagens/de/${fmtData(inicioJanela)}/ate/${fmtData(fim)}/tabela/1/`
  );
  let linhasLink7;
  try {
    const { headers, rows } = await cdp.rasparTabelaDataTable(s7, '#table', { timeoutMs: 45000 });
    linhasLink7 = parseLinhasLink7(cdp.linhasComoObjetos({ headers, rows }));
  } finally {
    await cdp.fecharSessao(s7, t7);
  }
  console.log(`  ${linhasLink7.length} sondagem-dia encontrada(s).`);

  const { porDia, semLink7, semNomeCasado, diasPorEstado, textosNoDefault } = agregarEquipesFracao({
    equipes, linhasLink7, ano, mes: mesIndice0 + 1, resolverSup: (sup) => sup, janelaFallbackDias: JANELA_FALLBACK_DIAS,
  });
  console.log(`  Estados do mês: ${JSON.stringify(diasPorEstado)}. ${semLink7} equipe-dia sem produção em ${JANELA_FALLBACK_DIAS} dias -- fora da conta.`);
  if (semNomeCasado > 0) {
    console.warn(`  AVISO: ${semNomeCasado} de ${equipes.length} equipe(s) do roster não casaram por nome com nenhum "Líder" do Link 7 (ambíguo ou ausente) -- link por nome é ajuste temporário, ver comentário em compute-equipes-fracao.js.`);
  }
  if (textosNoDefault && Object.keys(textosNoDefault).length) {
    console.warn(`  Texto(s) de dia de equipe não reconhecido(s), caindo por padrão em "campo sem furo": ${JSON.stringify(textosNoDefault)}`);
  }

  const linhasSaida = ['SUP,Tipo,DiaEpoch,Fracao'];
  for (const [chave, porDiaChave] of Object.entries(porDia)) {
    const [sup, tipo] = chave.split('||');
    for (const [dia, fracao] of Object.entries(porDiaChave)) {
      linhasSaida.push(`${sup},${tipo},${dia},${fracao}`);
    }
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, linhasSaida.join('\n') + '\n', 'utf8');
  console.log(`Pronto: gravado em ${OUT_PATH}.`);
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { parseLinhasLink7, acharAbaEq, main };
