'use strict';

// Porta de tools/matriz/discover-gids.js (repositório-mãe) -- generalizada
// para reconhecer só a categoria "(EQ)" (é a única que este repositório
// consome). Mesma técnica: o endpoint público /htmlview lista todas as
// abas de uma planilha (nome + gid) sem credencial -- só server-side, sem
// CORS, nunca chamável do live-refresh no navegador.
async function buscarListaDeAbas(fileId, fetchImpl = fetch) {
  const url = `https://docs.google.com/spreadsheets/d/${fileId}/htmlview`;
  const res = await fetchImpl(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`buscarListaDeAbas: HTTP ${res.status}`);
  return extrairAbasDoHtml(await res.text());
}

function extrairAbasDoHtml(html) {
  const regex = /items\.push\(\{name: "([^"]*)", pageUrl: "[^"]*", gid: "(\d+)"/g;
  const abas = [];
  let m;
  while ((m = regex.exec(html))) abas.push({ nome: m[1], gid: m[2] });
  return abas;
}

// "AAAA - MÊS (EQ)" -- tolera espaço extra ao redor do ano/hífen, exige o
// ano com 4 dígitos e a categoria EXATA "(EQ)" (não confunde com
// "(EQ e SUP.)", que é outra categoria da mesma planilha).
const NOME_ABA_PATTERN = /^\s*(\d{4})\s*-\s*([A-Za-zÀ-ÿ]+)\s*\(EQ\)\s*$/;

const MESES_NOME = {
  JAN: 1, JANEIRO: 1, FEV: 2, FEVEREIRO: 2, MAR: 3, MARCO: 3, 'MARÇO': 3,
  ABR: 4, ABRIL: 4, MAI: 5, MAIO: 5, JUN: 6, JUNHO: 6, JUL: 7, JULHO: 7,
  AGO: 8, AGOSTO: 8, SET: 9, SETEMBRO: 9, OUT: 10, OUTUBRO: 10,
  NOV: 11, NOVEMBRO: 11, DEZ: 12, DEZEMBRO: 12,
};

function parseNomeAbaEq(nome) {
  const m = NOME_ABA_PATTERN.exec(nome || '');
  if (!m) return null;
  const mes = MESES_NOME[m[2].toUpperCase()];
  if (!mes) return null;
  return { ano: Number(m[1]), mes };
}

// Abas "(EQ)" do ano pedido, uma por mês -- 2+ abas batendo o mesmo
// (ano,mes) (nome duplicado/renomeado) descarta o mês inteiro, nunca
// escolhe "a primeira que achar" (mesmo princípio de discover-gids.js).
function mesesEqDoAno(abas, ano) {
  const porMes = new Map();
  for (const aba of abas || []) {
    const info = parseNomeAbaEq(aba.nome);
    if (!info || info.ano !== ano) continue;
    if (!porMes.has(info.mes)) porMes.set(info.mes, []);
    porMes.get(info.mes).push(aba.gid);
  }
  const saida = [];
  for (const [mes, gids] of porMes) {
    if (gids.length === 1) saida.push({ ano, mes, gid: gids[0] });
  }
  return saida.sort((a, b) => a.mes - b.mes);
}

module.exports = { buscarListaDeAbas, extrairAbasDoHtml, parseNomeAbaEq, mesesEqDoAno };
