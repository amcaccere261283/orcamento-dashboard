'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Reconstrói e publica o dashboard de orçamento sozinho, uma vez por dia
// (Task Scheduler, só na máquina que enxerga a MATRIZ -- ver CLAUDE.md,
// "Atualização diária do orçamento"). Separado da rotina escalonada da
// página semanal de propósito: aquela roda na 1ª das 3 máquinas que
// conseguir (quase sempre a do Patrick) e as outras pulam o dia, e só a
// máquina do dono tem a MATRIZ em G:\Meu Drive. Não depende de Chrome nem
// do sond.com.br -- só da MATRIZ, da linha de base e da senha.
//
// O que isso destrava: dist/backlog-2026-online.csv (realizado + tendência
// 2026 por SUP) e dist/demandas-contratado-online.csv andam todo dia, e o
// workflow agendado das medições (matriz-equipes-source) lê os dois daqui.
//
// Uso: ORCAMENTO_SENHA='...' node tools/orcamento/atualizar-orcamento-diario.js

const RAIZ = path.join(__dirname, '..', '..');
const ARQUIVOS = [
  'dist/orcamento-dashboard.html',
  'docs/index.html',
  'dist/backlog-2026-online.csv',
  'dist/demandas-contratado-online.csv',
];

function git(args) {
  return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8' });
}

// Mesmo padrão de publicar() em tools/semanal/atualizar-arquivos.js: empurra
// HEAD como master e, se outra máquina publicou no meio (a rotina semanal
// usa o mesmo master), busca, rebaseia e tenta de novo. Conflito de verdade
// aborta alto.
function publicar() {
  const TENTATIVAS = 3;
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    try {
      git(['push', 'origin', 'HEAD:master']);
      console.log('Publicado (git push origin HEAD:master).');
      return;
    } catch (err) {
      if (tentativa === TENTATIVAS) throw new Error(`Não consegui publicar depois de ${TENTATIVAS} tentativas -- ${err.message}`);
      console.warn(`Push rejeitado (tentativa ${tentativa}/${TENTATIVAS}) -- buscando e rebaseando...`);
      git(['fetch', 'origin', 'master']);
      try {
        git(['rebase', 'origin/master']);
      } catch (errRebase) {
        try { git(['rebase', '--abort']); } catch { /* nenhum rebase em andamento */ }
        throw new Error(`Rebase sobre origin/master falhou. Erro original: ${errRebase.message}`);
      }
    }
  }
}

function main() {
  console.log(`=== Atualização diária do orçamento -- ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} ===`);
  if (!process.env.ORCAMENTO_SENHA) {
    throw new Error('Defina ORCAMENTO_SENHA (variável de ambiente persistente do usuário) -- a senha nunca fica em arquivo do repositório.');
  }
  const config = require('./config.js');
  if (!fs.existsSync(config.caminhoArquivo)) {
    throw new Error(`MATRIZ não encontrada em ${config.caminhoArquivo} -- o Google Drive para computador está aberto nesta máquina? (caminho sobreponível por ORCAMENTO_CAMINHO_MATRIZ)`);
  }

  // Working tree sujo por algo alheio travaria o rebase -- guarda e devolve
  // no fim, mesmo cuidado de atualizar-arquivos.js.
  const precisaGuardar = git(['status', '--porcelain']).trim().length > 0;
  if (precisaGuardar) {
    console.log('Há mudanças não commitadas alheias a este script -- guardando com git stash.');
    git(['stash', 'push', '-u', '-m', 'atualizar-orcamento-diario.js: mudanças pendentes guardadas antes da publicação automática']);
  }
  try {
    git(['fetch', 'origin', 'master']);
    git(['rebase', 'origin/master']);

    const { build } = require('./build-dashboard.js');
    build();
    fs.copyFileSync(path.join(RAIZ, 'dist', 'orcamento-dashboard.html'), path.join(RAIZ, 'docs', 'index.html'));

    git(['add', ...ARQUIVOS]);
    if (!git(['status', '--porcelain', '--', ...ARQUIVOS]).trim()) {
      console.log('Nada mudou -- não há o que publicar.');
      return;
    }
    const horario = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    git(['commit', '-m', `Atualização diária do orçamento (${horario}, ${process.env.COMPUTERNAME || 'desconhecida'})`]);
    publicar();
    console.log('=== Concluído ===');
  } finally {
    if (precisaGuardar) {
      console.log('Devolvendo as mudanças guardadas (git stash pop).');
      git(['stash', 'pop']);
    }
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

module.exports = { main };
