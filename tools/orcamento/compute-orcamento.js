'use strict';

function somarMeses(mensal, inicioIdx, fimIdxExclusivo) {
  let soma = 0;
  for (let i = Math.max(0, inicioIdx); i < Math.min(mensal.length, fimIdxExclusivo); i++) {
    soma += mensal[i] || 0;
  }
  return soma;
}

function valorMes(mensal, idx) {
  if (idx < 0 || idx >= mensal.length) return null;
  return mensal[idx] || 0;
}

// vigenteIdx: índice 0-based (0=janeiro) do mês vigente dentro do array de
// 12 meses. acumuladoAnterior/acumuladoFuturo somam vários meses; mês
// vigente/M+1/M+2/M+3 são cada um um único mês.
function calcularJanelas(mensal, vigenteIdx) {
  return {
    acumuladoAnterior: somarMeses(mensal, 0, vigenteIdx),
    mesVigente: valorMes(mensal, vigenteIdx),
    m1: valorMes(mensal, vigenteIdx + 1),
    m2: valorMes(mensal, vigenteIdx + 2),
    m3: valorMes(mensal, vigenteIdx + 3),
    acumuladoFuturo: somarMeses(mensal, vigenteIdx + 4, mensal.length),
  };
}

function dividir(numerador, denominador) {
  if (!denominador) return null;
  return numerador / denominador;
}

const BUCKETS = ['acumuladoAnterior', 'mesVigente', 'm1', 'm2', 'm3', 'acumuladoFuturo'];

function dividirJanelas(numeradorJanelas, denominadorJanelas) {
  const resultado = {};
  for (const bucket of BUCKETS) {
    resultado[bucket] = dividir(numeradorJanelas[bucket], denominadorJanelas[bucket]);
  }
  return resultado;
}

// Previsto nunca recalcula nada: produtividade e ticket médio do Previsto
// são as premissas digitadas na planilha (PROD. e TICKET, um valor só pro
// ano inteiro) -- confirmado com o usuário, são a mesma premissa usada pra
// montar o próprio Previsto, não uma razão derivada por período.
function calcularDimensaoPrevisto(valoresPrevisto, vigenteIdx) {
  return {
    equipes: calcularJanelas(valoresPrevisto.equipes, vigenteIdx),
    volume: calcularJanelas(valoresPrevisto.volume, vigenteIdx),
    financeiro: calcularJanelas(valoresPrevisto.financeiro, vigenteIdx),
    produtividade: valoresPrevisto.equipesResumo.prod,
    ticketMedio: valoresPrevisto.volumeResumo.ticket,
  };
}

// Realizado e Total recalculam produtividade/ticket médio a partir dos
// próprios números apurados em cada período (confirmado com o usuário:
// "ticket médio realizado = total medido / volume realizado, acumulado no
// período"; "produtividade realizada = volumetria realizada / equipes
// mobilizadas, acumulado no período") -- nunca usam PROD./TICKET da
// planilha, que só existem como premissa do Previsto.
function calcularDimensaoApurada(valores, vigenteIdx) {
  const janelasEquipes = calcularJanelas(valores.equipes, vigenteIdx);
  const janelasVolume = calcularJanelas(valores.volume, vigenteIdx);
  const janelasFinanceiro = calcularJanelas(valores.financeiro, vigenteIdx);
  return {
    equipes: janelasEquipes,
    volume: janelasVolume,
    financeiro: janelasFinanceiro,
    produtividade: dividirJanelas(janelasVolume, janelasEquipes),
    ticketMedio: dividirJanelas(janelasFinanceiro, janelasVolume),
  };
}

function calcularResumoRegistro(registro, vigenteIdx) {
  return {
    previsto: registro.previsto ? calcularDimensaoPrevisto(registro.previsto, vigenteIdx) : null,
    realizado: registro.realizado ? calcularDimensaoApurada(registro.realizado, vigenteIdx) : null,
    total: registro.total ? calcularDimensaoApurada(registro.total, vigenteIdx) : null,
  };
}

function computeOrcamento(registros, vigenteIdx) {
  return registros.map(registro => ({ ...registro, resumo: calcularResumoRegistro(registro, vigenteIdx) }));
}

module.exports = { computeOrcamento, calcularJanelas, dividir, dividirJanelas };
