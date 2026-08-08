'use strict';
const { classificarEnsaioLab } = require('../comum/tipologias-lab.js');
const { dataDeTexto } = require('./parse-avancos.js');

// Link 5 (detalhes-ensaios-programados): ensaios de lab ainda PENDENTES, um
// por linha, já auto-suficiente (tem a própria Data Programada -- diferente
// de Demandas de sondagem, não precisa de join com outra fonte). Ver
// docs/superpowers/specs/2026-08-08-troca-origem-realizado-demandas-equipes-design.md,
// seção "Link 5".
const RE_EXCLUSAO_TIPO = /SEG|SN/;
const TOMADOR_EXCLUIDO = 'Suporte Sondagens - Filial Lapa';

function texto(valor) {
  return String(valor === null || valor === undefined ? '' : valor).trim();
}

function mapearDemandasLab(linhas) {
  const ensaios = [];
  let excluidos = 0;

  for (const linha of linhas || []) {
    const tomador = texto(linha['Tomador']);
    const sondagemTipo = texto(linha['Sondagem Tipo']).toUpperCase();
    if (tomador === TOMADOR_EXCLUIDO || RE_EXCLUSAO_TIPO.test(sondagemTipo)) {
      excluidos++;
      continue;
    }

    const tipoEnsaioCru = texto(linha['Tipo do Ensaio']);
    const tipologia = classificarEnsaioLab(tipoEnsaioCru);

    ensaios.push({
      sup: texto(linha['ID Contrato']),
      tipologia,
      concluido: null,
      criacao: dataDeTexto(linha['Data Programada']),
    });
  }

  return { ensaios, excluidos };
}

module.exports = { mapearDemandasLab };
