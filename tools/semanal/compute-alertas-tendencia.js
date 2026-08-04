'use strict';
const { DIAS_PREMISSA_MES } = require('../comum/calculo-equipes.js');

// Os dois alertas de diagnóstico pedidos em 2026-08-04 -- ver
// docs/superpowers/specs/2026-08-04-semanal-tendencia-regras-e-alertas-design.md.
// Puro: recebe o 'diagnostico' que compute-tendencia-semanal.js já calculou e
// os três insumos externos (saldo de demandas, equipes previstas, premissa de
// produtividade), e responde a pergunta que o ramo levanta.
//
// O require de '../comum/' é REMOVIDO pelo bundler (ver transformaModulo em
// tools/comum/browser-bundle.js): no navegador DIAS_PREMISSA_MES chega como
// global pelo <script> de fonteParaCliente(), que já é injetado ANTES do
// bundle. No Node o require resolve normalmente.

var ALERTA_ROTULO = {
  demanda: 'Avaliar equipe e demanda',
  produtividade: 'Equipes com pouco recurso ou improdutividade',
};

// A premissa de dias úteis do projeto (30, ou 15 em Jan/Dez) recortada na
// fração do mês que ainda falta. Usar dias de CALENDÁRIO aqui faria esta conta
// discordar da coluna "Produtividade média esperada" do Consolidado, que é
// justamente a referência com que ela é comparada.
function diasPremissaRestantes(mesIdx, diasRestantesMes, diasDoMes) {
  var premissa = DIAS_PREMISSA_MES[mesIdx];
  if (!premissa || !diasDoMes) return 0;
  return premissa * diasRestantesMes / diasDoMes;
}

function semDado(tipo, diagnostico) {
  return {
    tipo: tipo, status: 'sem-dado',
    realizadoAcumulado: diagnostico.realizadoAcumulado,
    previstoAcumulado: diagnostico.previstoAcumulado,
  };
}

// entrada: { ramo, diagnostico, mesIdx, diasDoMes, saldoDemandas,
//            equipesPrevistas, produtividadeEsperada }
// Devolve null quando não há nada a dizer, e um objeto quando há -- 'sem-dado'
// quando falta insumo para decidir. Ausência nunca vira "tudo certo".
function avaliarAlertaTendencia(entrada) {
  var e = entrada || {};
  var d = e.diagnostico;
  if (!d || e.ramo === 'igual' || e.ramo === 'sem-dado' || !e.ramo) return null;

  if (e.ramo === 'acima') {
    // O ritmo acima do plano tem carteira que o sustente?
    var excedente = d.tendenciaRestante - d.previstoRestante;
    if (excedente <= 0) return null;
    if (e.saldoDemandas === null || e.saldoDemandas === undefined) return semDado('demanda', d);
    if (e.saldoDemandas >= excedente) return null;
    return {
      tipo: 'demanda', status: 'alerta',
      realizadoAcumulado: d.realizadoAcumulado,
      previstoAcumulado: d.previstoAcumulado,
      excedenteProjetado: excedente,
      saldoDemandas: e.saldoDemandas,
    };
  }

  // ramo 'abaixo': as equipes previstas, na produtividade prevista, dão conta
  // do saldo que ainda falta produzir?
  if (d.saldo <= 0) return null;
  var dias = diasPremissaRestantes(e.mesIdx, d.diasRestantesMes, e.diasDoMes);
  if (!dias || !e.equipesPrevistas
      || e.produtividadeEsperada === null || e.produtividadeEsperada === undefined) {
    return semDado('produtividade', d);
  }
  var exigida = d.saldo / (e.equipesPrevistas * dias);
  if (exigida <= e.produtividadeEsperada) return null;
  return {
    tipo: 'produtividade', status: 'alerta',
    realizadoAcumulado: d.realizadoAcumulado,
    previstoAcumulado: d.previstoAcumulado,
    produtividadeExigida: exigida,
    produtividadeEsperada: e.produtividadeEsperada,
    equipesPrevistas: e.equipesPrevistas,
  };
}

module.exports = { avaliarAlertaTendencia, diasPremissaRestantes, ALERTA_ROTULO };
