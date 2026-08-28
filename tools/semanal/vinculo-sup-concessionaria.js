'use strict';

// Vincula SUP -> concessionária (rodovia), pra aba Mapa desenhar a linha da
// rodovia em vez de um pino solto -- ver
// docs/superpowers/specs/2026-08-26-alocacao-equipes-mapa-design.md (pedido
// do usuário em 2026-08-28: trocar pino+cartão flutuante por rodovia
// visível + popup ao passar o mouse).
//
// Casa `registro.tomador` (MATRIZ, já existente) contra `nome` de cada
// concessionária de concessoes-rodovias.json, por IGUALDADE EXATA depois de
// normalizar (minúsculas, sem acento, sem espaço, sem sufixo de razão
// social "S.A"/"S/A"/"LTDA") -- NUNCA por prefixo/substring. "Rota
// Sorocabana" não vira "Sorocabana" por aproximação (ficaria sem rodovia,
// igual a qualquer tomador sem correspondência real) -- mesmo padrão "só
// igualdade exata" já estabelecido em concessoes-rodovias.js/parse-
// medicoes.js. Medido contra os dados reais em 2026-08-28: normalizar
// resolve ~23 dos 35 SUPs (contra 14 num match cru sem normalização) --
// as diferenças eram só maiúscula ("AutoBan"/"Autoban"), acento ("EPR
// Triângulo"/"EPR Triangulo"), espaço ("Via Sul"/"ViaSul") e sufixo de
// razão social ("Via Araucária S.A"/"Via Araucária").
//
// Uma concessionária pode ter MAIS DE UM SUP (ex.: "Pantanal" = SUP-6806-23
// + SUP-8187-25, confirmado nos dados reais) -- o retorno reflete isso como
// lista, nunca assume 1:1.

var SUFIXOS_RAZAO_SOCIAL = [' s.a.', ' s.a', ' s/a', ' ltda.', ' ltda'];

// Sinônimos CONFIRMADOS manualmente (nunca inferidos por aproximação) --
// tomador normalizado -> nome de concessão normalizado. Cada entrada aqui é
// uma correspondência que o dono do projeto verificou pessoalmente ser a
// MESMA concessão, apesar do texto do Tomador na MATRIZ não bater exato com
// o nome cadastrado na ABCR/ANTT. "Rota Sorocabana" (2026-08-28): SUP-8370-25
// usa esse nome comercial na MATRIZ, mas a ABCR cadastra a concessão só como
// "Sorocabana" -- confirmado que é a mesma empresa antes de entrar aqui.
// Nunca adicionar uma entrada por suposição/prefixo comum -- só depois de
// confirmação explícita, um caso de cada vez.
var SINONIMOS_TOMADOR_CONFIRMADOS = {
  rotasorocabana: 'sorocabana',
};

function normalizarNomeConcessao(nome) {
  var texto = String(nome || '').toLowerCase().trim();
  SUFIXOS_RAZAO_SOCIAL.forEach(function (sufixo) {
    if (texto.slice(-sufixo.length) === sufixo) texto = texto.slice(0, -sufixo.length).trim();
  });
  return texto
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/\s+/g, ''); // remove todo espaço (compara "Via Sul" com "ViaSul")
}

// registros: os de sempre (registro.sup/registro.tomador). concessoes: o
// array de concessoes-rodovias.json (ou dist/docs equivalente), só entram
// as que têm geojson (sem traçado não há o que desenhar, mesmo com match).
//
// Devolve { concessaoIdPorSup: {sup: id}, supsPorConcessaoId: {id: [sup,...]} }.
// SUP sem tomador reconhecido em nenhuma concessionária simplesmente não
// aparece em nenhum dos dois -- nunca lança, nunca adivinha.
function vincularSupsAConcessoes(registros, concessoes) {
  var porNomeNormalizado = {};
  (concessoes || []).forEach(function (c) {
    if (!c.geojson) return;
    var chave = normalizarNomeConcessao(c.nome);
    // Primeira concessionária com este nome normalizado vence -- não
    // deveria colidir na prática (81 nomes bem distintos mesmo depois de
    // normalizar), mas "primeira vence" é o mesmo padrão conservador do
    // resto do pipeline (coordenadas-sup.js, mesclarConcessionariasExtras).
    if (!porNomeNormalizado[chave]) porNomeNormalizado[chave] = c;
  });

  var concessaoIdPorSup = {};
  var supsPorConcessaoId = {};
  var supsVistos = {};
  (registros || []).forEach(function (r) {
    if (!r.sup || supsVistos[r.sup]) return; // 1ª ocorrência do SUP decide -- mesmo padrão de coordenadas-sup.js
    supsVistos[r.sup] = true;
    var chave = normalizarNomeConcessao(r.tomador || '');
    if (chave && SINONIMOS_TOMADOR_CONFIRMADOS[chave]) chave = SINONIMOS_TOMADOR_CONFIRMADOS[chave];
    var concessao = chave ? porNomeNormalizado[chave] : null;
    if (!concessao) return;
    concessaoIdPorSup[r.sup] = concessao.id;
    if (!supsPorConcessaoId[concessao.id]) supsPorConcessaoId[concessao.id] = [];
    supsPorConcessaoId[concessao.id].push(r.sup);
  });

  return { concessaoIdPorSup: concessaoIdPorSup, supsPorConcessaoId: supsPorConcessaoId };
}

module.exports = { normalizarNomeConcessao, vincularSupsAConcessoes };
