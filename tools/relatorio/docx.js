'use strict';
// Escritor mínimo de .docx (OOXML dentro de um ZIP), sem dependências --
// o repositório inteiro é sem `npm install`, e um relatório em Word não
// justifica quebrar essa regra. Só o que um documento de texto precisa:
// parágrafos, títulos, tabelas, uma imagem e rodapé com número de página.
//
// O ZIP é escrito à mão (deflate cru do zlib + CRC32 próprio) porque o Node
// não expõe escritor de ZIP na biblioteca padrão. Formato: local file header
// + dados + central directory + EOCD, sem Zip64 (um .docx destes tem alguns
// KB; o limite de 4 GB não é preocupação real aqui).
const zlib = require('node:zlib');

const TABELA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// Data/hora do MS-DOS: o .docx guarda a data de cada entrada nesse formato
// de 1980. Um valor fixo manteria o arquivo byte a byte reproduzível, mas
// aqui a data real ajuda mais (o Explorer do Windows mostra ela).
function dosDateTime(d) {
  const data = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  return { data, hora };
}

function zipar(entradas, agora = new Date()) {
  const { data, hora } = dosDateTime(agora);
  const locais = [];
  const central = [];
  let offset = 0;

  for (const { nome, conteudo } of entradas) {
    const bruto = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, 'utf8');
    const comprimido = zlib.deflateRawSync(bruto, { level: 9 });
    // PNG já vem comprimido: se o deflate não ajudar, guarda como está
    // (método 0) em vez de inchar o arquivo.
    const usarDeflate = comprimido.length < bruto.length;
    const dados = usarDeflate ? comprimido : bruto;
    const metodo = usarDeflate ? 8 : 0;
    const nomeBuf = Buffer.from(nome, 'utf8');
    const crc = crc32(bruto);

    const local = Buffer.alloc(30 + nomeBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(metodo, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(data, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dados.length, 18);
    local.writeUInt32LE(bruto.length, 22);
    local.writeUInt16LE(nomeBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nomeBuf.copy(local, 30);

    locais.push(local, dados);

    const cd = Buffer.alloc(46 + nomeBuf.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(metodo, 10);
    cd.writeUInt16LE(hora, 12);
    cd.writeUInt16LE(data, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(dados.length, 20);
    cd.writeUInt32LE(bruto.length, 24);
    cd.writeUInt16LE(nomeBuf.length, 28);
    cd.writeUInt32LE(0, 36);
    cd.writeUInt32LE(offset, 42);
    nomeBuf.copy(cd, 46);
    central.push(cd);

    offset += local.length + dados.length;
  }

  const dirBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entradas.length, 8);
  eocd.writeUInt16LE(entradas.length, 10);
  eocd.writeUInt32LE(dirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locais, dirBuf, eocd]);
}

function esc(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Um "run" com formatação direta. O Word aceita estilo nomeado + override
// direto na mesma execução; aqui tudo é direto, para o documento não depender
// de nenhum tema herdado do template do usuário.
function run(texto, o = {}) {
  const props = [];
  if (o.fonte) props.push(`<w:rFonts w:ascii="${esc(o.fonte)}" w:hAnsi="${esc(o.fonte)}" w:cs="${esc(o.fonte)}"/>`);
  if (o.negrito) props.push('<w:b/>');
  if (o.italico) props.push('<w:i/>');
  if (o.caixaAlta) props.push('<w:caps/>');
  // Mesma exigência de ordem do pPr (ver paragrafo abaixo): no rPr a sequência
  // é rFonts -> b -> i -> caps -> color -> spacing -> sz.
  if (o.cor) props.push(`<w:color w:val="${o.cor}"/>`);
  if (o.espacamento) props.push(`<w:spacing w:val="${o.espacamento}"/>`);
  if (o.tamanho) props.push(`<w:sz w:val="${o.tamanho * 2}"/><w:szCs w:val="${o.tamanho * 2}"/>`);
  const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
  // xml:space="preserve" evita o Word comer espaço no início/fim do trecho.
  const partes = String(texto ?? '').split('\n');
  return partes.map((t, i) =>
    `${i ? '<w:r><w:br/></w:r>' : ''}<w:r>${rPr}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`
  ).join('');
}

function paragrafo(runs, o = {}) {
  // A ORDEM destes elementos não é livre: o esquema do OOXML fixa a sequência
  // pStyle -> keepNext -> pageBreakBefore -> pBdr -> shd -> tabs -> spacing ->
  // ind -> jc. O Word de mesa aceita fora de ordem, mas o Word Online (e é ele
  // que abre o arquivo na pré-visualização do OneDrive) é mais rígido. Ao
  // acrescentar uma propriedade nova, encaixe-a na posição certa da sequência.
  const props = [];
  if (o.estilo) props.push(`<w:pStyle w:val="${o.estilo}"/>`);
  if (o.manterProxima) props.push('<w:keepNext/>');
  if (o.quebraAntes) props.push('<w:pageBreakBefore/>');
  if (o.bordaInferior) props.push(`<w:pBdr><w:bottom w:val="single" w:sz="${o.bordaInferior.espessura || 6}" w:space="2" w:color="${o.bordaInferior.cor}"/></w:pBdr>`);
  if (o.fundo) props.push(`<w:shd w:val="clear" w:color="auto" w:fill="${o.fundo}"/>`);
  // Parada de tabulação explícita: num parágrafo justificado, separar o
  // marcador do texto com espaços faz a justificação ESTICAR esses espaços,
  // e cada item da lista sai com um recuo diferente. Tabulação não estica.
  if (o.tabulacoes) props.push(`<w:tabs>${o.tabulacoes.map(pos => `<w:tab w:val="left" w:pos="${pos}"/>`).join('')}</w:tabs>`);
  const antes = o.antes != null ? o.antes : 0;
  const depois = o.depois != null ? o.depois : 120;
  props.push(`<w:spacing w:before="${antes}" w:after="${depois}"${o.entreLinhas ? ` w:line="${o.entreLinhas}" w:lineRule="auto"` : ''}/>`);
  if (o.recuo) props.push(`<w:ind w:left="${o.recuo}"${o.recuoPrimeira != null ? ` w:hanging="${o.recuoPrimeira}"` : ''}/>`);
  if (o.alinhamento) props.push(`<w:jc w:val="${o.alinhamento}"/>`);
  return `<w:p><w:pPr>${props.join('')}</w:pPr>${Array.isArray(runs) ? runs.join('') : runs}</w:p>`;
}

function celula(conteudo, o = {}) {
  // Ordem do esquema no tcPr: tcW -> gridSpan -> shd -> tcMar -> vAlign.
  const props = [`<w:tcW w:w="${o.largura || 0}" w:type="${o.largura ? 'dxa' : 'auto'}"/>`];
  if (o.mesclarHorizontal) props.push(`<w:gridSpan w:val="${o.mesclarHorizontal}"/>`);
  if (o.fundo) props.push(`<w:shd w:val="clear" w:color="auto" w:fill="${o.fundo}"/>`);
  props.push(`<w:tcMar><w:top w:w="${o.margemV || 60}" w:type="dxa"/><w:bottom w:w="${o.margemV || 60}" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar>`);
  props.push('<w:vAlign w:val="center"/>');
  return `<w:tc><w:tcPr>${props.join('')}</w:tcPr>${conteudo}</w:tc>`;
}

module.exports = { zipar, esc, run, paragrafo, celula };
