'use strict';

// Cliente minimo para o Chrome DevTools Protocol (CDP), conectando num
// Chrome ja aberto com --remote-debugging-port (sessao/cookies reaproveitados,
// nenhuma senha e guardada em lugar nenhum). Escrito do zero para este
// projeto -- so usa `fetch`/`WebSocket` globais do Node.

const CDP_PORT = 9222;

async function cdpGetJson(pathname, options = {}) {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}${pathname}`, options);
  if (!res.ok) throw new Error(`CDP HTTP ${pathname} falhou: ${res.status}`);
  return res.json();
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function mensagemErroWs(e) {
  return (e && e.error && e.error.message) || (e && e.message) || 'erro desconhecido';
}

class CdpSession {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || 'Erro CDP'));
        else resolve(msg.result);
      }
    });
    const rejeitarPendentes = (motivo) => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error('Sessao CDP encerrada: ' + motivo));
      }
      this.pending.clear();
    };
    this.ws.addEventListener('close', () => rejeitarPendentes('conexao fechada'));
    this.ws.addEventListener('error', (e) => rejeitarPendentes(mensagemErroWs(e)));
  }

  waitOpen() {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', (e) => reject(new Error('WebSocket: ' + mensagemErroWs(e))), { once: true });
    });
  }

  send(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} sem resposta em ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, timeoutMs = 30000) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    if (result.exceptionDetails) {
      const desc = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
      throw new Error('Erro ao executar no navegador: ' + (desc || JSON.stringify(result.exceptionDetails)));
    }
    return result.result.value;
  }

  close() {
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

async function abrirSessao(url) {
  const target = await cdpGetJson(`/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const session = new CdpSession(target.webSocketDebuggerUrl);
  await session.waitOpen();
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  await sleep(3000);
  return { session, target };
}

async function fecharSessao(session, target) {
  session.close();
  try { await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${target.id}`); } catch { /* ignore */ }
}

async function checarConexao() {
  await cdpGetJson('/json/version');
}

// Busca um endpoint JSON no contexto da PAGINA (sessao logada) e devolve
// ja parseado.
async function fetchJson(session, urlPath) {
  const raw = await session.evaluate(`fetch(${JSON.stringify(urlPath)}).then(r => r.text())`);
  return JSON.parse(raw);
}

// Busca uma URL ABSOLUTA (fora do site já aberto na sessão -- ex.: o export
// gviz do Google Sheets) no contexto da PAGINA e devolve o texto cru, sem
// tentar JSON.parse (fetchJson faz isso; aqui o resultado é CSV, não JSON).
async function fetchTexto(session, urlAbsoluta) {
  return session.evaluate(`fetch(${JSON.stringify(urlAbsoluta)}).then(r => r.text())`, 30000);
}

// Baixa um arquivo binario (o .xlsx de um contrato) no contexto da pagina e
// devolve um Buffer do Node.
async function fetchBuffer(session, urlPath) {
  const base64 = await session.evaluate(`
    (async () => {
      const res = await fetch(${JSON.stringify(urlPath)});
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return btoa(binary);
    })()
  `, 60000);
  return Buffer.from(base64, 'base64');
}

// Le uma tabela renderizada por jQuery DataTables, forcando ela a mostrar
// TODAS as linhas antes de ler -- as tabelas de sond.com.br as vezes paginam
// so visualmente (dados ja carregados no client, DOM so com a pagina atual
// ate pedir page.len(-1)). Confirmado ao vivo em campo/fotos: uma leitura
// sem esperar o DataTable estabilizar acha recordsTotal 0.
async function rasparTabelaDataTable(session, selector, { timeoutMs = 30000 } = {}) {
  const rawData = await session.evaluate(`
    (async () => {
      const deadline = Date.now() + ${timeoutMs};
      const sel = ${JSON.stringify(selector)};

      function apiPronta() {
        return window.jQuery && window.jQuery.fn && window.jQuery.fn.DataTable &&
          window.jQuery.fn.DataTable.isDataTable(sel);
      }

      while (!apiPronta() && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 300));
      }
      if (!apiPronta()) {
        return JSON.stringify({ __error__: 'DataTable nao inicializou: ' + sel });
      }

      const api = window.jQuery(sel).DataTable();
      let anterior = -1;
      let estavel = 0;
      let estabilizou = false;
      while (Date.now() < deadline) {
        const total = api.page.info().recordsTotal;
        if (total === anterior) {
          estavel++;
          if (estavel >= 2) {
            estabilizou = true;
            break;
          }
        } else {
          estavel = 0;
        }
        anterior = total;
        await new Promise((r) => setTimeout(r, 200));
      }

      if (!estabilizou) {
        return JSON.stringify({ __error__: 'DataTable nao estabilizou (recordsTotal nao parou de mudar): ' + sel });
      }

      api.page.len(-1).draw('page');
      await new Promise((r) => setTimeout(r, 500));

      const table = document.querySelector(sel);
      const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent.trim());
      let descartadas = 0;
      const rows = Array.from(table.querySelectorAll('tbody tr'))
        .map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim()))
        .filter((cols) => {
          if (cols.length === headers.length) return true;
          descartadas++;
          return false;
        });

      return JSON.stringify({ headers, rows, descartadas });
    })()
  `, timeoutMs + 10000);

  const parsed = JSON.parse(rawData);
  if (parsed.__error__) throw new Error(parsed.__error__);
  if (parsed.descartadas > 0) {
    console.warn(`rasparTabelaDataTable: ${parsed.descartadas} linha(s) descartada(s) por numero de colunas diferente do cabecalho em ${selector}`);
  }
  return { headers: parsed.headers, rows: parsed.rows };
}

// Converte {headers, rows} em objetos {header: valor}, ignorando colunas
// sem nome (ex.: a coluna de icone de "Acoes" no fim de algumas tabelas).
function linhasComoObjetos({ headers, rows }) {
  return rows.map((cols) => {
    const obj = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = cols[i];
    });
    return obj;
  });
}

module.exports = {
  abrirSessao, fecharSessao, checarConexao, fetchJson, fetchTexto, fetchBuffer,
  rasparTabelaDataTable, linhasComoObjetos, CdpSession,
};
