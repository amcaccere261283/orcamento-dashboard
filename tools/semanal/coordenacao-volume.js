'use strict';
const fs = require('node:fs');
const path = require('node:path');
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

// Extraída em 2026-08-21 (achado do aviso "sem atualização hoje" -- ver
// ultimaAtualizacaoOkIso abaixo, que precisava do MESMO "mais recente com
// resultado=ok" que formatarAvisoAtualizacao já calculava, sem duplicar o
// filter+sort).
function linhaOkMaisRecente(linhas) {
  const linhasOk = linhas.filter((l) => l.resultado === 'ok').sort((a, b) => b.dataHora - a.dataHora);
  return linhasOk.length ? linhasOk[0] : null;
}

function formatarAvisoAtualizacao(linhas) {
  const ultima = linhaOkMaisRecente(linhas);
  if (!ultima) return '';
  const local = agoraNoFusoProjeto(ultima.dataHora);
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  return `Atualizado às ${hh}:${mm} por ${nomeAmigavel(ultima.maquina)}`;
}

// Acrescenta uma linha ao heartbeat de volume, criando arquivo e cabeçalho na
// primeira vez. Mora aqui (e não em atualizar-diario-escalonado.js, de onde
// veio em 2026-08-18) porque o comando manual atualizar-arquivos.js precisa
// gravar a MESMA linha: build-dashboard.js lê esse arquivo pro aviso do
// cabeçalho, então uma publicação manual que não gravasse deixaria a página
// dizendo "Atualizado às 08:00" com dado buscado às 15h.
function gravarLinhaHeartbeatVolume(caminhoArquivo, linhaFormatada) {
  fs.mkdirSync(path.dirname(caminhoArquivo), { recursive: true });
  if (!fs.existsSync(caminhoArquivo)) {
    fs.writeFileSync(caminhoArquivo, CABECALHO_HEARTBEAT_VOLUME + '\n');
  }
  fs.appendFileSync(caminhoArquivo, linhaFormatada + '\n');
}

function lerAvisoAtualizacaoVolume(caminhoArquivo) {
  if (!fs.existsSync(caminhoArquivo)) return '';
  return formatarAvisoAtualizacao(parseHeartbeatVolume(fs.readFileSync(caminhoArquivo, 'utf8')));
}

// ISO da última linha 'ok' do heartbeat de volume, ou null (arquivo ausente
// ou sem nenhum sucesso registrado ainda) -- alimenta
// window.__ULTIMA_ATUALIZACAO_OK__ (render-semanal.js), que o script de
// aviso "sem atualização hoje" usa pra comparar contra o relógio de quem
// abre a página. Devolve o ISO cru (não formatado): quem lê decide o fuso
// -- o cliente já faz esse cálculo em UTC-3 sozinho, sem precisar que o
// build tenha decidido "hoje" no momento da geração (que pode ser ontem se
// a página ficar aberta atravessando a virada do dia).
function ultimaAtualizacaoOkIso(caminhoArquivo) {
  if (!fs.existsSync(caminhoArquivo)) return null;
  const ultima = linhaOkMaisRecente(parseHeartbeatVolume(fs.readFileSync(caminhoArquivo, 'utf8')));
  return ultima ? ultima.dataHora.toISOString() : null;
}

module.exports = {
  CABECALHO_HEARTBEAT_VOLUME, NOMES_AMIGAVEIS, nomeAmigavel,
  parseHeartbeatVolume, formatarLinhaHeartbeat, jaAtualizadoHoje,
  decidirResultado, formatarAvisoAtualizacao, lerAvisoAtualizacaoVolume,
  gravarLinhaHeartbeatVolume, ultimaAtualizacaoOkIso,
};
