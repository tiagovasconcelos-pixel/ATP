// GET /api/estado?mes=2026-10  ->  { config, deposito, gravando }
// Le do Upstash Redis. Se o banco ainda nao estiver conectado, devolve o padrao
// para a pagina abrir bonita; gravar e que vai falhar, e falha avisando.

const VERSAO = "2026-10-25-c";

// Guarda o status HTTP da ultima conversa com o banco, para diagnostico.
// Nunca guarda token nem host completo.
let ultimoStatus = null;

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

async function ler(chave) {
  const c = credenciais();
  if (!c) return null;
  const r = await fetch(`${c.url}/get/${encodeURIComponent(chave)}`, {
    headers: { Authorization: `Bearer ${c.token}` }, cache: "no-store"
  });
  ultimoStatus = r.status;
  if (!r.ok) return null;
  const d = await r.json();
  if (d.result == null) return null;
  try { return typeof d.result === "string" ? JSON.parse(d.result) : d.result; }
  catch { return null; }
}

export default async function handler(req, res) {
  const mes = String(req.query.mes || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ erro: "mes invalido, use AAAA-MM" });
  }
  try {
    const [cfg, dep] = await Promise.all([ ler("atp:config"), ler("atp:dep:" + mes) ]);
    res.setHeader("Cache-Control", "no-store");
    const cred = credenciais();
    const corpo = {
      config: cfg || PADRAO,
      deposito: dep || {},
      gravando: cred !== null
    };
    corpo.versao = VERSAO;
    if (cred) {
      corpo.via = cred.via;
      // Diagnostico sem segredo: so o tipo do host e o status HTTP.
      let tipo = "outro";
      try { tipo = /\.upstash\.io$/i.test(new URL(cred.url).hostname) ? "upstash.io" : "outro"; } catch (_) {}
      corpo.sonda = { host: tipo, status: ultimoStatus };
    }
    else corpo.variaveisEncontradas = nomesDeVariaveis();  // so os nomes
    return res.status(200).json(corpo);
  } catch (e) {
    // Antes este ramo devolvia gravando:false sem dizer nada, o que e
    // indistinguivel de "banco nao conectado". Agora ele se identifica.
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      config: PADRAO,
      deposito: {},
      gravando: false,
      versao: VERSAO,
      erro: "o banco respondeu com falha",
      detalhe: String((e && e.message) || e).slice(0, 300),
      variaveisEncontradas: nomesDeVariaveis()
    });
  }
}
