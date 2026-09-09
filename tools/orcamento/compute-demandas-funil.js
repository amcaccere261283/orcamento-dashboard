// tools/orcamento/compute-demandas-funil.js
'use strict';
const { chaveMatriz } = require('../comum/linha-base.js');

// Junta os 3 mundos do funil de Demandas -- contratado (MATRIZ Previsto),
// liberado na SOND (cadastrado pra execução, ainda não necessariamente
// executado) e executado -- por chaveMatriz(sup, tipologia). Roda no BUILD,
// em Node (mesmo padrão de tools/semanal/compute-demandas.js: agregação
// pura, sem I/O, o navegador só recebe o resultado já dentro do blob
// cifrado). Módulo puro: nenhum require de fs/rede aqui.
//
// Linhas de `linhas`: uma por registro da MATRIZ (contratado real, liberado/
// executado vindos do liberadoSond quando existe entrada pra aquela chave)
// MAIS uma por chave do liberadoSond que não corresponde a nenhum registro
// (a SOND rastreia um par sup+tipologia que a MATRIZ ainda não pegou --
// contratado fica 0, tomador fica null porque liberadoSond não guarda nome
// de cliente, só Sigla/Prevista/Executada/Saldo agregados por chave).
function montarFunilDemandas({ registros, liberadoSond, propostasGanhas }) {
  const liberadoSeguro = liberadoSond || {};
  const chavesRegistros = new Set();
  const linhas = [];

  (registros || []).forEach(registro => {
    if (!registro) return;
    const chave = chaveMatriz(registro.sup, registro.tipologia);
    chavesRegistros.add(chave);

    const entradaLiberado = liberadoSeguro[chave];
    const contratado = (registro.previsto && registro.previsto.volumeResumo && registro.previsto.volumeResumo.total) || 0;
    const liberadoValor = entradaLiberado ? entradaLiberado.prevista : 0;
    const executado = entradaLiberado ? entradaLiberado.executada : 0;
    // saldoLiberadoNaoExecutado: SEMPRE liberado - executado, calculado
    // aqui -- NUNCA lido de entradaLiberado.saldo. A revisão final de
    // branch decifrou um build real e achou 66 de 404 linhas em que o
    // `saldo` da API SOND não batia com prevista-executada (algumas até
    // negativas sem sentido), o que desalinhava a linha de TOTAL da coluna
    // ao lado. Sem clamp de propósito -- diferente de saldoAliberar, esta
    // coluna precisa fechar a subtração exata das duas colunas vizinhas
    // (Liberado - Executado), por construção, mesmo quando o resultado é
    // negativo.
    const saldoLiberadoNaoExecutado = liberadoValor - executado;

    linhas.push({
      sup: registro.sup,
      tomador: registro.tomador,
      tipologia: registro.tipologia,
      contratado,
      liberado: liberadoValor,
      executado,
      saldoLiberadoNaoExecutado,
      saldoAliberar: Math.max(contratado - liberadoValor, 0),
    });
  });

  Object.keys(liberadoSeguro).forEach(chave => {
    if (chavesRegistros.has(chave)) return; // já coberta pelo laço acima

    const [sup, tipologia] = chave.split('||');
    const entradaLiberado = liberadoSeguro[chave];
    const liberadoValor = entradaLiberado.prevista;
    const executado = entradaLiberado.executada;
    // Mesma regra do laço acima: sempre liberado - executado, nunca o
    // `saldo` bruto da API SOND (ver comentário lá em cima).
    const saldoLiberadoNaoExecutado = liberadoValor - executado;

    linhas.push({
      sup,
      tomador: null,
      tipologia,
      contratado: 0,
      liberado: liberadoValor,
      executado,
      saldoLiberadoNaoExecutado,
      saldoAliberar: 0,
    });
  });

  const propostasGanhasSaida = (propostasGanhas || []).map(p => Object.assign({}, p, { etapa: 'propostaGanha' }));

  return { linhas, propostasGanhas: propostasGanhasSaida };
}

module.exports = { montarFunilDemandas };
