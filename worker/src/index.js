// Tablica sąsiedzka Osiedla Przyjaźń — API (Cloudflare Worker + D1)

const KATEGORIE = ['wydarzenie', 'wymiana', 'szukam', 'polecam', 'inne'];
const LIMITY = { tytul: 60, tresc: 400, podpis: 40, kontakt: 80 };
const MAX_WPISOW_10MIN = 3;
const DNI_WAZNOSCI = 60;

const ORIGINS = [
  'https://osiedleprzyjazn.waw.pl',
  'https://www.osiedleprzyjazn.waw.pl',
  'http://localhost:8123',
];

function cors(req) {
  const o = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
    'Vary': 'Origin',
  };
}

function json(req, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(req) },
  });
}

async function ipHash(req) {
  const ip = req.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('przyjazn:' + ip));
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

function czysc(s, max) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });

    // GET /ogloszenia — lista aktualnych kartek
    if (req.method === 'GET' && path === '/ogloszenia') {
      const { results } = await env.DB.prepare(
        `SELECT id, tytul, tresc, kategoria, podpis, kontakt, serca, created_at
         FROM ogloszenia
         WHERE status = 'ok' AND created_at > datetime('now', ?)
         ORDER BY created_at DESC LIMIT 100`
      ).bind(`-${DNI_WAZNOSCI} days`).all();
      return json(req, { ogloszenia: results });
    }

    // POST /ogloszenia — powieś kartkę
    if (req.method === 'POST' && path === '/ogloszenia') {
      let cialo;
      try { cialo = await req.json(); } catch { return json(req, { blad: 'Nieczytelna kartka.' }, 400); }

      if (cialo.miod) return json(req, { ok: true, id: 0 }); // honeypot: udajemy sukces

      const tytul = czysc(cialo.tytul, LIMITY.tytul);
      const tresc = czysc(cialo.tresc, LIMITY.tresc);
      const podpis = czysc(cialo.podpis, LIMITY.podpis);
      const kontakt = czysc(cialo.kontakt, LIMITY.kontakt);
      const kategoria = KATEGORIE.includes(cialo.kategoria) ? cialo.kategoria : 'inne';

      if (tytul.length < 3 || tresc.length < 10) {
        return json(req, { blad: 'Kartka potrzebuje tytułu (min. 3 znaki) i treści (min. 10 znaków).' }, 400);
      }

      const hash = await ipHash(req);
      const { cnt } = await env.DB.prepare(
        `SELECT COUNT(*) AS cnt FROM ogloszenia WHERE ip_hash = ? AND created_at > datetime('now', '-10 minutes')`
      ).bind(hash).first();
      if (cnt >= MAX_WPISOW_10MIN) {
        return json(req, { blad: 'Tablica prosi o chwilę oddechu. Spróbuj za kilka minut.' }, 429);
      }

      const r = await env.DB.prepare(
        `INSERT INTO ogloszenia (tytul, tresc, kategoria, podpis, kontakt, ip_hash) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(tytul, tresc, kategoria, podpis, kontakt, hash).run();
      return json(req, { ok: true, id: r.meta.last_row_id }, 201);
    }

    // POST /ogloszenia/:id/serce — zostaw serce
    const serce = path.match(/^\/ogloszenia\/(\d+)\/serce$/);
    if (req.method === 'POST' && serce) {
      const r = await env.DB.prepare(
        `UPDATE ogloszenia SET serca = serca + 1 WHERE id = ? AND status = 'ok'`
      ).bind(Number(serce[1])).run();
      if (!r.meta.changes) return json(req, { blad: 'Nie ma takiej kartki.' }, 404);
      const row = await env.DB.prepare(`SELECT serca FROM ogloszenia WHERE id = ?`).bind(Number(serce[1])).first();
      return json(req, { ok: true, serca: row.serca });
    }

    // DELETE /ogloszenia/:id — zdjęcie kartki (tylko gospodarz tablicy)
    const del = path.match(/^\/ogloszenia\/(\d+)$/);
    if (req.method === 'DELETE' && del) {
      if (req.headers.get('X-Admin-Key') !== env.ADMIN_KEY) {
        return json(req, { blad: 'Tylko gospodarz tablicy może zdjąć kartkę.' }, 403);
      }
      await env.DB.prepare(`UPDATE ogloszenia SET status = 'zdjete' WHERE id = ?`).bind(Number(del[1])).run();
      return json(req, { ok: true });
    }

    return json(req, { blad: 'Nie ma takiej ścieżki.', sciezki: ['GET /ogloszenia', 'POST /ogloszenia', 'POST /ogloszenia/:id/serce'] }, 404);
  },
};
