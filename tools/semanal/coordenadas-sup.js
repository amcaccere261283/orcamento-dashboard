'use strict';

// Resolvedor TOLERANTE de coordenada por SUP -- lê um grid CSV (header +
// rows, o mesmo formato que mapear-producao-total.js/mapear-demandas-
// sondagem.js já produzem) e devolve a primeira coordenada válida por SUP.
//
// Contexto: no momento em que este módulo foi escrito, NENHUMA fonte de
// dado deste projeto tinha coordenada nenhuma -- Patrick (dono da fonte de
// demandas) ainda vai publicar Latitude/Longitude no site que
// tools/semanal/atualizar-demandas-sondagem-online.js raspa. Os nomes de
// coluna abaixo são um CHUTE educado (variações comuns); se o nome real
// vier diferente, o ajuste fica CONTIDO nesta lista -- nunca espalha pelo
// resto do pipeline. Ver
// docs/superpowers/specs/2026-08-26-alocacao-equipes-mapa-design.md,
// Decisão 3.
//
// Resolve por IGUALDADE EXATA (nunca por prefixo/contains) -- mesmo padrão
// já estabelecido em tools/medicoes/parse-medicoes.js (ver CLAUDE.md, "A
// planilha das medições renomeia colunas"): um "Latitude (aprox.)" do lado
// de um "Latitude" real seria capturado por engano com prefixo.
//
// NUNCA lança. SUP sem coluna de coordenada, sem valor numérico, ou com
// 0/0 (placeholder mais comum de planilha, nunca uma coordenada real no
// Brasil) simplesmente não entra no resultado -- o chamador trata "sem
// entrada" como "sem localização", nunca como erro.
var CANDIDATOS_LAT = ['Latitude', 'Lat'];
var CANDIDATOS_LON = ['Longitude', 'Lon', 'Lng'];
var COLUNA_SUP = 'Contrato';

function acharColuna(header, candidatos) {
  for (var c = 0; c < candidatos.length; c++) {
    for (var col = 0; col < header.length; col++) {
      if (String(header[col] || '').trim() === candidatos[c]) return col;
    }
  }
  return -1;
}

function numeroOuNull(valor) {
  var texto = String(valor === null || valor === undefined ? '' : valor).trim();
  if (texto === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(texto)) return null;
  var n = parseFloat(texto);
  return isNaN(n) ? null : n;
}

function resolverCoordenadasPorSup(header, rows) {
  var h = header || [];
  var colSup = acharColuna(h, [COLUNA_SUP]);
  var colLat = acharColuna(h, CANDIDATOS_LAT);
  var colLon = acharColuna(h, CANDIDATOS_LON);
  var resultado = {};
  if (colSup === -1 || colLat === -1 || colLon === -1) return resultado;

  (rows || []).forEach(function (row) {
    var sup = String(row[colSup] || '').trim();
    if (!sup || resultado[sup]) return; // já resolvido -- primeira coordenada válida vence
    var lat = numeroOuNull(row[colLat]);
    var lon = numeroOuNull(row[colLon]);
    if (lat === null || lon === null) return;
    if (lat === 0 && lon === 0) return;
    resultado[sup] = { lat: lat, lon: lon };
  });
  return resultado;
}

module.exports = { resolverCoordenadasPorSup };
