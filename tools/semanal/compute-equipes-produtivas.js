'use strict';

// EQUIPES PRODUTIVAS a partir de campo/fotos (2026-08-05)
// ============================================================================
// Fonte: sond.com.br/campo/fotos/de/{inicio}/ate/{fim}/tabela/1/ -- uma linha
// por FOTO (não por sondagem: várias fotos por furo por dia são normais).
// "Equipe produtiva num dia" = Sondador distinto naquele dia, por Contrato
// Financeiro. A tabela não tem coluna Tipo -- quem chama injeta
// tipologiaPorSondador (mesmo mapa que build-dashboard.js já calcula pra
// equipes ativas, a partir da tipologia mais frequente nos furos do
// sondador).
//
// Mesmo formato de saída (porDia) que compute-equipes-ativas.js já produz,
// pra plugar no mesmo lugar em build-dashboard.js.

const RE_DATA_BR = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function diaEpochDeTextoBr(texto) {
  const m = RE_DATA_BR.exec(String(texto || '').trim());
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const ano = Number(m[3]);
  return Math.floor(Date.UTC(ano, mes - 1, dia) / 86400000);
}

function agregarEquipesProdutivas(opcoes) {
  const o = opcoes || {};
  const linhas = o.linhas || [];
  const tipologiaPorSondador = o.tipologiaPorSondador || {};
  const rotular = o.rotularTipologia || ((t) => t);

  // contrato -> diaEpoch -> Set(sondador)
  const sondadoresPorContratoDia = new Map();
  let semTipologia = 0;

  for (const linha of linhas) {
    const contrato = String(linha['Contrato Financeiro'] || '').trim();
    const sondador = String(linha['Sondador'] || '').trim();
    const diaEpoch = diaEpochDeTextoBr(linha['Data']);
    if (!contrato || !sondador || diaEpoch === null) continue;

    const tipologiaCrua = tipologiaPorSondador[sondador];
    if (!tipologiaCrua) { semTipologia++; continue; }
    let tipologia;
    try { tipologia = rotular(tipologiaCrua); } catch { tipologia = null; }
    if (!tipologia) { semTipologia++; continue; }

    const chaveContrato = `${contrato}||${tipologia}||${diaEpoch}`;
    if (!sondadoresPorContratoDia.has(chaveContrato)) sondadoresPorContratoDia.set(chaveContrato, new Set());
    sondadoresPorContratoDia.get(chaveContrato).add(sondador);
  }

  const porDia = {};
  for (const [chaveContrato, sondadores] of sondadoresPorContratoDia) {
    const [contrato, tipologia, diaEpochTexto] = chaveContrato.split('||');
    const chave = `${contrato}||${tipologia}`;
    const diaEpoch = Number(diaEpochTexto);
    if (!porDia[chave]) porDia[chave] = {};
    porDia[chave][diaEpoch] = sondadores.size;
  }

  return { porDia, semTipologia };
}

module.exports = { agregarEquipesProdutivas, diaEpochDeTextoBr };
