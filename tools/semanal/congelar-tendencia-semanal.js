'use strict';
const { chaveMatriz } = require('../comum/linha-base.js');
const { semanasDoMes, indiceSemanaAtual } = require('./compute-semanal.js');
const { calcularSeriesSemanaisDimensao } = require('./render-aba-semanal.js');

// diaEpoch (dias desde a época Unix, UTC) -> 'YYYY-MM-DD' da SEGUNDA da
// semana seguinte à sexta em que o job roda. Não assume que 'agoraEpoch' É
// uma sexta -- o job pode disparar atrasado (feriado no Task Scheduler,
// máquina desligada) num sábado/domingo, e ainda assim tem de mirar a MESMA
// segunda que a sexta daquela semana mirava, não a segunda seguinte a ele.
function chaveSemanaSeguinteDeSexta(agoraEpoch) {
  var data = new Date(agoraEpoch * 86400000);
  var diaSemana = data.getUTCDay(); // 0=domingo .. 6=sábado
  // Sexta é 5. Quantos dias faltam da SEXTA DESTA SEMANA (a mais recente,
  // <= agora) até a segunda seguinte a ela: sexta+3, sábado+2, domingo+1,
  // segunda..quinta conta pra trás até a sexta anterior e soma os mesmos 3.
  var diasDesdeSexta = (diaSemana + 2) % 7; // sexta=0, sábado=1, domingo=2, segunda=3, ...
  var epochSextaDestaSemana = agoraEpoch - diasDesdeSexta;
  var epochSegundaSeguinte = epochSextaDestaSemana + 3;
  var d = new Date(epochSegundaSeguinte * 86400000);
  var ano = d.getUTCFullYear();
  var mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  var dia = String(d.getUTCDate()).padStart(2, '0');
  return ano + '-' + mes + '-' + dia;
}

// Acha o mesIdx (0-11) e o índice da semana-alvo dentro do mês dela, a
// partir da chave 'YYYY-MM-DD' já calculada -- reconstrói via semanasDoMes
// porque é a MESMA função que o resto do projeto usa pra cortar semanas
// reais (segunda a domingo, nunca cruzando mês), evitando uma segunda
// implementação de calendário que poderia divergir da primeira.
function localizarSemanaAlvo(chaveSemanaAlvo) {
  var partes = chaveSemanaAlvo.split('-').map(Number);
  var ano = partes[0], mes0 = partes[1] - 1;
  var semanasDoMesAlvo = semanasDoMes(ano, mes0);
  var epochAlvo = Date.UTC(ano, mes0, partes[2]) / 86400000;
  var indiceNoMes = semanasDoMesAlvo.findIndex(function (s) { return s.inicio === epochAlvo; });
  if (indiceNoMes === -1) {
    throw new Error('Semana-alvo ' + chaveSemanaAlvo + ' não bate com nenhuma semana de semanasDoMes(' + ano + ',' + mes0 + ') -- calendário divergente.');
  }
  return { ano: ano, mesIdx: mes0, semanas: semanasDoMesAlvo, indiceNoMes: indiceNoMes };
}

function tendenciaDaSemanaAlvo(registros, indices, dimensao, alvo, demandas, hojeEpoch) {
  var indiceAtual = indiceSemanaAtual(alvo.semanas, hojeEpoch);
  var series = calcularSeriesSemanaisDimensao(
    registros, indices, dimensao, alvo.mesIdx, alvo.semanas, alvo.semanas.length,
    !!(demandas && demandas.porRegistroEventos), indiceAtual, demandas, hojeEpoch
  );
  var v = series.semanasTendenciaCompleta[alvo.indiceNoMes];
  return (v === null || v === undefined) ? null : v;
}

// registros: array cru da MATRIZ (mesmo formato de window.__REGISTROS__).
// demandas: { porRegistroEventos } (mesmo formato de window.__DEMANDAS__).
// hojeEpoch: dia-epoch (UTC) do instante em que o job roda -- normalmente
// uma sexta 22h, mas ver chaveSemanaSeguinteDeSexta pra tolerância de atraso.
function calcularSnapshotSemanaAlvo(registros, demandas, hojeEpoch) {
  var chaveSemanaAlvo = chaveSemanaSeguinteDeSexta(hojeEpoch);
  var alvo = localizarSemanaAlvo(chaveSemanaAlvo);
  var porRegistro = {};
  (registros || []).forEach(function (registro, idx) {
    var chave = chaveMatriz(registro.sup, registro.tipologia);
    var volume = tendenciaDaSemanaAlvo(registros, [idx], 'volume', alvo, demandas, hojeEpoch);
    var financeiro = tendenciaDaSemanaAlvo(registros, [idx], 'financeiro', alvo, demandas, hojeEpoch);
    var equipe = tendenciaDaSemanaAlvo(registros, [idx], 'equipes', alvo, demandas, hojeEpoch);
    var produtividadeMedia = (volume === null || !equipe) ? null : volume / equipe;
    porRegistro[chave] = {
      volume: { tendencia: volume }, financeiro: { tendencia: financeiro },
      equipe: { tendencia: equipe }, produtividadeMedia: { tendencia: produtividadeMedia },
    };
  });
  return { chaveSemanaAlvo: chaveSemanaAlvo, geradoEmIso: new Date().toISOString(), porRegistro: porRegistro };
}

module.exports = { chaveSemanaSeguinteDeSexta, calcularSnapshotSemanaAlvo };
