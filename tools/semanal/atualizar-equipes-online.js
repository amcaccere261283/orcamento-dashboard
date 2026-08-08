'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseAbaEq } = require('./compute-equipes-ativas.js');
const { agregarEquipesFracao } = require('./compute-equipes-fracao.js');
const { diaEpoch } = require('./compute-semanal.js');
const cdp = require('./cdp-client.js');

const SITE_ORIGIN = 'https://sond.com.br';
const SHEET_ID = '1Mgj87eSKMO4Gh2aHQWChNl5YCH2vatMDC2fCNuxB8TU';
const OUT_PATH = path.join(__dirname, '..', '..', 'dist', 'equipes-online.csv');
const JANELA_FALLBACK_DIAS = 45;

const MESES_PT = ['JANEIRO', 'FEVEREIRO', 'MAR', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

function nomeAbaEq(ano, mesIndice0) {
  return `${ano} - ${MESES_PT[mesIndice0]} (EQ)`;
}

const RE_DATA_HORA = /^(\d{2})\/(\d{2})\/(\d{4})/;
function parseLinhasLink7(linhasCru) {
  const saida = [];
  for (const l of linhasCru || []) {
    const bruto = String(l['Data / Hora Primeira Foto'] || '').trim();
    const m = RE_DATA_HORA.exec(bruto);
    if (!m) continue;
    const dia = diaEpoch(new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))));
    saida.push({
      idSondador: String(l['ID Sondador'] || '').trim(),
      sup: String(l['Contrato Financeiro'] || '').trim(),
      tipo: String(l['Tipo'] || '').trim(),
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
  const aba = nomeAbaEq(ano, mesIndice0);

  console.log(`Buscando roster de equipes (Link 6 -- aba "${aba}")...`);
  const { session: s6, target: t6 } = await cdp.abrirSessao('https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit');
  let csvLink6;
  try {
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

  const { porDia, semLink7, diasPorEstado, textosNoDefault } = agregarEquipesFracao({
    equipes, linhasLink7, ano, mes: mesIndice0 + 1, resolverSup: (sup) => sup, janelaFallbackDias: JANELA_FALLBACK_DIAS,
  });
  console.log(`  Estados do mês: ${JSON.stringify(diasPorEstado)}. ${semLink7} equipe-dia sem produção em ${JANELA_FALLBACK_DIAS} dias -- fora da conta.`);
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

module.exports = { parseLinhasLink7, nomeAbaEq, main };
