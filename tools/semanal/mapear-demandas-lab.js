'use strict';
const { classificarEnsaioLab } = require('../comum/tipologias-lab.js');
const { dataDeTexto } = require('./parse-avancos.js');
const { linhaExcluida } = require('../comum/exclusoes.js');

// Link 5 (detalhes-ensaios-programados): ensaios de lab ainda PENDENTES, um
// por linha, já auto-suficiente (tem a própria Data Programada -- diferente
// de Demandas de sondagem, não precisa de join com outra fonte). Ver
// docs/superpowers/specs/2026-08-08-troca-origem-realizado-demandas-equipes-design.md,
// seção "Link 5".
// A exclusão mora em tools/comum/exclusoes.js desde 2026-08-10 -- uma
// implementação só para as cinco fontes. linhaExcluida() já procura o
// tomador tanto em "Tomador" quanto em "Tomadora": o extrato de lab usa a
// segunda grafia, e a versão anterior deste arquivo lia só "Tomador", então
// o filtro de tomador nunca disparava aqui (o de tipo disparava).
function texto(valor) {
  return String(valor === null || valor === undefined ? '' : valor).trim();
}

function mapearDemandasLab(linhas) {
  const ensaios = [];
  let excluidos = 0;

  for (const linha of linhas || []) {
    if (linhaExcluida(linha, texto(linha['Sondagem Tipo']))) {
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
