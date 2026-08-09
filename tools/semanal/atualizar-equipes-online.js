'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { agregarEquipesProdutivas } = require('./compute-equipes-produtivas-link7.js');
const { diaEpoch } = require('./compute-semanal.js');
const { rotularTipologia } = require('../comum/tipologias-avancos.js');
const cdp = require('./cdp-client.js');

const SITE_ORIGIN = 'https://sond.com.br';
const OUT_PATH = path.join(__dirname, '..', '..', 'dist', 'equipes-online.csv');

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
    // ID Sondador (não "Líder"): equipes PRODUTIVAS não precisa casar com
    // nenhum roster externo (ver compute-equipes-produtivas-link7.js) -- só
    // precisa ser consistente DENTRO do próprio Link 7, e ID Sondador já é.
    saida.push({
      idSondador: String(colunaTolerante(l, 'ID Sondador') || '').trim(),
      sup: String(colunaTolerante(l, 'Contrato Financeiro') || '').trim(),
      tipo: rotularTipologia(colunaTolerante(l, 'Tipo')),
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
  const inicio = new Date(Date.UTC(ano, mesIndice0, 1));
  const fim = new Date(Date.UTC(ano, mesIndice0 + 1, 0));
  const fmtData = (d) => d.toISOString().slice(0, 10);

  console.log(`Buscando produção (Link 7 -- campo/sondagens, ${fmtData(inicio)} a ${fmtData(fim)})...`);
  const { session, target } = await cdp.abrirSessao(
    `${SITE_ORIGIN}/campo/sondagens/de/${fmtData(inicio)}/ate/${fmtData(fim)}/tabela/1/`
  );
  let linhasLink7;
  try {
    const { headers, rows } = await cdp.rasparTabelaDataTable(session, '#table', { timeoutMs: 45000 });
    linhasLink7 = parseLinhasLink7(cdp.linhasComoObjetos({ headers, rows }));
  } finally {
    await cdp.fecharSessao(session, target);
  }
  console.log(`  ${linhasLink7.length} sondagem-dia encontrada(s).`);

  if (!linhasLink7.length) {
    throw new Error('Nenhuma linha encontrada no Link 7 -- abortando sem gravar (sessao expirada, ou mes sem nenhuma sondagem ainda -- confira antes de aceitar um CSV vazio).');
  }

  const { porDia } = agregarEquipesProdutivas(linhasLink7);
  const totalPares = Object.keys(porDia).length;
  console.log(`  ${totalPares} par(es) (SUP, tipologia) com equipe produtiva no mes.`);

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

module.exports = { parseLinhasLink7, main };
