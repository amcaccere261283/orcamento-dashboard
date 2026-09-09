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
    // saldoLiberadoNaoExecutado: usa o `saldo` já calculado no upstream
    // (montarLiberadoSond) quando existe entrada -- é o valor correto,
    // recalcular aqui arriscaria divergir se a fórmula de lá mudar. Sem
    // entrada nenhuma pra essa chave, liberado/executado são ambos 0, então
    // o fallback max(liberado - executado, 0) é só 0 -- escrito por extenso
    // por clareza/robustez, não por depender do valor de fato.
    const saldoLiberadoNaoExecutado = entradaLiberado ? entradaLiberado.saldo : Math.max(liberadoValor - executado, 0);

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
    const saldoLiberadoNaoExecutado = entradaLiberado.saldo;

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
