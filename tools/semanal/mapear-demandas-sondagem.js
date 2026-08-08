'use strict';
const { HEADER_SAIDA } = require('./mapear-producao-total.js');

// Junta furos PENDENTES do Link 2 (maps-sondagens, snapshot de agora) com o
// Link 3 (avanco-sondagens, agregado por OS+Tipo, tem Contrato/Tomador/
// "OS desde") pela OS -- Link 2 não tem Contrato nem data de criação
// confiável. "OS desde" do Link 3 vira a chegada de TODO furo pendente
// daquela OS no Link 2 (aproximação de lote, confirmada com o usuário). Ver
// docs/superpowers/specs/2026-08-08-troca-origem-realizado-demandas-equipes-design.md,
// seção "Demandas de sondagens".
function texto(valor) {
  return String(valor === null || valor === undefined ? '' : valor).trim();
}

function juntarPendentesSondagem(linhasLink2, linhasLink3) {
  const porOS = new Map();
  for (const l3 of linhasLink3 || []) {
    const os = texto(l3['Ordens de Serviço (OS)']);
    if (os && !porOS.has(os)) {
      porOS.set(os, { contrato: texto(l3['Contrato']), osDesde: texto(l3['OS desde']) });
    }
  }

  const rows = [];
  let semContrato = 0;
  for (const l2 of linhasLink2 || []) {
    const os = texto(l2['Ordem de Serviço (OS)']);
    const info = porOS.get(os);
    if (!info) { semContrato++; continue; }
    rows.push([
      info.contrato,
      info.osDesde,
      texto(l2['Tipo']),
      'PENDENTE',
      '', '', '', '', '',
      '',
      os,
      '',
    ]);
  }

  return { header: HEADER_SAIDA, rows, semContrato };
}

module.exports = { juntarPendentesSondagem };
