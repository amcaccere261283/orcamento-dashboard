'use strict';
const test = require('node:test');
const assert = require('node:assert');

class WebSocketFalso {
  constructor() {
    this.listeners = {};
    this.readyState = 1;
    setTimeout(() => this._emit('open'), 0);
  }
  addEventListener(evento, cb) { (this.listeners[evento] ||= []).push(cb); }
  _emit(evento, dado) { (this.listeners[evento] || []).forEach((cb) => cb(dado)); }
  send(mensagemJson) {
    const msg = JSON.parse(mensagemJson);
    setTimeout(() => this._emit('message', {
      data: JSON.stringify({ id: msg.id, result: { result: { value: 'linha1\nlinha2' } } }),
    }), 0);
  }
  close() {}
}

test('fetchTexto avalia fetch(...).then(r => r.text()) e devolve o texto cru', async () => {
  const globalAntigo = global.WebSocket;
  global.WebSocket = WebSocketFalso;
  try {
    const { CdpSession, fetchTexto } = require('../tools/semanal/cdp-client.js');
    const session = new CdpSession('ws://fake');
    await session.waitOpen();
    const texto = await fetchTexto(session, 'https://docs.google.com/qualquer');
    assert.strictEqual(texto, 'linha1\nlinha2');
  } finally {
    global.WebSocket = globalAntigo;
  }
});
