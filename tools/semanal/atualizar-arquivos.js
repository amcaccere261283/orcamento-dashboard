'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  decidirResultado, formatarLinhaHeartbeat, gravarLinhaHeartbeatVolume,
} = require('./coordenacao-volume.js');

// Atalho local pro pedido original (2026-08-07) de um botão "Atualizar
// arquivos" na própria página publicada: não dá pra existir de verdade --
// planejamento-semanal.html é HTML estático no GitHub Pages, e as buscas
// abaixo são processos Node que precisam de Chrome aberto com
// --remote-debugging-port=9222 já logado em sond.com.br (ver CLAUDE.md,
// "Atualizar os dados"). JS de página nenhuma consegue disparar isso na
// máquina de quem só está VENDO a página publicada. Este script substitui o
// botão: os mesmos comandos manuais (5 desde a Task 12/13 -- avanços,
// demandas de sondagem, lab, demandas de lab, equipes) + o build + a cópia
// pra docs/ + commit + push, numa chamada só, pra rodar ANTES de usar
// "Atualizar dados" na página (que só troca dados já publicados, nunca
// busca nada sozinho).
//
// Uso: ORCAMENTO_SENHA='...' node tools/semanal/atualizar-arquivos.js
//
// Cada busca já se protege sozinha (não sobrescreve o CSV bom em dist/ com
// um vazio/malformado -- ver o guard de "mês corrente falhou -> aborta sem
// gravar" em atualizar-avancos-online.js e atualizar-lab-online.js; a
// TAXA_SUCESSO_MINIMA citada aqui até 2026-08-10 não existe mais desde que a
// busca deixou de ser por contrato e passou a ser por mês) -- por isso a
// falha de UMA busca aqui não
// aborta as outras nem o build: build-dashboard.js sempre lê o que já está
// em dist/, novo ou de um run anterior. Só aborta cedo se ORCAMENTO_SENHA
// não estiver definida (build não roda sem ela de qualquer forma).

const RAIZ = path.join(__dirname, '..', '..');
const DIST = path.join(RAIZ, 'dist');
const DOCS = path.join(RAIZ, 'docs');
const CAMINHO_HEARTBEAT_VOLUME = path.join(DIST, 'heartbeat-atualizacao-volume.csv');

const BUSCAS = [
  { nome: 'Avanços (furos)', modulo: './atualizar-avancos-online.js' },
  { nome: 'Demandas de sondagem (furos não executados)', modulo: './atualizar-demandas-sondagem-online.js' },
  { nome: 'Lab Realizado (ensaios)', modulo: './atualizar-lab-online.js' },
  { nome: 'Demandas de LAB.C/LAB.E (backlog)', modulo: './atualizar-demandas-lab-online.js' },
  { nome: 'Equipes', modulo: './atualizar-equipes-online.js' },
];

// Mesmos pares que test/publicacao-docs-sincronizado.test.js trava pra esta
// página.
//
// demandas-sondagem-online.csv e demandas-lab-online.json ENTRARAM aqui em
// 2026-08-10 -- até então só alimentavam o build a partir de dist/ (Task 12),
// e o botão "Atualizar dados" nunca os buscava (Task 13, decisão antiga).
// Isso era o bug mais grave achado na auditoria de 2026-08-10: o refresh
// recalculava Demandas Pendentes SEM o backlog (5.493 furos pendentes de
// sondagem + 12.781 ensaios pendentes de lab, medidos em 2026-08-10), e o
// estoque despencava pra perto de zero com o status mostrando "Atualizado"
// em verde -- sem erro nenhum. Publicar os dois arquivos é o que permite ao
// botão buscá-los -- ver tools/semanal/live-refresh.js
// (URL_ESPELHO_DEMANDAS_SONDAGEM_SEMANAL/URL_ESPELHO_DEMANDAS_LAB_SEMANAL).
const ARQUIVOS_PUBLICAR = [
  'planejamento-semanal.html',
  'alocacao-equipes.html',
  'avancos-online.csv',
  'lab-online.csv',
  'equipes-online.csv',
  'equipes-roster-online.csv',
  'demandas-sondagem-online.csv',
  'demandas-lab-online.json',
  // Heartbeat de coordenação (2026-08-18): build-dashboard.js lê este CSV pro
  // aviso "Atualizado às HH:MM por Fulano" no cabeçalho da página. Publicá-lo
  // aqui mantém o aviso coerente quando alguém roda o comando manual, e de
  // quebra faz a rodada escalonada seguinte enxergar que hoje já foi
  // atualizado e pular.
  'heartbeat-atualizacao-volume.csv',
];

async function rodarBuscas() {
  const resultados = [];
  for (const busca of BUSCAS) {
    console.log(`\n=== ${busca.nome} ===`);
    try {
      await require(busca.modulo).main();
      resultados.push({ nome: busca.nome, ok: true });
    } catch (err) {
      console.error(`FALHOU: ${busca.nome} -- ${err.message}`);
      resultados.push({ nome: busca.nome, ok: false, erro: err.message });
    }
  }
  return resultados;
}

function git(args) {
  return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8' });
}

function relatarResumo(resultadosBuscas) {
  console.log('\n=== Resumo das buscas ===');
  resultadosBuscas.forEach((r) => {
    console.log(`${r.ok ? 'OK    ' : 'FALHOU'} ${r.nome}${r.ok ? '' : ' -- ' + r.erro}`);
  });
}

// Publica HEAD como master no origin, não a branch local literal "master" --
// este repositório roda de branches de trabalho (ex.:
// semanal-alocacao-equipes-rebase) que ficam à frente de origin/master, e a
// branch local "master" fica parada, muito atrás (ver CLAUDE.md do
// orçamento, "Orçamento branch de publicação" nas memórias do projeto:
// medido em 2026-08-13, 332 commits atrás). `git push origin master` nesse
// cenário empurra o ref ERRADO e é rejeitado por non-fast-forward mesmo
// quando HEAD está perfeitamente à frente de origin/master.
//
// Roda em até 3 máquinas agendadas no mesmo horário (ver
// docs/setup-nova-maquina.md): se outra já publicou hoje, o push é rejeitado
// por non-fast-forward genuíno (origin avançou de verdade) -- busca e
// rebase em cima antes de tentar de novo, mesmo padrão de retry que
// alertas-email.yml já usa para a mesma corrida. Rebase falhando de
// verdade (conflito real, não só "origin andou") aborta com erro alto: gerar
// e publicar de novo do zero não corrige um conflito de merge.
function publicar() {
  const TENTATIVAS = 3;
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    try {
      git(['push', 'origin', 'HEAD:master']);
      console.log('Publicado (git push origin HEAD:master).');
      return;
    } catch (err) {
      if (tentativa === TENTATIVAS) {
        throw new Error(`Não consegui publicar depois de ${TENTATIVAS} tentativas -- ${err.message}`);
      }
      console.warn(`Push rejeitado (tentativa ${tentativa}/${TENTATIVAS}) -- outra máquina deve ter publicado primeiro. Buscando e rebaseando...`);
      git(['fetch', 'origin', 'master']);
      try {
        git(['rebase', 'origin/master']);
      } catch (errRebase) {
        // O rebase pode falhar por dois motivos bem diferentes: conflito de
        // verdade (rebase EM ANDAMENTO, precisa de --abort) ou nem chegou a
        // começar (ex.: "You have unstaged changes" -- working tree sujo por
        // algo alheio a este script). 'rebase --abort' sem rebase em
        // andamento falha com "no rebase in progress" e essa falha SUBSTITUÍA
        // o erro original no throw, escondendo a causa real -- medido em
        // 2026-08-13 com uma edição pendente de CLAUDE.md no working tree.
        try { git(['rebase', '--abort']); } catch { /* nenhum rebase em andamento pra abortar -- ok */ }
        throw new Error(`Rebase sobre origin/master falhou -- abortado se havia algo em andamento. Erro original: ${errRebase.message}`);
      }
    }
  }
}

// Copia os arquivos de dist/ pra docs/ (só os que mudaram), commita e publica.
// Extraído de main() em 2026-08-18 pra ser reaproveitado por
// atualizar-diario-escalonado.js, que decide os arquivos e a mensagem de
// commit de um jeito um pouco diferente (inclui o heartbeat de coordenação).
function publicarArquivos(nomes, mensagemCommit) {
  console.log('\n=== Publicando em docs/ ===');
  let algumaCopia = false;
  const arquivosParaGit = [];
  for (const nome of nomes) {
    const origem = path.join(DIST, nome);
    const alvo = path.join(DOCS, nome);
    if (!fs.existsSync(origem)) {
      console.warn(`Pulando ${nome}: não existe em dist/.`);
      continue;
    }
    arquivosParaGit.push(path.join('dist', nome), path.join('docs', nome));
    const bufOrigem = fs.readFileSync(origem);
    const bufAlvo = fs.existsSync(alvo) ? fs.readFileSync(alvo) : null;
    if (bufAlvo && bufOrigem.equals(bufAlvo)) {
      console.log(`${nome}: já estava igual em docs/, nada a copiar.`);
      continue;
    }
    fs.copyFileSync(origem, alvo);
    algumaCopia = true;
    console.log(`Copiado: dist/${nome} -> docs/${nome}`);
  }

  if (!algumaCopia) {
    console.log('\nNada mudou -- docs/ já estava sincronizado com dist/. Não há o que commitar.');
    return { publicou: false };
  }

  console.log('\n=== git add / commit / push ===');
  git(['add', ...arquivosParaGit]);
  const status = git(['status', '--porcelain', '--', ...arquivosParaGit]).trim();
  if (!status) {
    console.log('git: nada ficou staged (os arquivos copiados já estavam commitados) -- pulando commit/push.');
    return { publicou: false };
  }

  git(['commit', '-m', mensagemCommit]);
  console.log('Commit criado.');
  publicar();
  return { publicou: true };
}

async function main() {
  if (!process.env.ORCAMENTO_SENHA) {
    throw new Error(
      'Defina ORCAMENTO_SENHA antes de rodar (a senha nunca fica em arquivo do repositório) -- ex.: '
      + "ORCAMENTO_SENHA='...' node tools/semanal/atualizar-arquivos.js"
    );
  }

  // Roda sem ninguém olhando (Task Scheduler, 8h) -- qualquer coisa alheia
  // já modificada no working tree (uma edição de doc em andamento, por
  // exemplo) bloquearia 'git rebase' mais adiante com "You have unstaged
  // changes" e derrubaria a publicação de dados por causa de um arquivo que
  // este script nem toca. Guarda de lado ANTES de mexer em qualquer coisa e
  // devolve no fim, sucesso ou falha -- mesmo passo que uma sessão manual
  // faria à mão (medido em 2026-08-13: CLAUDE.md com edição pendente).
  const statusInicial = git(['status', '--porcelain']).trim();
  const precisaGuardar = statusInicial.length > 0;
  if (precisaGuardar) {
    console.log('\nHá mudanças não commitadas alheias a este script -- guardando com git stash antes de operar.');
    git(['stash', 'push', '-u', '-m', 'atualizar-arquivos.js: mudanças pendentes guardadas antes da publicação automática']);
  }
  try {
    console.log('Buscando dados novos do sond.com.br -- exige Chrome aberto com --remote-debugging-port=9222, já logado.');
    const resultadosBuscas = await rodarBuscas();

    // Mesma linha de heartbeat que atualizar-diario-escalonado.js grava. Sem
    // isso, uma atualização manual às 15h publicava a página com o aviso
    // "Atualizado às 08:00 por Patrick" no cabeçalho, apesar do dado fresco --
    // build-dashboard.js sempre lê este CSV, e só a rodada escalonada
    // escrevia nele.
    const { resultado, detalhe } = decidirResultado(resultadosBuscas);
    const maquina = process.env.COMPUTERNAME || 'desconhecida';
    gravarLinhaHeartbeatVolume(
      CAMINHO_HEARTBEAT_VOLUME,
      formatarLinhaHeartbeat({ dataHora: new Date(), maquina, resultado, detalhe })
    );

    console.log('\n=== Reconstruindo a página (build-dashboard.js) ===');
    const { build } = require('./build-dashboard.js');
    await build();

    const horario = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const falhas = resultadosBuscas.filter((r) => !r.ok);
    const mensagem = `Atualizar arquivos online (${horario})`
      + (falhas.length ? `\n\nFalha na busca de: ${falhas.map((f) => `${f.nome} (${f.erro})`).join('; ')}` : '');

    publicarArquivos(ARQUIVOS_PUBLICAR, mensagem);

    relatarResumo(resultadosBuscas);
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

module.exports = { main, rodarBuscas, publicarArquivos, ARQUIVOS_PUBLICAR };
