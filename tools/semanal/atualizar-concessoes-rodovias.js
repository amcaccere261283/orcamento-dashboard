'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {
  extrairConcessoesRodovias, mesclarConcessionariasExtras, CONCESSIONARIAS_EXTRA_ANTT,
} = require('./concessoes-rodovias.js');

const URL_MAPA_CONCESSOES = 'https://melhoresrodovias.org.br/mapa-de-concessoes/';
const DEST = path.join(__dirname, '..', '..', 'dist', 'concessoes-rodovias.json');

// "Ecovias Raposo Castello" (id "40" na ABCR) nunca tem geojson em ROADS --
// não é falha do scraper, a própria ABCR não publica o traçado dela (rodovia
// ESTADUAL de SP, fora do padrão federal do resto do site). Resolvido à parte
// via OSM em atualizar-tracado-raposo-castello.js -- ver o comentário lá.
// Aplicado só quando o valor vier null da ABCR, pra uma eventual publicação
// futura do traçado real por lá continuar vencendo.
const ID_RAPOSO_CASTELLO = '40';
const TRACADO_RAPOSO_CASTELLO = require('./tracado-raposo-castello-resolvido.json');

// RioSP tem SUPs em duas rodovias diferentes (BR-101 e BR-116) dentro da
// MESMA concessão -- pedido do usuário em 2026-08-28: separar visualmente
// as duas em vez de uma linha só misturando as duas rodovias. Como o
// geojson único da ABCR não marca qual feature é de qual BR, a solução foi
// resolver as duas SEPARADAS via DNIT (atualizar-tracado-riosp-por-
// rodovia.js) e injetá-las aqui como duas concessionárias SINTÉTICAS --
// vinculo-sup-concessionaria.js aponta os 3 SUPs confirmados pra elas em
// vez da RioSP genérica (id "13", que continua existindo pra qualquer SUP
// da RioSP que não tenha essa confirmação manual).
const TRACADO_RIOSP_POR_RODOVIA = require('./tracado-riosp-por-rodovia-resolvido.json');
const CONCESSOES_SINTETICAS_RIOSP = [
  { id: 'riosp-br-101', nome: 'RioSP (BR-101)', slug: null, cor: null, geojson: TRACADO_RIOSP_POR_RODOVIA['riosp-br-101'] },
  { id: 'riosp-br-116', nome: 'RioSP (BR-116)', slug: null, cor: null, geojson: TRACADO_RIOSP_POR_RODOVIA['riosp-br-116'] },
];

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
  const raposoCastello = dados.find((c) => c.id === ID_RAPOSO_CASTELLO);
  if (raposoCastello && !raposoCastello.geojson) raposoCastello.geojson = TRACADO_RAPOSO_CASTELLO;
  // As sintéticas entram só se ainda não existirem (idempotente -- rodar
  // este script de novo não duplica) e são ordenadas junto com o resto.
  CONCESSOES_SINTETICAS_RIOSP.forEach((sintetica) => {
    if (!dados.find((c) => c.id === sintetica.id)) dados.push(sintetica);
  });
  dados.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
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
