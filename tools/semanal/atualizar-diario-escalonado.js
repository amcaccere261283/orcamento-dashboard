'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  parseHeartbeatVolume, jaAtualizadoHoje, decidirResultado, formatarLinhaHeartbeat,
  formatarAvisoAtualizacao, gravarLinhaHeartbeatVolume,
} = require('./coordenacao-volume.js');
const { rodarBuscas, publicarArquivos, ARQUIVOS_PUBLICAR } = require('./atualizar-arquivos.js');

// Versão escalonada de atualizar-arquivos.js -- roda nas 3 máquinas
// (Patrick/Kairo/Américo), cada uma num horário diferente do Task
// Scheduler (ver docs/setup-atualizacao-escalonada.md), mas com o MESMO
// script: quem decide se roda é a checagem abaixo, não uma flag de "quem
// sou eu". Ver docs/superpowers/specs/2026-08-18-atualizacao-diaria-escalonada-design.md.

const RAIZ = path.join(__dirname, '..', '..');
const CAMINHO_HEARTBEAT_VOLUME = path.join(RAIZ, 'dist', 'heartbeat-atualizacao-volume.csv');
const NOME_HEARTBEAT_VOLUME = 'heartbeat-atualizacao-volume.csv';

function git(args) {
  return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8' });
}

// Lê o heartbeat de coordenação de origin/master, sem mesclar nada
// localmente -- só precisamos SABER se já rodou hoje, não trazer o
// arquivo pra árvore de trabalho ainda (isso acontece só se decidirmos
// rodar, via publicarArquivos -> git add, mais adiante).
function lerHeartbeatDoOrigin() {
  try {
    const texto = git(['show', `origin/master:dist/${NOME_HEARTBEAT_VOLUME}`]);
    return parseHeartbeatVolume(texto);
  } catch (err) {
    // Arquivo ainda não existe no origin (1ª execução deste mecanismo) --
    // trata como "nunca atualizado". Também cai aqui se o remote estiver
    // mal configurado, o que é bem diferente: por isso o aviso.
    console.warn('Aviso: git show falhou (' + err.message + ') -- tratando como "nunca atualizado". Se isso persistir, confira a configuração do remote.');
    return [];
  }
}

// true = ainda NÃO foi atualizado com sucesso hoje, precisa rodar.
//
// Chamada em DOIS momentos (ver o design): no início, pra decidir se vale a
// pena começar, e de novo depois do build, logo antes de publicar. A segunda
// checagem é o que fecha a corrida real entre as máquinas: as 5 buscas + o
// build levam bem mais que os 15min que separam os horários agendados, então
// Kairo (8h15) pode perfeitamente começar enquanto Patrick (8h) ainda está
// rodando -- sem a re-checagem os dois publicariam, o CSV de heartbeat
// conflitaria no rebase e quem perdesse a corrida ficaria travado.
function precisaAtualizarHoje() {
  try {
    git(['fetch', 'origin', 'master']);
  } catch (err) {
    // Rede fora bem nesse instante não pode derrubar a execução inteira: o
    // resto do fluxo já trata "não sei" como "melhor rodar". Segue com o que
    // estiver em cache do último fetch bem-sucedido.
    console.warn('Aviso: git fetch origin master falhou (' + err.message + ') -- seguindo com o que já está em cache local.');
  }
  return !jaAtualizadoHoje(lerHeartbeatDoOrigin());
}

async function main() {
  if (!process.env.ORCAMENTO_SENHA) {
    throw new Error(
      'Defina ORCAMENTO_SENHA antes de rodar (a senha nunca fica em arquivo do repositório) -- ex.: '
      + "ORCAMENTO_SENHA='...' node tools/semanal/atualizar-diario-escalonado.js"
    );
  }

  console.log('Checando (via git, sem abrir Chrome) se já houve atualização com sucesso hoje...');
  if (!precisaAtualizarHoje()) {
    console.log(`Já atualizado hoje (${formatarAvisoAtualizacao(lerHeartbeatDoOrigin())}) -- nada a fazer.`);
    return;
  }
  console.log('Ainda não atualizado hoje (ou a última tentativa falhou) -- prosseguindo.');

  // Mesma guarda de working tree sujo que atualizar-arquivos.js já usa --
  // ver o comentário lá (main(), início do try).
  const statusInicial = git(['status', '--porcelain']).trim();
  const precisaGuardar = statusInicial.length > 0;
  if (precisaGuardar) {
    console.log('\nHá mudanças não commitadas alheias a este script -- guardando com git stash antes de operar.');
    git(['stash', 'push', '-u', '-m', 'atualizar-diario-escalonado.js: mudanças pendentes guardadas antes da publicação automática']);
  }

  try {
    console.log('Buscando dados novos do sond.com.br -- exige Chrome aberto com --remote-debugging-port=9222, já logado.');
    const resultadosBuscas = await rodarBuscas();
    const { resultado, detalhe } = decidirResultado(resultadosBuscas);
    console.log(`Resultado desta execução: ${resultado}${detalhe ? ` (${detalhe})` : ''}.`);

    const maquina = process.env.COMPUTERNAME || 'desconhecida';
    gravarLinhaHeartbeatVolume(
      CAMINHO_HEARTBEAT_VOLUME,
      formatarLinhaHeartbeat({ dataHora: new Date(), maquina, resultado, detalhe })
    );

    console.log('\n=== Reconstruindo a página (build-dashboard.js) ===');
    const { build } = require('./build-dashboard.js');
    await build();

    const horario = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const mensagem = `Atualização escalonada (${horario}, ${maquina}, ${resultado})`
      + (detalhe ? `\n\nFalha na busca de: ${detalhe}` : '');

    // Re-checagem antes de publicar: o trabalho acima leva minutos (bem mais
    // que os 15min entre os horários agendados), então outra máquina pode ter
    // publicado no meio do caminho. Publicar agora criaria o conflito de
    // rebase no heartbeat que este mecanismo existe pra evitar.
    if (!precisaAtualizarHoje()) {
      console.log('Outra máquina publicou enquanto rodávamos -- descartando este trabalho local, não vamos publicar de novo.');
      return;
    }

    // Set: desde 2026-08-18 o heartbeat também está em ARQUIVOS_PUBLICAR (pro
    // comando manual publicá-lo) -- sem dedupe ele apareceria duas vezes aqui.
    publicarArquivos([...new Set([...ARQUIVOS_PUBLICAR, NOME_HEARTBEAT_VOLUME])], mensagem);

    console.log(resultado === 'ok' ? '\n=== Concluído com sucesso ===' : '\n=== Concluído, mas todas as 5 buscas falharam (heartbeat registrado como "falhou" -- a próxima máquina da fila vai tentar) ===');
  } finally {
    if (precisaGuardar) {
      console.log('\nDevolvendo as mudanças pendentes guardadas no início (git stash pop).');
      git(['stash', 'pop']);
    }
  }
}

// --checar: só responde "precisa rodar?" pelo código de saída, sem abrir
// Chrome nem buscar nada. O wrapper .ps1 usa isso ANTES de abrir o Chrome --
// sem ele, todo disparo que deveria só pular abria uma janela à toa.
// Código 0 = já atualizado hoje, pode pular; 1 = precisa rodar OU a checagem
// deu erro (em caso de dúvida, roda -- nunca fica preso pulando por engano).
if (require.main === module) {
  if (process.argv.includes('--checar')) {
    try {
      const precisa = precisaAtualizarHoje();
      console.log(precisa ? 'PRECISA_ATUALIZAR' : 'JA_ATUALIZADO');
      process.exit(precisa ? 1 : 0);
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  } else {
    main().catch((err) => { console.error(err); process.exit(1); });
  }
}

module.exports = { main, precisaAtualizarHoje };
