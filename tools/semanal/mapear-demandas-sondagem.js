'use strict';
const { HEADER_SAIDA } = require('./mapear-producao-total.js');

// Junta furos PENDENTES do Link 2 (maps-sondagens, snapshot de agora) com o
// Link 3 (avanco-sondagens, agregado por OS+Tipo, tem Contrato/Tomador/
// "OS desde") pela OS -- Link 2 não tem Contrato nem data de criação
// confiável. "OS desde" do Link 3 vira a chegada de TODO furo pendente
// daquela OS no Link 2 (aproximação de lote, confirmada com o usuário). Ver
// docs/superpowers/specs/2026-08-08-troca-origem-realizado-demandas-equipes-design.md,
// seção "Demandas de sondagens".
// Exclusão de Tomador == "Suporte Sondagens - Filial Lapa" e Tipo contendo
// SEG/SN -- MESMA regra de mapear-producao-total.js/mapear-demandas-lab.js
// (achado da revisão final de branch, 2026-08-08). O Link 2 (furos
// pendentes) não tem coluna Tomador -- só o Link 3 tem, via join por OS --
// então a exclusão só pode acontecer DEPOIS do join, usando o Tomador do
// Link 3 (linha correspondente) e o Tipo do próprio Link 2 (fonte da verdade
// do Tipo individual, ver o teste "Link 3 com Tipo diferente... não confunde
// a linha").
const RE_EXCLUSAO_TIPO = /SEG|SN/;
const TOMADOR_EXCLUIDO = 'Suporte Sondagens - Filial Lapa';

function texto(valor) {
  return String(valor === null || valor === undefined ? '' : valor).trim();
}

function juntarPendentesSondagem(linhasLink2, linhasLink3) {
  const porOS = new Map();
  for (const l3 of linhasLink3 || []) {
    const os = texto(l3['Ordens de Serviço (OS)']);
    if (os && !porOS.has(os)) {
      porOS.set(os, {
        contrato: texto(l3['Contrato']),
        osDesde: texto(l3['OS desde']),
        tomador: texto(l3['Tomador']),
      });
    }
  }

  const rows = [];
  let semContrato = 0;
  let excluidos = 0;
  for (const l2 of linhasLink2 || []) {
    const os = texto(l2['Ordem de Serviço (OS)']);
    const info = porOS.get(os);
    if (!info) { semContrato++; continue; }
    const tipo = texto(l2['Tipo']);
    if (info.tomador === TOMADOR_EXCLUIDO || RE_EXCLUSAO_TIPO.test(tipo.toUpperCase())) {
      excluidos++;
      continue;
    }
    rows.push([
      info.contrato,
      info.osDesde,
      tipo,
      'PENDENTE',
      '', '', '', '', '',
      '',
      os,
      '',
    ]);
  }

  return { header: HEADER_SAIDA, rows, semContrato, excluidos };
}

module.exports = { juntarPendentesSondagem };
