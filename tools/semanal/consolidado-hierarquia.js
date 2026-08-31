'use strict';

// Módulo dual Node+navegador (bundle) -- 'var'/'function' no top-level, sem
// 'const'/'let'/arrow, mesmo padrão de render-aba-consolidado.js.
//
// POR QUE ESTE ARQUIVO EXISTE (2026-08-31)
// ============================================================================
// blocosPorSup/tipologiasPresentes nasceram dentro de render-aba-consolidado.js
// e compute-relatorio-semanal.js as importava de lá. Quando o Consolidado
// passou a consumir serieDaSemana de compute-relatorio-semanal.js, os dois
// módulos viraram um CICLO de require mútuo.
//
// Em Node o ciclo funciona por acidente (o cache devolve o module.exports
// parcialmente preenchido). No bundle do navegador não: buildBrowserBundle
// concatena os arquivos como TEXTO na ordem de BUNDLE_ARQUIVOS
// (render-semanal.js) e reescreve cada require() para uma leitura de
// MODULOS['<arquivo>'] -- só UMA direção do ciclo consegue resolver, e a outra
// lê undefined ao carregar a página. Sintoma medido: 114 testes de wireup
// falhando com "Cannot destructure property 'serieDaSemana' of
// 'MODULOS.compute-relatorio-semanal.js' as it is undefined".
//
// A quebra do ciclo é este módulo: duas funções PURAS de agrupamento, sem
// require nenhum, das quais os dois módulos dependem -- nunca um do outro.
// render-aba-consolidado.js continua RE-EXPORTANDO as duas (a API pública
// dele já era consumida assim por test/semanal-render-aba-consolidado.test.js).

// Agrupa por SUP preservando a ordem em que os SUPs aparecem nos registros --
// a MATRIZ já vem ordenada por SUP, e reordenar aqui faria a aba discordar da
// ordem que a Tabela do orçamento mostra para os mesmos dados.
function blocosPorSup(registros, indices) {
  var porSup = {};
  var ordem = [];
  (indices || []).forEach(function (i) {
    var registro = registros[i];
    if (!registro) return;
    if (!porSup[registro.sup]) { porSup[registro.sup] = []; ordem.push(registro.sup); }
    porSup[registro.sup].push(i);
  });
  return ordem.map(function (sup) { return { sup: sup, indices: porSup[sup] }; });
}

function tipologiasPresentes(registros, indices) {
  var porTipologia = {};
  var ordem = [];
  (indices || []).forEach(function (i) {
    var registro = registros[i];
    if (!registro || !registro.tipologia) return;
    if (!porTipologia[registro.tipologia]) { porTipologia[registro.tipologia] = []; ordem.push(registro.tipologia); }
    porTipologia[registro.tipologia].push(i);
  });
  ordem.sort();
  return ordem.map(function (t) { return { tipologia: t, indices: porTipologia[t] }; });
}

module.exports = { blocosPorSup, tipologiasPresentes };
