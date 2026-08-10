'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

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

const BUSCAS = [
  { nome: 'Avanços (furos)', modulo: './atualizar-avancos-online.js' },
  { nome: 'Demandas de sondagem (furos não executados)', modulo: './atualizar-demandas-sondagem-online.js' },
  { nome: 'Lab Realizado (ensaios)', modulo: './atualizar-lab-online.js' },
  { nome: 'Demandas de LAB.C/LAB.E (backlog)', modulo: './atualizar-demandas-lab-online.js' },
  { nome: 'Equipes', modulo: './atualizar-equipes-online.js' },
];

// Mesmos pares que test/publicacao-docs-sincronizado.test.js trava pra esta
// página (o par orcamento-dashboard.html/index.html do teste é do outro
// dashboard e fica fora do escopo deste script). demandas-sondagem-online.csv
// e demandas-lab-online.json ficam de fora daqui de propósito: só alimentam
// o build a partir de dist/ (Task 12), o botão "Atualizar dados" da página
// publicada não os busca diretamente -- ver Task 13.
const ARQUIVOS_PUBLICAR = [
  'planejamento-semanal.html',
  'avancos-online.csv',
  'lab-online.csv',
  'equipes-online.csv',
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

async function main() {
  if (!process.env.ORCAMENTO_SENHA) {
    throw new Error(
      'Defina ORCAMENTO_SENHA antes de rodar (a senha nunca fica em arquivo do repositório) -- ex.: '
      + "ORCAMENTO_SENHA='...' node tools/semanal/atualizar-arquivos.js"
    );
  }

  console.log('Buscando dados novos do sond.com.br -- exige Chrome aberto com --remote-debugging-port=9222, já logado.');
  const resultadosBuscas = await rodarBuscas();

  console.log('\n=== Reconstruindo a página (build-dashboard.js) ===');
  const { build } = require('./build-dashboard.js');
  await build();

  console.log('\n=== Publicando em docs/ ===');
  let algumaCopia = false;
  const arquivosParaGit = [];
  for (const nome of ARQUIVOS_PUBLICAR) {
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
    relatarResumo(resultadosBuscas);
    return;
  }

  console.log('\n=== git add / commit / push ===');
  git(['add', ...arquivosParaGit]);
  const status = git(['status', '--porcelain', '--', ...arquivosParaGit]).trim();
  if (!status) {
    console.log('git: nada ficou staged (os arquivos copiados já estavam commitados) -- pulando commit/push.');
    relatarResumo(resultadosBuscas);
    return;
  }

  const horario = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const falhas = resultadosBuscas.filter((r) => !r.ok);
  const mensagem = `Atualizar arquivos online (${horario})`
    + (falhas.length ? `\n\nFalha na busca de: ${falhas.map((f) => `${f.nome} (${f.erro})`).join('; ')}` : '');
  git(['commit', '-m', mensagem]);
  console.log('Commit criado.');

  git(['push', 'origin', 'master']);
  console.log('Publicado (git push origin master).');

  relatarResumo(resultadosBuscas);
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { main };
