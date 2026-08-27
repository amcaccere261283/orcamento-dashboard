'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {
  extrairConcessoesRodovias, mesclarConcessionariasExtras, CONCESSIONARIAS_EXTRA_ANTT,
} = require('./concessoes-rodovias.js');

const URL_MAPA_CONCESSOES = 'https://melhoresrodovias.org.br/mapa-de-concessoes/';
const DEST = path.join(__dirname, '..', '..', 'dist', 'concessoes-rodovias.json');

// User-Agent de navegador comum -- confirmado necessário em 2026-08-27: o fetch
// do Claude (WebFetch) tomou 403 sem ele, mas um curl/fetch puro com este UA
// devolveu HTTP 200 normalmente. Não é autenticação nem cookie -- é só o bloqueio
// de bot do site reagindo à ausência de User-Agent de navegador.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function buscarEGravar() {
  console.log('Buscando ' + URL_MAPA_CONCESSOES + '...');
  const resposta = await fetch(URL_MAPA_CONCESSOES, { headers: { 'User-Agent': USER_AGENT } });
  if (!resposta.ok) {
    throw new Error('atualizar-concessoes-rodovias: HTTP ' + resposta.status + ' buscando ' + URL_MAPA_CONCESSOES);
  }
  const html = await resposta.text();
  const daAbcr = extrairConcessoesRodovias(html);
  // Soma a lista fixa coletada manualmente da ANTT (Power BI) -- mesclarConcessionariasExtras
  // descarta as extras cujo nome já existe EXATO na ABCR (a versão da ABCR
  // vence, porque pode ter geojson de verdade); nomes só PARECIDOS continuam
  // entrando os dois -- ver o comentário de CONCESSIONARIAS_EXTRA_ANTT em
  // concessoes-rodovias.js pro porquê. Rodar este script de novo no futuro
  // (pra atualizar a lista da ABCR) NUNCA derruba essas 35 entradas -- elas
  // são código, não parte do que foi baixado.
  const dados = mesclarConcessionariasExtras(daAbcr, CONCESSIONARIAS_EXTRA_ANTT);
  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  fs.writeFileSync(DEST, JSON.stringify(dados));
  const comTrecho = dados.filter((c) => c.geojson).length;
  const anttEntrou = dados.length - daAbcr.length;
  console.log(
    'Gravado ' + DEST + ' -- ' + dados.length + ' concessionárias (' + daAbcr.length + ' da ABCR + '
    + anttEntrou + ' da lista manual ANTT, ' + (CONCESSIONARIAS_EXTRA_ANTT.length - anttEntrou)
    + ' descartada(s) por já existir com o mesmo nome na ABCR), ' + comTrecho + ' com trecho de rodovia.'
  );
  console.log('Para publicar: cp dist/concessoes-rodovias.json docs/concessoes-rodovias.json');
}

buscarEGravar().catch((erro) => {
  console.error('atualizar-concessoes-rodovias falhou:', erro.message);
  process.exitCode = 1;
});
