'use strict';
const { chaveMatriz } = require('../comum/linha-base.js');
const { semanasDoMes, indiceSemanaAtual } = require('./compute-semanal.js');
const { calcularSeriesSemanaisDimensao } = require('./render-aba-semanal.js');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  parseHeartbeatVolume, formatarLinhaHeartbeat, jaAtualizadoHoje, gravarLinhaHeartbeatVolume,
} = require('./coordenacao-volume.js');

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

function gravarSnapshotNoArquivo(caminhoArquivo, snapshot) {
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

// --- CLI, mesmo padrão de corrida segura de atualizar-diario-escalonado.js:
// heartbeat PRÓPRIO (nome de arquivo diferente, mesmo formato de linha), pra
// não competir com o heartbeat de busca de volume -- os dois podem disparar
// em janelas de tempo diferentes (8h vs. sexta 22h) e não têm por que
// compartilhar a mesma trava.
const RAIZ = path.join(__dirname, '..', '..');
const CAMINHO_SNAPSHOT = path.join(RAIZ, 'docs', 'tendencia-congelada-semanal.json');
const CAMINHO_HEARTBEAT = path.join(RAIZ, 'dist', 'heartbeat-congelamento-semanal.csv');
const NOME_HEARTBEAT = 'heartbeat-congelamento-semanal.csv';
const NOME_SNAPSHOT = 'tendencia-congelada-semanal.json';

function git(args) { return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8' }); }

function lerHeartbeatDoOrigin() {
  try {
    return parseHeartbeatVolume(git(['show', 'origin/master:dist/' + NOME_HEARTBEAT]));
  } catch (err) {
    console.warn('Aviso: git show falhou (' + err.message + ') -- tratando como "nunca rodou".');
    return [];
  }
}

function precisaRodarHoje() {
  try { git(['fetch', 'origin', 'master']); }
  catch (err) { console.warn('Aviso: git fetch falhou (' + err.message + ') -- seguindo com cache local.'); }
  return !jaAtualizadoHoje(lerHeartbeatDoOrigin());
}

// Desfaz a escrita de UM arquivo feita nesta rodada perdida (outra máquina
// venceu a corrida entre o cálculo do snapshot e a 2ª checagem de
// precisaRodarHoje()) -- ANTES do 'stash pop' do finally rodar, senão o pop
// devolve por cima de um working tree sujo (arquivo sem commit) e pode
// colidir se o stash original tocava o mesmo arquivo. Se o arquivo já
// existia (estava committed) antes desta rodada, `git checkout` restaura o
// conteúdo de HEAD, descartando só a escrita de agora; se não existia,
// remove com fs.rmSync -- nunca um `git clean` genérico, que poderia levar
// junto arquivos untracked de outra origem.
// `execGit` é injetável para teste isolado (default: git real via execFileSync).
function descartarEscritaNaoCommitada(caminhoArquivo, existiaAntes, execGit) {
  var exec = execGit || function (args) { return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8' }); };
  if (existiaAntes) {
    exec(['checkout', '--', caminhoArquivo]);
  } else {
    fs.rmSync(caminhoArquivo, { force: true });
  }
}

async function main() {
  console.log('Checando se o congelamento de hoje já rodou (via git, sem recalcular)...');
  if (!precisaRodarHoje()) {
    console.log('Já rodou hoje -- nada a fazer.');
    return;
  }

  const statusInicial = git(['status', '--porcelain']).trim();
  const precisaGuardar = statusInicial.length > 0;
  if (precisaGuardar) {
    git(['stash', 'push', '-u', '-m', 'congelar-tendencia-semanal.js: mudanças pendentes guardadas antes da publicação automática']);
  }

  try {
    // Estado ANTES de escrever nada nesta rodada -- se a corrida for
    // perdida (2ª checagem abaixo), é a este estado que
    // descartarEscritaNaoCommitada devolve os dois arquivos, antes do
    // 'stash pop' do finally rodar por cima.
    const snapshotExistiaAntes = fs.existsSync(CAMINHO_SNAPSHOT);
    const heartbeatExistiaAntes = fs.existsSync(CAMINHO_HEARTBEAT);

    // Lê o build corrente (já publicado) -- não busca nada online, o
    // congelamento usa exatamente o dado que a página de hoje já mostra.
    const { montarRegistrosEDemandas } = require('./build-dashboard.js');
    const { registros, demandas } = await montarRegistrosEDemandas();

    const { diaEpochDeHoje } = require('../comum/datas.js');
    const { calcularSnapshotSemanaAlvo } = require('./congelar-tendencia-semanal.js');
    const snapshot = calcularSnapshotSemanaAlvo(registros, demandas, diaEpochDeHoje());
    gravarSnapshotNoArquivo(CAMINHO_SNAPSHOT, snapshot);

    const maquina = process.env.COMPUTERNAME || 'desconhecida';
    gravarLinhaHeartbeatVolume(CAMINHO_HEARTBEAT, formatarLinhaHeartbeat({
      dataHora: new Date(), maquina: maquina, resultado: 'ok', detalhe: snapshot.chaveSemanaAlvo,
    }));

    if (!precisaRodarHoje()) {
      console.log('Outra máquina já congelou hoje enquanto rodávamos -- descartando, não vamos publicar de novo.');
      // Corrida perdida: os dois arquivos foram escritos sem commit acima.
      // Restaura o working tree ANTES do 'stash pop' do finally, senão o
      // pop roda por cima dessa sujeira (e pode colidir se o stash também
      // tocava esses arquivos).
      descartarEscritaNaoCommitada(CAMINHO_SNAPSHOT, snapshotExistiaAntes);
      descartarEscritaNaoCommitada(CAMINHO_HEARTBEAT, heartbeatExistiaAntes);
      return;
    }

    const { execFileSync: exec } = require('node:child_process');
    exec('git', ['add', 'docs/' + NOME_SNAPSHOT, 'dist/' + NOME_HEARTBEAT], { cwd: RAIZ });
    exec('git', ['commit', '-m', 'Congelamento da tendencia (semana de ' + snapshot.chaveSemanaAlvo + ', ' + maquina + ')'], { cwd: RAIZ });
    exec('git', ['push', 'origin', 'HEAD:master'], { cwd: RAIZ });
    console.log('\n=== Concluído: semana ' + snapshot.chaveSemanaAlvo + ' congelada e publicada ===');
  } finally {
    if (precisaGuardar) git(['stash', 'pop']);
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = {
  chaveSemanaSeguinteDeSexta, calcularSnapshotSemanaAlvo, gravarSnapshotNoArquivo,
  descartarEscritaNaoCommitada, main,
};
