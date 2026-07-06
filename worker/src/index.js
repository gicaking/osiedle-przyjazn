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

const PANEL_HTML = `<!DOCTYPE html>
<html lang="pl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Gospodarz tablicy</title><meta name="robots" content="noindex">
<style>
  body{font-family:system-ui,sans-serif;background:#F3F4EE;color:#24322B;max-width:640px;margin:0 auto;padding:20px}
  h1{font-size:1.4rem}
  input{width:100%;padding:10px;border:1.5px solid #24322B;border-radius:8px;font-size:1rem;box-sizing:border-box}
  .kartka{background:#FBFBF7;border:1.5px solid #24322B;border-radius:10px;padding:14px;margin:12px 0}
  .kartka b{display:block;margin-bottom:4px}
  .meta{font-size:.8rem;opacity:.65;margin-top:6px}
  button{background:#BF4630;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:.9rem;cursor:pointer;margin-top:8px}
  .ok{color:#38604D;font-weight:600}
</style></head><body>
<h1>🏡 Gospodarz tablicy</h1>
<p>Klucz gospodarza (zapamięta się na tym urządzeniu):</p>
<input id="klucz" type="password" placeholder="wklej klucz">
<div id="lista"></div>
<script>
  const API = location.origin;
  const pole = document.getElementById('klucz');
  pole.value = localStorage.getItem('klucz_gospodarza') || '';
  pole.addEventListener('change', () => localStorage.setItem('klucz_gospodarza', pole.value.trim()));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function odswiez(){
    const r = await fetch(API + '/ogloszenia');
    const d = await r.json();
    document.getElementById('lista').innerHTML = d.ogloszenia.map(k =>
      '<div class="kartka"><b>' + esc(k.tytul) + '</b>' + esc(k.tresc) +
      '<div class="meta">#' + k.id + ' · ' + esc(k.kategoria) + ' · ' + esc(k.podpis || 'bez podpisu') + ' · ❤ ' + k.serca + ' · ' + esc(k.created_at) + '</div>' +
      '<button onclick="zdejmij(' + k.id + ')">Zdejmij kartkę</button></div>').join('') || '<p>Tablica pusta.</p>';
  }
  async function zdejmij(id){
    if (!confirm('Zdjąć kartkę #' + id + '?')) return;
    const r = await fetch(API + '/ogloszenia/' + id, { method:'DELETE', headers:{'X-Admin-Key': pole.value.trim()} });
    const d = await r.json();
    if (d.ok){ odswiez(); } else { alert(d.blad || 'Nie wyszło.'); }
  }
  odswiez();
</script></body></html>`;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });

    // GET /gospodarz — panel moderacji (klucz sprawdza dopiero DELETE)
    if (req.method === 'GET' && path === '/gospodarz') {
      return new Response(PANEL_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

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
