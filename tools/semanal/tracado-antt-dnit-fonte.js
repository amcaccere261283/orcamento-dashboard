'use strict';

// Trechos FEDERAIS (rodovia + UF real + faixa de km) extraídos manualmente em
// 2026-08-27 do CSV oficial da ANTT "informacoes-sobre-os-trechos-concedidos"
// (dados.antt.gov.br, dataset trecho-concedido, arquivo de julho/2026) --
// ver docs/superpowers/specs/2026-08-27-tracado-rodovias-antt-dnit-handoff.md.
//
// Cada entrada aqui é usada por atualizar-tracado-antt-dnit.js pra consultar o
// WFS do DNIT (geoservicos.inde.gov.br/geoserver/DNIT, camada snv_202507a) e
// recortar a malha física correspondente. Só trechos do CSV com
// `tipo_de_rodovia = Federal` entram aqui -- trechos "Estadual"/"Outros" ficam
// de fora (a malha do SNV é só federal; rodovia estadual exigiria a fonte do
// DER do estado, fora de escopo desta rodada).
//
// **A coluna "uf" do CSV da ANTT é um CÓDIGO NUMÉRICO, não a sigla da UF** --
// achado desta sessão, sem tabela oficial de correspondência encontrada (nem
// no dicionário de dados em PDF, nem documentação pública). O mapeamento
// abaixo (UF_ANTT_PARA_SIGLA) foi INFERIDO cruzando o nome de cada
// concessionária/rodovia com geografia real conhecida (ex.: "Rota Verde
// GOIÁS" com código 80 em BR-452/BR-60; "EPR VIA MINEIRA" e várias
// concessões do Paraná (EPR Paraná, Litoral Pioneiro, Motiva Paraná, Via
// Araçária, Via Campo) todas com código 75 nas mesmas BRs onde a empresa
// opera). Cada código usado abaixo tem pelo menos duas concessionárias
// confirmando o mesmo estado -- não é uma fonte oficial, é inferência
// convergente. Confirmar com o dono do projeto antes de tratar isto como
// verdade absoluta se algum trecho sair visualmente errado no mapa.
const UF_ANTT_PARA_SIGLA = {
  71: 'MG', 72: 'ES', 73: 'RJ', 74: 'SP', 75: 'PR',
  76: 'SC', 77: 'RS', 78: 'MS', 79: 'MT', 80: 'GO',
};

// 22ª concessionária sem traçado, Ecovias Raposo Castello, está fora daqui de
// propósito -- é a concessionária ABCR (id "40"), problema diferente do
// handoff. "Ecovias das Gerais" (uma das 21) TAMBÉM está fora: nenhuma linha
// do CSV da ANTT bate com esse nome, nem variações óbvias (as concessões
// "Ecovias" do CSV são Araguaia/Capixaba/Cerrado/Minas Goiás/Ponte/Rio Minas
// -- nenhuma "das Gerais"). Fica sem traçado até alguém confirmar a que
// concessão real esse nome corresponde.
//
// `id` bate com o gerado por CONCESSIONARIAS_EXTRA_ANTT em
// concessoes-rodovias.js (mesma função de slug). `trechos` é a lista de
// {br, ufAntt, kmInicial, kmFinal} a consultar no WFS -- kmInicial/kmFinal
// describes a faixa de SOBREPOSIÇÃO (não precisa bater exato com a
// segmentação do SNV, que pode fatiar diferente).
const TRECHOS_FEDERAIS_POR_CONCESSIONARIA = {
  'antt-autopista-fluminense': [
    { br: '101', ufAntt: 73, kmInicial: 0, kmFinal: 322.1 },
  ],
  'antt-autopista-litoral-sul': [
    { br: '101', ufAntt: 76, kmInicial: 0, kmFinal: 244.68 },
    { br: '116', ufAntt: 75, kmInicial: 71.1, kmFinal: 115.2 },
    { br: '376', ufAntt: 75, kmInicial: 614.4, kmFinal: 682.123 },
  ],
  'antt-autopista-planalto-sul': [
    { br: '116', ufAntt: 75, kmInicial: 115.0, kmFinal: 211.8 },
    { br: '116', ufAntt: 76, kmInicial: 0, kmFinal: 310.24 },
  ],
  'antt-autopista-regis-bittencourt': [
    { br: '116', ufAntt: 74, kmInicial: 268.9, kmFinal: 569.1 },
    { br: '116', ufAntt: 75, kmInicial: 0, kmFinal: 71.1 },
  ],
  'antt-elovias': [
    { br: '40', ufAntt: 71, kmInicial: 776.1, kmFinal: 831.4 },
    { br: '40', ufAntt: 73, kmInicial: 0, kmFinal: 125.2 },
    // BR-495/uf73 km34.4-34.5 (ponto de ~100m) fica de fora -- irrelevante
    // pra uma linha de referência visual.
  ],
  'antt-epr-parana': [
    { br: '272', ufAntt: 75, kmInicial: 526.1, kmFinal: 571.4 },
    { br: '369', ufAntt: 75, kmInicial: 88.41, kmFinal: 182.7 },
    { br: '376', ufAntt: 75, kmInicial: 29.6, kmFinal: 200.4 },
  ],
  'antt-motiva-minas-sp': [
    { br: '381', ufAntt: 71, kmInicial: 477.2, kmFinal: 949.9 },
    { br: '381', ufAntt: 74, kmInicial: 0, kmFinal: 90.4 },
  ],
  'antt-motiva-pantanal': [
    // CSV da ANTT lista como "PANTANAL" -- mesmo padrão de rebrand Motiva/CCR
    // já registrado em concessoes-rodovias.js para RioSP/Paraná/ViaCosteira/ViaSul.
    { br: '163', ufAntt: 78, kmInicial: 0, kmFinal: 845.9 },
  ],
  'antt-motiva-parana': [
    { br: '369', ufAntt: 75, kmInicial: 182.7, kmFinal: 200.8 },
    { br: '373', ufAntt: 75, kmInicial: 171.9, kmFinal: 183.4 },
    { br: '376', ufAntt: 75, kmInicial: 8.6, kmFinal: 10.0 },
    { br: '376', ufAntt: 75, kmInicial: 202.3, kmFinal: 549.3 },
  ],
  'antt-motiva-riosp': [
    // CSV da ANTT lista como "RIOSP".
    { br: '101', ufAntt: 73, kmInicial: 380.8, kmFinal: 598.6 },
    { br: '101', ufAntt: 74, kmInicial: 0, kmFinal: 52.59 },
    { br: '116', ufAntt: 73, kmInicial: 169.0, kmFinal: 339.482 },
    { br: '116', ufAntt: 74, kmInicial: 0, kmFinal: 231.947 },
  ],
  'antt-motiva-viacosteira': [
    // CSV da ANTT lista como "VIA COSTEIRA".
    { br: '101', ufAntt: 76, kmInicial: 245.0, kmFinal: 464.285 },
  ],
  'antt-motiva-viasul': [
    // CSV da ANTT lista como "VIA SUL".
    { br: '101', ufAntt: 77, kmInicial: 0, kmFinal: 88.5 },
    { br: '290', ufAntt: 77, kmInicial: 0, kmFinal: 98.1 },
    { br: '386', ufAntt: 77, kmInicial: 179.96, kmFinal: 446.0 },
    { br: '448', ufAntt: 77, kmInicial: 0.5, kmFinal: 22.1 },
  ],
  'antt-rota-verde-goias': [
    { br: '452', ufAntt: 80, kmInicial: 0, kmFinal: 196.6 },
    { br: '60', ufAntt: 80, kmInicial: 164.0, kmFinal: 393.6 },
  ],
  'antt-triunfo-concebra': [
    // CSV da ANTT lista como "CONCEBRA" -- Triunfo é o grupo controlador.
    { br: '153', ufAntt: 80, kmInicial: 490.0, kmFinal: 703.9 },
    { br: '60', ufAntt: 80, kmInicial: 0, kmFinal: 139.0 },
    // BR-60/km0-31.9 fica de fora: o CSV usa um código de UF (81) sem
    // correspondência confirmada em nenhuma outra concessionária desta
    // lista -- não incluído para não arriscar UF errada.
  ],
  'antt-triunfo-transbrasiliana': [
    // CSV da ANTT lista como "TRANSBRASILIANA". Faixa única cobrindo as
    // quatro sub-faixas do CSV (0-75.1, 75.1-76.2, 76.2-230.2, 255-347.7) --
    // o intervalo 230.2-255 sem operador na ANTT entra também (o filtro é
    // por sobreposição de km, não recorte exato), imprecisão aceitável para
    // uma linha de referência visual.
    { br: '153', ufAntt: 74, kmInicial: 0, kmFinal: 347.7 },
  ],
  'antt-via-araucaria': [
    // CSV da ANTT grafa "VIA ARAÇÁRIA" (provável erro de digitação da
    // própria ANTT) -- mesma concessionária, confirmado pelas BRs/km
    // batendo com o que se conhece de Via Araucária no Paraná.
    { br: '277', ufAntt: 75, kmInicial: 107.3, kmFinal: 303.8 },
    { br: '373', ufAntt: 75, kmInicial: 183.4, kmFinal: 282.7 },
    { br: '376', ufAntt: 75, kmInicial: 591.6, kmFinal: 606.2 },
    { br: '476', ufAntt: 75, kmInicial: 143.7, kmFinal: 197.7 },
  ],
  'antt-via-campo': [
    { br: '163', ufAntt: 75, kmInicial: 197.6, kmFinal: 354.2 },
    { br: '369', ufAntt: 75, kmInicial: 334.8, kmFinal: 509.9 },
    { br: '467', ufAntt: 75, kmInicial: 102.0, kmFinal: 118.0 },
  ],
  'antt-way-153': [
    // CSV da ANTT grafa "WAY 153" (espaço, não hífen).
    { br: '153', ufAntt: 71, kmInicial: 0, kmFinal: 247.0 },
    { br: '153', ufAntt: 80, kmInicial: 529.87, kmFinal: 702.73 },
    { br: '262', ufAntt: 71, kmInicial: 796.31, kmFinal: 902.7 },
  ],
  'antt-way-262': [
    { br: '262', ufAntt: 71, kmInicial: 347.9, kmFinal: 787.9 },
  ],
  'antt-way-364': [
    { br: '364', ufAntt: 79, kmInicial: 0, kmFinal: 201.0 },
    { br: '364', ufAntt: 80, kmInicial: 192.7, kmFinal: 387.5 },
    { br: '60', ufAntt: 80, kmInicial: 393.6, kmFinal: 470.0 },
  ],
};

// "Ecovias das Gerais" (2026-08-27, mesmo dia da resolução das outras 20):
// concessão nova demais pra estar no CSV da ANTT usado acima -- contrato
// publicado no DOU em 2026-06-08 (leilão em 2026-03-31), depois do corte do
// arquivo trecho-concedido de julho/2026. É rodovia FEDERAL de verdade
// (BR-116/MG + BR-251/MG, 734,9 km ao todo, Governador Valadares/MG até a
// divisa com a Bahia + Montes Claros/MG até o entroncamento com a BR-116) --
// só que a página da ANTT (gov.br/antt/.../ecovias-das-gerais) só publica a
// extensão total, não os km inicial/final oficiais do contrato.
//
// **Faixas de km ESTIMADAS**, não oficiais -- lidas nos campos descritivos
// ds_local_i/ds_local_f do próprio WFS do DNIT (que descrevem os extremos de
// cada segmento em texto, tipo "ENTR BR-116/251 (ACESSO SUL TANCREDO
// NEVES)"), procurando por "GOV. VALADARES", "DIV BA/MG" e "MONTES CLAROS":
//   BR-116/MG: km 0 (DIV BA/MG) até km 412 (ENTR BR-116/381/451, centro de
//   Governador Valadares) -- ~412 km.
//   BR-251/MG: km 179,3 (ENTR BR-116/251/MG-251, o entroncamento LITERAL com
//   a BR-116, perto de Pedra Azul) até km 530,1 (ENTR BR-135/251, Montes
//   Claros) -- ~350,8 km.
// Soma ~762,8 km contra os 734,9 km oficiais (~3,7% acima) -- diferença
// esperada de uma estimativa por descrição textual, não por km oficial do
// contrato. Se algum dia o contrato/edital publicar os km exatos, trocar
// aqui e re-rodar atualizar-tracado-antt-dnit.js.
// `uf` (sigla real, não `ufAntt`) porque esta faixa não veio do CSV da ANTT
// -- não faz sentido fingir um código que nunca existiu; ver
// atualizar-tracado-antt-dnit.js, que aceita os dois formatos.
TRECHOS_FEDERAIS_POR_CONCESSIONARIA['antt-ecovias-das-gerais'] = [
  { br: '116', uf: 'MG', kmInicial: 0, kmFinal: 412 },
  { br: '251', uf: 'MG', kmInicial: 179.3, kmFinal: 530.1 },
];

module.exports = { UF_ANTT_PARA_SIGLA, TRECHOS_FEDERAIS_POR_CONCESSIONARIA };
