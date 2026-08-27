'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { extrairConcessoesRodovias } = require('./concessoes-rodovias.js');

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
  const dados = extrairConcessoesRodovias(html);
  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  fs.writeFileSync(DEST, JSON.stringify(dados));
  const comTrecho = dados.filter((c) => c.geojson).length;
  console.log(
    'Gravado ' + DEST + ' -- ' + dados.length + ' concessionárias, ' + comTrecho + ' com trecho de rodovia.'
  );
}

buscarEGravar().catch((erro) => {
  console.error('atualizar-concessoes-rodovias falhou:', erro.message);
  process.exitCode = 1;
});
