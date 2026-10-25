// POST /api/marcar
//   { mes: "2026-10", id: "pedro" }  -> alterna o deposito, devolve { deposito }
//   { config: {...} }                -> salva a conta e os valores, devolve { config }
// Grava no Upstash Redis. Sem banco conectado, responde 503 com motivo claro.

const PADRAO = {
  membros: [
    { id: "tiago",     nome: "Tiago",            valor: 300 },
    { id: "pedro",     nome: "Pedro Miranda",    valor: 300 },
    { id: "alexandre", nome: "Alexandre Soares", valor: 300 }
  ],
  pix: "42.134.811/0001-25",
  banco: "Banco BS2",
  dia: 10
};

function credenciais() {
  const e = process.env;
  const diretos = [
    ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
    ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]
  ];
  for (const [u, t] of diretos) {
    if (e[u] && e[t]) return { url: String(e[u]).replace(/\/$/, ""), token: e[t], via: u };
  }
  // Varredura: o Upstash pode prefixar com o nome do banco.
  // Procura qualquer chave que termine em REST_URL e o token do mesmo prefixo.
  const chaves = Object.keys(e);
  for (const k of chaves) {
    const m = k.match(/^(.*?)(REST_API_URL|REDIS_REST_URL|REST_URL)$/i);
    if (!m || !e[k] || !/^https?:\/\//i.test(String(e[k]))) continue;
    const prefixo = m[1];
    const kt = chaves.find(x =>
      x !== k &&
      x.toLowerCase().startsWith(prefixo.toLowerCase()) &&
      /TOKEN$/i.test(x) && e[x]);
    if (kt) return { url: String(e[k]).replace(/\/$/, ""), token: e[kt], via: k };
  }
  // Ultimo recurso: a integracao Redis da Vercel pode injetar apenas uma
  // connection string (REDIS_URL / KV_URL no formato rediss://default:SENHA@host:6379).
  // Nela, o host e o mesmo do endpoint REST e a senha e o bearer token.
  for (const k of ["KV_REST_API_URL", "REDIS_URL", "KV_URL", "UPSTASH_REDIS_URL"]) {
    const v = e[k];
    if (!v || !/^rediss?:\/\//i.test(String(v))) continue;
    try {
      const u = new URL(String(v));
      const senha = decodeURIComponent(u.password || "");
      if (u.hostname && senha) {
        return { url: "https://" + u.hostname, token: senha, via: k + " (connection string)" };
      }
    } catch (_) { /* string torta: segue para a proxima */ }
  }

  return null;
}

// Apenas NOMES, nunca valores. Serve para diagnostico enquanto nao conecta.
function nomesDeVariaveis() {
  return Object.keys(process.env)
    .filter(k => /REDIS|UPSTASH|^KV_|REST_API/i.test(k))
    .sort();
}

async function ler(c, chave) {
  const r = await fetch(`${c.url}/get/${encodeURIComponent(chave)}`, {
    headers: { Authorization: `Bearer ${c.token}` }, cache: "no-store"
  });
  if (!r.ok) return null;
  const d = await r.json();
  if (d.result == null) return null;
  try { return typeof d.result === "string" ? JSON.parse(d.result) : d.result; }
  catch { return null; }
}

async function gravar(c, chave, valor) {
  const r = await fetch(`${c.url}/set/${encodeURIComponent(chave)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(valor)
  });
  if (!r.ok) throw new Error("falha ao gravar: " + r.status);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ erro: "use POST" });

  const c = credenciais();
  if (!c) return res.status(503).json({
    erro: "banco nao conectado",
    comoResolver: "Na Vercel: Storage > Marketplace > Redis (Upstash) e conectar ao projeto."
  });

  let corpo = req.body;
  if (typeof corpo === "string") { try { corpo = JSON.parse(corpo); } catch { corpo = {}; } }
  corpo = corpo || {};

  try {
    // 1) salvar a configuracao
    if (corpo.config) {
      const cfg = corpo.config;
      if (!Array.isArray(cfg.membros)) return res.status(400).json({ erro: "config invalida" });
      const limpo = {
        membros: cfg.membros.slice(0, 20).map(m => ({
          id: String(m.id).slice(0, 40),
          nome: String(m.nome).slice(0, 80),
          valor: (typeof m.valor === "number" && isFinite(m.valor) && m.valor > 0) ? m.valor : null
        })),
        pix: String(cfg.pix || "").slice(0, 120),
        banco: String(cfg.banco || "").slice(0, 120),
        dia: (Number.isInteger(cfg.dia) && cfg.dia >= 1 && cfg.dia <= 28) ? cfg.dia : 10
      };
      await gravar(c, "atp:config", limpo);
      return res.status(200).json({ config: limpo });
    }

    // 2) alternar o deposito de um integrante
    const mes = String(corpo.mes || "");
    const id  = String(corpo.id  || "");
    if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ erro: "mes invalido" });

    const cfg = (await ler(c, "atp:config")) || PADRAO;
    const membro = (cfg.membros || []).find(m => m.id === id);
    if (!membro) return res.status(400).json({ erro: "integrante desconhecido" });

    const chave = "atp:dep:" + mes;
    const dep = (await ler(c, chave)) || {};
    if (dep[id]) delete dep[id];
    else dep[id] = {
      at: new Date().toISOString(),
      valor: (typeof membro.valor === "number") ? membro.valor : null
    };

    await gravar(c, chave, dep);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ deposito: dep });

  } catch (e) {
    return res.status(500).json({ erro: "nao consegui gravar", detalhe: String(e.message || e) });
  }
}
