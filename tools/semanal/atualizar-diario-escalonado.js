'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  parseHeartbeatVolume, jaAtualizadoHoje, decidirResultado, formatarLinhaHeartbeat,
  CABECALHO_HEARTBEAT_VOLUME,
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
    // trata como "nunca atualizado".
    return [];
  }
}

function gravarLinhaHeartbeat(linha) {
  fs.mkdirSync(path.dirname(CAMINHO_HEARTBEAT_VOLUME), { recursive: true });
  if (!fs.existsSync(CAMINHO_HEARTBEAT_VOLUME)) {
    fs.writeFileSync(CAMINHO_HEARTBEAT_VOLUME, CABECALHO_HEARTBEAT_VOLUME + '\n');
  }
  fs.appendFileSync(CAMINHO_HEARTBEAT_VOLUME, linha + '\n');
}

async function main() {
  if (!process.env.ORCAMENTO_SENHA) {
    throw new Error(
      'Defina ORCAMENTO_SENHA antes de rodar (a senha nunca fica em arquivo do repositório) -- ex.: '
      + "ORCAMENTO_SENHA='...' node tools/semanal/atualizar-diario-escalonado.js"
    );
  }

  console.log('Checando (via git, sem abrir Chrome) se já houve atualização com sucesso hoje...');
  git(['fetch', 'origin', 'master']);
  const linhasOrigin = lerHeartbeatDoOrigin();
  if (jaAtualizadoHoje(linhasOrigin)) {
    console.log('Já atualizado hoje por outra máquina -- nada a fazer.');
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
    gravarLinhaHeartbeat(formatarLinhaHeartbeat({ dataHora: new Date(), maquina, resultado, detalhe }));

    console.log('\n=== Reconstruindo a página (build-dashboard.js) ===');
    const { build } = require('./build-dashboard.js');
    await build();

    const horario = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const mensagem = `Atualização escalonada (${horario}, ${maquina}, ${resultado})`
      + (detalhe ? `\n\nFalha na busca de: ${detalhe}` : '');

    publicarArquivos([...ARQUIVOS_PUBLICAR, NOME_HEARTBEAT_VOLUME], mensagem);

    console.log(resultado === 'ok' ? '\n=== Concluído com sucesso ===' : '\n=== Concluído, mas todas as 5 buscas falharam (heartbeat registrado como "falhou" -- a próxima máquina da fila vai tentar) ===');
  } finally {
    if (precisaGuardar) {
      console.log('\nDevolvendo as mudanças pendentes guardadas no início (git stash pop).');
      git(['stash', 'pop']);
    }
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { main };
