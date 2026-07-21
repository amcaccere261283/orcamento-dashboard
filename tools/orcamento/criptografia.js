'use strict';
const crypto = require('node:crypto');

const ITERACOES_PBKDF2 = 250000;
const TAMANHO_SALT = 16;
const TAMANHO_IV = 12;
const TAMANHO_CHAVE = 32; // AES-256
const TAMANHO_TAG = 16; // AES-GCM

// Cifra um texto com AES-256-GCM, derivando a chave da senha via
// PBKDF2-SHA256. O formato do resultado é pensado pra ser decifrado tanto
// aqui (node:crypto, usado nos testes) quanto no navegador (Web Crypto,
// crypto.subtle) usando os MESMOS parâmetros -- salt/iv/iterações vão
// junto, sem problema, eles não são segredo (só a senha e a chave derivada
// dela precisam ficar secretas). O texto cifrado inclui a tag de
// autenticação concatenada no final, o mesmo formato que
// crypto.subtle.encrypt produz nativamente.
function cifrarComSenha(textoPlano, senha) {
  const salt = crypto.randomBytes(TAMANHO_SALT);
  const iv = crypto.randomBytes(TAMANHO_IV);
  const chave = crypto.pbkdf2Sync(senha, salt, ITERACOES_PBKDF2, TAMANHO_CHAVE, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', chave, iv);
  const cifrado = Buffer.concat([cipher.update(textoPlano, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    dados: Buffer.concat([cifrado, tag]).toString('base64'),
    iteracoes: ITERACOES_PBKDF2,
  };
}

// Só pra teste/verificação -- confirma que o pacote cifrado por
// cifrarComSenha pode ser decifrado de volta com a senha certa. Espelha a
// lógica que o navegador roda via Web Crypto, usando node:crypto no lugar
// de crypto.subtle, com os mesmos parâmetros (mesma contagem de iterações
// embutida no próprio pacote, nunca uma constante fixa separada que possa
// divergir).
function decifrarComSenha(pacote, senha) {
  const salt = Buffer.from(pacote.salt, 'base64');
  const iv = Buffer.from(pacote.iv, 'base64');
  const dados = Buffer.from(pacote.dados, 'base64');
  const tag = dados.subarray(dados.length - TAMANHO_TAG);
  const cifrado = dados.subarray(0, dados.length - TAMANHO_TAG);
  const chave = crypto.pbkdf2Sync(senha, salt, pacote.iteracoes, TAMANHO_CHAVE, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', chave, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(cifrado), decipher.final()]).toString('utf8');
}

module.exports = { cifrarComSenha, decifrarComSenha, ITERACOES_PBKDF2 };
