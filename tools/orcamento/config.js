// tools/orcamento/config.js
'use strict';

// Os dois caminhos aceitam override por variável de ambiente -- o dono do
// projeto tem a pasta PMO direto no "Meu Drive" (caminho fixo abaixo
// funciona sem ajuste nenhum), mas um colaborador só com acesso
// compartilhado enxerga a mesma pasta só via atalho
// (G:\.shortcut-targets-by-id\...\PMO), um ID que não é o mesmo em toda
// máquina. Sem o override, cada colaborador precisaria editar este arquivo
// (compartilhado no repo) toda vez que buildasse localmente.
module.exports = {
  caminhoArquivo: process.env.ORCAMENTO_CAMINHO_MATRIZ || 'G:\\Meu Drive\\PMO\\06 - Orçamento\\OR26 - Rev 01 - Frcst 6+6\\Modelo\\OR - 2026 (04.A) - Base Frcst 6+6 Atual R00.1.xlsx',
  nomeAba: 'MATRIZ',
  // Estudo original de linha de base (o "Previsto Inicial", uma foto única
  // do início do projeto -- nunca muda, ao contrário da MATRIZ viva acima).
  caminhoLinhaBase: process.env.ORCAMENTO_CAMINHO_LINHA_BASE || 'G:\\Meu Drive\\PMO\\06 - Orçamento\\Orçamento 2026\\OR26 PxR\\01 - Linha de base\\Estudo remobilização Equipes - 2026 AC 04.A.xlsx',
  nomeAbaLinhaBase: 'PROJ. GERAL - 110MM',
};
