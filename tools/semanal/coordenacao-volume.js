'use strict';
const fs = require('node:fs');
const { hojeNoFusoProjeto, agoraNoFusoProjeto } = require('../comum/datas.js');

const CABECALHO_HEARTBEAT_VOLUME = 'data_hora,maquina,resultado,detalhe';

// Hostnames confirmados em 2026-08-18 (ver o spec) -- Kairo ainda não tem
// hostname conhecido, cai no fallback (retorna o próprio hostname cru).
const NOMES_AMIGAVEIS = {
  COMPUTADOR053: 'Patrick',
  'COMP-074': 'Américo',
};

function nomeAmigavel(hostname) {
  return NOMES_AMIGAVEIS[hostname] || hostname;
}

function formatarLinhaHeartbeat({ dataHora, maquina, resultado, detalhe }) {
  // CSV sem suporte a aspas neste projeto (mesmo padrão dos outros CSVs
  // gerados aqui) -- troca vírgula por ponto-e-vírgula no detalhe pra nunca
  // quebrar a coluna.
  const detalheSeguro = (detalhe || '').replace(/,/g, ';');
  return `${dataHora.toISOString()},${maquina},${resultado},${detalheSeguro}`;
}

function parseHeartbeatVolume(texto) {
  if (!texto) return [];
  const linhas = texto.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!linhas.length) return [];
  // A 1ª linha é sempre o cabeçalho -- este arquivo é sempre escrito por
  // formatarLinhaHeartbeat/este próprio módulo, nunca à mão.
  return linhas.slice(1).map((linha) => {
    const [dataHoraIso, maquina, resultado, detalhe = ''] = linha.split(',');
    return { dataHora: new Date(dataHoraIso), maquina, resultado, detalhe };
  });
}

function mesmoDiaSp(a, b) {
  return a.ano === b.ano && a.mes === b.mes && a.dia === b.dia;
}

function jaAtualizadoHoje(linhas, agora = new Date()) {
  const hoje = hojeNoFusoProjeto(agora);
  return linhas.some((l) => l.resultado === 'ok' && mesmoDiaSp(hojeNoFusoProjeto(l.dataHora), hoje));
}

function decidirResultado(resultadosBuscas) {
  const falhas = resultadosBuscas.filter((r) => !r.ok);
  const resultado = falhas.length < resultadosBuscas.length ? 'ok' : 'falhou';
  const detalhe = falhas.map((f) => `${f.nome} (${f.erro})`).join('; ');
  return { resultado, detalhe };
}

function formatarAvisoAtualizacao(linhas) {
  const linhasOk = linhas.filter((l) => l.resultado === 'ok').sort((a, b) => b.dataHora - a.dataHora);
  if (!linhasOk.length) return '';
  const ultima = linhasOk[0];
  const local = agoraNoFusoProjeto(ultima.dataHora);
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  return `Atualizado às ${hh}:${mm} por ${nomeAmigavel(ultima.maquina)}`;
}

function lerAvisoAtualizacaoVolume(caminhoArquivo) {
  if (!fs.existsSync(caminhoArquivo)) return '';
  return formatarAvisoAtualizacao(parseHeartbeatVolume(fs.readFileSync(caminhoArquivo, 'utf8')));
}

module.exports = {
  CABECALHO_HEARTBEAT_VOLUME, NOMES_AMIGAVEIS, nomeAmigavel,
  parseHeartbeatVolume, formatarLinhaHeartbeat, jaAtualizadoHoje,
  decidirResultado, formatarAvisoAtualizacao, lerAvisoAtualizacaoVolume,
};
