'use strict';
// Funções puras usadas pelo botão "Congelar semana" (aba Consolidado,
// render-semanal.js) para calcular a chave da semana-alvo e montar o
// snapshot que é enviado ao Apps Script de congelamento
// (congelamento-sheet.js). Este arquivo entra no bundle do navegador
// (BUNDLE_ARQUIVOS, render-semanal.js) -- por isso não pode ter nenhum
// require de módulo Node puro (fs/path/child_process) nem de nada fora do
// diretório same-dir que não seja suprido como global por fonteParaCliente():
// um antigo job de linha de comando que rodava aqui (publicava o snapshot
// direto no git às sextas 22h, substituído pelo botão) chegou a viver neste
// mesmo arquivo com esses requires -- adicioná-lo ao bundle sem removê-los
// primeiro quebra o <script> do cliente inteiro em silêncio (ReferenceError:
// require is not defined, na primeira linha que os usa).
const { chaveMatriz } = require('../comum/linha-base.js');
const { semanasDoMes, indiceSemanaAtual } = require('./compute-semanal.js');
const { calcularSeriesSemanaisDimensao } = require('./render-aba-semanal.js');

// dia-epoch (dias desde a época Unix, UTC) -> 'YYYY-MM-DD' da próxima SEGUNDA
// estritamente depois de hoje. Clicar numa segunda congela a semana SEGUINTE,
// não a que acabou de começar.
function proximaSegunda(hojeEpoch) {
  var data = new Date(hojeEpoch * 86400000);
  var diaSemana = data.getUTCDay(); // 0=domingo .. 6=sábado
  // Dias até a próxima segunda: domingo->1, segunda->7, terça->6, ... sábado->2.
  var faltam = (8 - diaSemana) % 7;
  if (faltam === 0) faltam = 7;
  return formatarDiaIso(hojeEpoch + faltam);
}

// dia-epoch -> 'YYYY-MM-DD'. Extraído porque proximaSegunda e
// fragmentosDaSemanaAlvo precisam do mesmo formato.
function formatarDiaIso(diaEpoch) {
  var d = new Date(diaEpoch * 86400000);
  var ano = d.getUTCFullYear();
  var mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  var dia = String(d.getUTCDate()).padStart(2, '0');
  return ano + '-' + mes + '-' + dia;
}

// chaveSegunda ('YYYY-MM-DD', sempre uma segunda) -> um descritor por FRAGMENTO
// de calendário que essa semana ocupa.
//
// semanasDoMes corta semanas na virada do mês, então a semana 31/08-06/09 vira
// [31/08,31/08] em agosto MAIS [01/09,06/09] em setembro. O Consolidado chaveia
// pelo início do fragmento que está em tela, então o congelamento precisa gravar
// sob TODAS as chaves que ele pode procurar -- senão ~1 mês em 4 tem uma semana
// que nunca acha o próprio snapshot.
//
// Substitui localizarSemanaAlvo, que devolvia UM alvo e LANÇAVA quando a chave
// não era início de semana no mês dela.
function fragmentosDaSemanaAlvo(chaveSegunda) {
  var partes = chaveSegunda.split('-').map(Number);
  var epochSegunda = Date.UTC(partes[0], partes[1] - 1, partes[2]) / 86400000;
  var epochDomingo = epochSegunda + 6;
  var fragmentos = [];

  // A semana toca no máximo dois meses: o da segunda e o do domingo.
  var mesesTocados = [{ ano: partes[0], mes0: partes[1] - 1 }];
  var dataDomingo = new Date(epochDomingo * 86400000);
  var anoD = dataDomingo.getUTCFullYear(), mesD = dataDomingo.getUTCMonth();
  if (anoD !== mesesTocados[0].ano || mesD !== mesesTocados[0].mes0) {
    mesesTocados.push({ ano: anoD, mes0: mesD });
  }

  mesesTocados.forEach(function (m) {
    var semanas = semanasDoMes(m.ano, m.mes0);
    semanas.forEach(function (s, indice) {
      // O fragmento pertence a esta semana-alvo se ele cai DENTRO do intervalo
      // segunda..domingo dela.
      if (s.inicio < epochSegunda || s.inicio > epochDomingo) return;
      fragmentos.push({
        chave: formatarDiaIso(s.inicio), ano: m.ano, mesIdx: m.mes0,
        semanas: semanas, indiceNoMes: indice,
      });
    });
  });
  return fragmentos;
}

function tendenciaDoFragmento(registros, indices, dimensao, fragmento, demandas, hojeEpoch) {
  var indiceAtual = indiceSemanaAtual(fragmento.semanas, hojeEpoch);
  var series = calcularSeriesSemanaisDimensao(
    registros, indices, dimensao, fragmento.mesIdx, fragmento.semanas, fragmento.semanas.length,
    !!(demandas && demandas.porRegistroEventos), indiceAtual, demandas, hojeEpoch
  );
  var v = series.semanasTendenciaCompleta[fragmento.indiceNoMes];
  return (v === null || v === undefined) ? null : v;
}

// registros: array cru da MATRIZ (mesmo formato de window.__REGISTROS__).
// demandas: { porRegistroEventos } (mesmo formato de window.__DEMANDAS__).
// hojeEpoch: dia-epoch (UTC) do dia do clique.
// chaveSegundaAlvo: 'YYYY-MM-DD' da segunda da semana a congelar -- vem de
//   proximaSegunda(hojeEpoch). É parâmetro em vez de calculado aqui dentro pra
//   que o chamador possa mostrar na tela QUAL semana vai congelar antes de
//   confirmar, sem recalcular a regra em dois lugares.
function calcularSnapshotSemanaAlvo(registros, demandas, hojeEpoch, chaveSegundaAlvo) {
  var fragmentos = fragmentosDaSemanaAlvo(chaveSegundaAlvo);
  var linhas = [];
  fragmentos.forEach(function (fragmento) {
    (registros || []).forEach(function (registro, idx) {
      var volume = tendenciaDoFragmento(registros, [idx], 'volume', fragmento, demandas, hojeEpoch);
      var financeiro = tendenciaDoFragmento(registros, [idx], 'financeiro', fragmento, demandas, hojeEpoch);
      var equipe = tendenciaDoFragmento(registros, [idx], 'equipes', fragmento, demandas, hojeEpoch);
      linhas.push({
        chave: fragmento.chave,
        chaveMatriz: chaveMatriz(registro.sup, registro.tipologia),
        volume: volume, financeiro: financeiro, equipe: equipe,
        produtividadeMedia: (volume === null || !equipe) ? null : volume / equipe,
      });
    });
  });
  return { chaveSegunda: chaveSegundaAlvo, geradoEmIso: new Date().toISOString(), linhas: linhas };
}

// Grava o snapshot de tendência congelada em disco -- consumida hoje só por
// build-dashboard.js (mecanismo antigo, window.__CONGELADO_SEMANAL__, ver o
// comentário lá) e pelo teste de escrita atômica. NUNCA chamada do lado do
// navegador (o botão "Congelar semana" grava direto na Sheet, via
// congelamento-sheet.js) -- por isso os requires de fs/path ficam LAZY,
// dentro da função, em vez de no topo do arquivo: um require de módulo Node
// puro no ESCOPO DO MÓDULO rodaria na hora zero da IIFE do bundle
// (buildBrowserBundle envolve cada arquivo assim) e quebraria o <script> do
// cliente inteiro em silêncio -- dentro da função, só quebraria SE fosse
// chamada, o que nunca acontece no navegador.
function gravarSnapshotNoArquivo(caminhoArquivo, snapshot) {
  var fs = require('node:fs');
  var path = require('node:path');
  fs.mkdirSync(path.dirname(caminhoArquivo), { recursive: true });
  var atual = {};
  if (fs.existsSync(caminhoArquivo)) {
    atual = JSON.parse(fs.readFileSync(caminhoArquivo, 'utf8'));
  }
  atual[snapshot.chaveSemanaAlvo] = { geradoEm: snapshot.geradoEmIso, porRegistro: snapshot.porRegistro };
  // Gravação ATÔMICA: arquivo temporário no MESMO diretório (rename entre
  // volumes diferentes não é atômico) e depois renameSync por cima do destino.
  // Sem isso, um job morto no meio da escrita -- ou disco cheio -- deixaria um
  // JSON truncado em docs/, e o build-dashboard.js que o lê quebraria as DUAS
  // páginas até alguém apagar o arquivo à mão. O leitor também se protege
  // (lerCongeladoSemanal, build-dashboard.js), mas um recurso opcional não pode
  // depender só disso: aqui o estado truncado nunca chega a ficar visível.
  var temporario = caminhoArquivo + '.tmp';
  fs.writeFileSync(temporario, JSON.stringify(atual, null, 2) + '\n');
  fs.renameSync(temporario, caminhoArquivo);
}

module.exports = {
  proximaSegunda, formatarDiaIso, fragmentosDaSemanaAlvo, calcularSnapshotSemanaAlvo,
  gravarSnapshotNoArquivo,
};
