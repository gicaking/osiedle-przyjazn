// Redakcja: panel administratora z botem, który zmienia stronę na polecenie.
// Przepływ: polecenie po polsku -> bot proponuje edycje (szukaj/zamień) -> podgląd -> publikacja
// jako commit na GitHub (GitHub Pages wdraża w ok. minutę). Każdą zmianę da się cofnąć.

const GH = { owner: 'gicaking', repo: 'osiedle-przyjazn', branch: 'master', plik: 'index.html' };
const MODEL = 'claude-opus-5';
const MODEL_ZAPASOWY = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const WYMAGANE_ID = ['deska', 'chipy', 'licznik-kartek', 'btn-podeslij', 'dialog-kartka', 'btn-powies', 'btn-anuluj', 'form-kartka', 'odwiedziny'];

const SYSTEM = `Jesteś redaktorem strony osiedleprzyjazn.waw.pl, oficjalnej strony Inicjatywy Osiedle Przyjaźń (Warszawa, Bemowo). Dostajesz pełny kod index.html oraz polecenie administratora po polsku. Twoje zadanie: zaproponować minimalne, precyzyjne edycje kodu, które wykonują polecenie.

Odpowiadasz WYŁĄCZNIE jednym obiektem JSON, bez komentarzy i bez bloków kodu:
{"opis": "jedno zdanie po polsku, co zmieniasz", "edycje": [{"szukaj": "dokładny fragment obecnego kodu", "zamien": "nowy fragment"}], "pytanie": null}

Zasady edycji:
1. "szukaj" musi być dosłownym, unikalnym fragmentem obecnego kodu (skopiowanym znak w znak, z tymi samymi wcięciami i polskimi znakami). Dodaj tyle kontekstu, żeby fragment występował w pliku dokładnie raz. Nie skracaj wielokropkiem.
2. Rób jak najmniejsze zmiany. Nie przepisuj całych sekcji, jeśli wystarczy zmienić zdanie.
3. Trzymaj się istniejącego stylu: te same klasy CSS, ta sama struktura sekcji, ten sam ton (ciepły, sąsiedzki, krótkie zdania, polskie znaki). Nowe elementy buduj z istniejących klas (karta, pomysl, sztacheta, karteczka, lista, btn).
4. W tekstach po polsku nie używaj myślników ani półpauz. Zamiast nich kropki, przecinki, dwukropki.
5. Nie ruszaj bloku <script> ani elementów z id: ${WYMAGANE_ID.join(', ')}, chyba że polecenie wprost tego dotyczy.
6. Jeśli polecenie jest niejasne, ryzykowne (np. usunięcie całej sekcji) albo brakuje danych (data, godzina, nazwa), NIE zgaduj: zwróć "edycje": [] i zadaj krótkie pytanie w polu "pytanie".
7. Jeśli polecenie dotyczy treści, której nie ma na stronie, dodaj ją w najbardziej pasującej sekcji.
8. Gdy zmieniasz daty lub fakty, zachowaj spójność w całym pliku (np. ta sama godzina spotkań w wizytówce, w bloku Dołącz i w stopce).`;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- GitHub ----------
function ghHeaders(env) {
  return {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'redakcja-osiedleprzyjazn',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}
function b64ToText(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function textToB64(txt) {
  const bytes = new TextEncoder().encode(txt);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function ghPobierz(env, ref = GH.branch) {
  const r = await fetch(`https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${GH.plik}?ref=${encodeURIComponent(ref)}`, { headers: ghHeaders(env) });
  if (!r.ok) throw new Error(`GitHub nie oddał pliku (${r.status}). Sprawdź GITHUB_TOKEN.`);
  const d = await r.json();
  return { sha: d.sha, tresc: b64ToText(d.content) };
}
async function ghZapisz(env, tresc, sha, wiadomosc) {
  const r = await fetch(`https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${GH.plik}`, {
    method: 'PUT',
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: wiadomosc,
      content: textToB64(tresc),
      sha,
      branch: GH.branch,
      committer: { name: 'Redakcja Osiedla Przyjaźń', email: 'inicjatywa.op@gmail.com' },
    }),
  });
  if (!r.ok) throw new Error(`GitHub nie przyjął zmiany (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return { sha: d.commit.sha, url: d.commit.html_url };
}
async function ghHistoria(env, ile = 8) {
  const r = await fetch(`https://api.github.com/repos/${GH.owner}/${GH.repo}/commits?path=${GH.plik}&sha=${GH.branch}&per_page=${ile}`, { headers: ghHeaders(env) });
  if (!r.ok) throw new Error(`GitHub nie oddał historii (${r.status}).`);
  const d = await r.json();
  return d.map(c => ({ sha: c.sha, krotki: c.sha.slice(0, 7), wiadomosc: c.commit.message.split('\n')[0], kiedy: c.commit.committer.date, url: c.html_url }));
}

// ---------- edycje ----------
function zastosujEdycje(tresc, edycje) {
  const bledy = [];
  let wynik = tresc;
  edycje.forEach((e, i) => {
    const szukaj = String(e.szukaj ?? '');
    const zamien = String(e.zamien ?? '');
    if (!szukaj) { bledy.push(`Edycja ${i + 1}: puste pole szukaj.`); return; }
    const n = wynik.split(szukaj).length - 1;
    if (n === 0) bledy.push(`Edycja ${i + 1}: fragment nie występuje w pliku: "${szukaj.slice(0, 80)}"`);
    else if (n > 1) bledy.push(`Edycja ${i + 1}: fragment występuje ${n} razy, dodaj więcej kontekstu: "${szukaj.slice(0, 80)}"`);
    else wynik = wynik.replace(szukaj, () => zamien);
  });
  return { wynik, bledy };
}
function sprawdzBezpieczenstwo(stare, nowe) {
  const uwagi = [];
  for (const id of WYMAGANE_ID) if (!nowe.includes(`id="${id}"`)) uwagi.push(`Zniknął element id="${id}", tablica by się zepsuła.`);
  if (nowe.length < stare.length * 0.6) uwagi.push('Nowa wersja jest o ponad 40% krótsza od obecnej.');
  if (!/<\/html>\s*$/.test(nowe)) uwagi.push('Plik nie kończy się znacznikiem </html>.');
  if ((nowe.match(/<script>/g) || []).length !== (stare.match(/<script>/g) || []).length) uwagi.push('Zmieniła się liczba bloków <script>.');
  return uwagi;
}

// ---------- bot ----------
function wyciagnijJson(txt) {
  let t = String(txt).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a === -1 || b === -1) throw new Error('Bot nie odpowiedział poprawnym JSON.');
  return JSON.parse(t.slice(a, b + 1));
}

async function zapytajClaude(env, html, polecenie, kontekst) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      fallbacks: 'default',
      output_config: { effort: 'high' },
      system: [{ type: 'text', text: SYSTEM }],
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Obecny plik index.html:\n\n${html}`, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: (kontekst ? `Kontekst poprzedniej propozycji: ${kontekst}\n\n` : '') + `Polecenie administratora: ${polecenie}` },
        ],
      }],
    }),
  });
  if (!r.ok) throw new Error(`Claude API: ${r.status} ${(await r.text()).slice(0, 300)}`);
  const d = await r.json();
  if (d.stop_reason === 'refusal') throw new Error('Bot odmówił wykonania tego polecenia.');
  const txt = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  return { odp: wyciagnijJson(txt), model: d.model || MODEL };
}

async function zapytajZapasowy(env, html, polecenie, kontekst) {
  if (!env.AI) throw new Error('Brak ANTHROPIC_API_KEY i brak bindingu AI. Ustaw sekret: npx wrangler secret put ANTHROPIC_API_KEY');
  const out = await env.AI.run(MODEL_ZAPASOWY, {
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Obecny plik index.html:\n\n${html}\n\n${kontekst ? `Kontekst: ${kontekst}\n\n` : ''}Polecenie administratora: ${polecenie}` },
    ],
    max_tokens: 4096,
  });
  return { odp: wyciagnijJson(out.response), model: MODEL_ZAPASOWY + ' (tryb zapasowy)' };
}

async function zapytajBota(env, html, polecenie, kontekst) {
  return env.ANTHROPIC_API_KEY ? zapytajClaude(env, html, polecenie, kontekst) : zapytajZapasowy(env, html, polecenie, kontekst);
}

// ---------- D1 ----------
async function tabela(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS propozycje (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    polecenie TEXT NOT NULL,
    opis TEXT,
    edycje TEXT,
    tresc TEXT NOT NULL,
    baza_sha TEXT,
    model TEXT,
    status TEXT NOT NULL DEFAULT 'nowa',
    commit_sha TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();
}

// ---------- panel ----------
export const REDAKCJA_HTML = `<!DOCTYPE html>
<html lang="pl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Redakcja strony</title><meta name="robots" content="noindex">
<style>
  :root{--tynk:#F3F4EE;--smola:#24322B;--sosna:#38604D;--okiennica:#BF4630;--papier:#FBFBF7;--zolty:#F2C94C}
  *{box-sizing:border-box}
  body{font-family:system-ui,sans-serif;background:var(--tynk);color:var(--smola);max-width:900px;margin:0 auto;padding:20px;line-height:1.5}
  h1{font-size:1.5rem;margin:0 0 4px} h2{font-size:1.1rem;margin:22px 0 8px}
  .pod{opacity:.7;margin:0 0 16px}
  input,textarea{width:100%;padding:10px;border:1.5px solid var(--smola);border-radius:8px;font-size:1rem;font-family:inherit;background:var(--papier)}
  textarea{min-height:96px;resize:vertical}
  label{display:block;font-size:.85rem;font-weight:600;margin:12px 0 4px}
  button{background:var(--zolty);color:var(--smola);border:2px solid var(--smola);border-radius:10px;padding:9px 16px;font-size:.95rem;font-weight:700;cursor:pointer;box-shadow:3px 3px 0 var(--smola);margin:8px 8px 0 0}
  button:disabled{opacity:.5;cursor:wait}
  button.cichy{background:var(--papier);font-weight:500;box-shadow:none}
  button.czerwony{background:var(--okiennica);color:#fff}
  button.zielony{background:var(--sosna);color:#fff}
  .karta{background:var(--papier);border:1.5px solid var(--smola);border-radius:12px;padding:16px;margin:12px 0}
  .edycja{border-left:3px solid var(--sosna);padding:6px 12px;margin:10px 0;font-size:.85rem}
  .edycja pre{white-space:pre-wrap;word-break:break-word;margin:4px 0;padding:8px;border-radius:6px;font-size:.8rem}
  .edycja .z{background:#F8E3DF} .edycja .n{background:#E3EFE6}
  .status{font-weight:600;margin:10px 0;color:var(--sosna)} .blad{color:var(--okiennica)}
  .chipy{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
  .chip{background:var(--papier);border:1.5px solid var(--smola);border-radius:999px;padding:4px 12px;font-size:.85rem;cursor:pointer;box-shadow:none;font-weight:500;margin:0}
  iframe{width:100%;height:70vh;border:1.5px solid var(--smola);border-radius:12px;background:#fff}
  .hist{font-size:.9rem} .hist li{margin:4px 0} .hist small{opacity:.6}
  .pytanie{background:#FDF6DC;border:1.5px solid #E4D5A3;border-radius:10px;padding:12px;margin:12px 0}
  code{background:#e9ebe4;padding:1px 5px;border-radius:4px}
</style></head><body>
<h1>✍️ Redakcja strony</h1>
<p class="pod">Napisz botowi, co zmienić na osiedleprzyjazn.waw.pl. Bot pokaże, co dokładnie zmieni, a Ty zdecydujesz, czy opublikować. Każdą publikację da się cofnąć.</p>

<label for="klucz">Klucz redakcji (zapamięta się na tym urządzeniu)</label>
<input id="klucz" type="password" placeholder="wklej klucz">

<label for="polecenie">Co zmienić?</label>
<textarea id="polecenie" placeholder="np. Zmień godzinę spotkań na 19:00. Albo: Dodaj do Kuźni pomysłów kartę o osiedlowej wymiance książek w każdą pierwszą sobotę miesiąca."></textarea>
<div class="chipy" id="przyklady">
  <button class="chip">Zmień godzinę spotkań na 19:00</button>
  <button class="chip">Dodaj na oś czasu wpis o 74. urodzinach osiedla we wrześniu 2026</button>
  <button class="chip">Popraw literówki i interpunkcję w sekcji O nas, bez zmiany sensu</button>
  <button class="chip">Dodaj do Kuźni pomysłów kartę o osiedlowej wymiance książek</button>
</div>
<button id="btn-zaproponuj">Zaproponuj zmianę</button>
<span id="status" class="status"></span>

<div id="propozycja" hidden></div>
<div id="podglad-box" hidden><h2>Podgląd nowej wersji</h2><iframe id="podglad" title="Podgląd strony po zmianie"></iframe></div>

<h2>Ostatnie zmiany na stronie</h2>
<div class="karta"><ul class="hist" id="historia"><li>Ładuję…</li></ul>
<button class="cichy czerwony" id="btn-cofnij">Cofnij ostatnią zmianę</button></div>

<script>
  const API = location.origin;
  const $ = id => document.getElementById(id);
  const klucz = $('klucz');
  klucz.value = localStorage.getItem('klucz_redakcji') || localStorage.getItem('klucz_gospodarza') || '';
  klucz.addEventListener('change', () => localStorage.setItem('klucz_redakcji', klucz.value.trim()));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let biezaca = null;

  $('przyklady').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) $('polecenie').value = b.textContent; });

  async function api(sciezka, body){
    const r = await fetch(API + sciezka, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': klucz.value.trim() }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({ blad: 'Nieczytelna odpowiedź serwera.' }));
    if (!r.ok || d.blad) throw new Error(d.blad || ('Błąd ' + r.status));
    return d;
  }
  function status(t, blad){ const s = $('status'); s.textContent = t; s.className = 'status' + (blad ? ' blad' : ''); }

  async function zaproponuj(bazaId){
    const polecenie = $('polecenie').value.trim();
    if (polecenie.length < 5) return status('Napisz, co zmienić.', true);
    $('btn-zaproponuj').disabled = true; status('Bot czyta stronę i przygotowuje zmianę (10 do 60 s)…');
    try {
      const d = await api('/redakcja/propozycja', { polecenie, baza_id: bazaId || null });
      biezaca = d; pokaz(d); status('');
    } catch (e) { status(e.message, true); }
    finally { $('btn-zaproponuj').disabled = false; }
  }

  function pokaz(d){
    const box = $('propozycja'); box.hidden = false; $('podglad-box').hidden = true;
    if (d.pytanie){
      box.innerHTML = '<div class="pytanie"><b>Bot pyta:</b> ' + esc(d.pytanie) + '<br><small>Dopisz odpowiedź w polu wyżej i kliknij Zaproponuj zmianę.</small></div>';
      $('polecenie').value = $('polecenie').value + '\\n\\nOdpowiedź: ';
      $('polecenie').focus();
      return;
    }
    box.innerHTML = '<div class="karta"><b>Propozycja #' + d.id + ':</b> ' + esc(d.opis) +
      '<br><small>' + d.edycje.length + ' ' + (d.edycje.length === 1 ? 'edycja' : 'edycje') + ' · model: ' + esc(d.model) + '</small>' +
      (d.uwagi && d.uwagi.length ? '<p class="blad">⚠️ ' + d.uwagi.map(esc).join('<br>⚠️ ') + '</p>' : '') +
      d.edycje.map((e, i) => '<div class="edycja"><b>' + (i+1) + '.</b><pre class="z">' + esc(e.szukaj) + '</pre><pre class="n">' + esc(e.zamien) + '</pre></div>').join('') +
      '<button id="btn-podglad">Pokaż podgląd</button>' +
      '<button class="zielony" id="btn-publikuj">Publikuj na stronie</button>' +
      '<button class="cichy" id="btn-popraw">Popraw (dopisz uwagę wyżej)</button>' +
      '<button class="cichy" id="btn-odrzuc">Odrzuć</button></div>';
    $('btn-podglad').onclick = async () => {
      status('Ładuję podgląd…');
      try { const p = await api('/redakcja/propozycja/' + d.id); $('podglad').srcdoc = p.tresc.replace('<head>', '<head><base href="https://osiedleprzyjazn.waw.pl/">'); $('podglad-box').hidden = false; $('podglad-box').scrollIntoView({behavior:'smooth'}); status(''); }
      catch (e) { status(e.message, true); }
    };
    $('btn-publikuj').onclick = async () => {
      if (!confirm('Opublikować tę zmianę na osiedleprzyjazn.waw.pl?')) return;
      $('btn-publikuj').disabled = true; status('Publikuję…');
      try { const p = await api('/redakcja/publikuj', { id: d.id }); status('Opublikowane. Strona odświeży się w ciągu około minuty. Commit: ' + p.krotki); box.hidden = true; $('podglad-box').hidden = true; $('polecenie').value = ''; historia(); }
      catch (e) { status(e.message, true); $('btn-publikuj').disabled = false; }
    };
    $('btn-popraw').onclick = () => { $('polecenie').value = 'Popraw poprzednią propozycję: '; $('polecenie').focus(); $('btn-zaproponuj').onclick = () => zaproponuj(d.id); status('Dopisz, co poprawić, i kliknij Zaproponuj zmianę.'); };
    $('btn-odrzuc').onclick = () => { box.hidden = true; $('podglad-box').hidden = true; biezaca = null; $('btn-zaproponuj').onclick = () => zaproponuj(); status('Odrzucone.'); };
  }

  async function historia(){
    try {
      const d = await api('/redakcja/stan');
      $('historia').innerHTML = d.historia.map(h => '<li><a href="' + esc(h.url) + '" rel="noopener">' + esc(h.krotki) + '</a> ' + esc(h.wiadomosc) + ' <small>' + esc(h.kiedy.replace('T',' ').slice(0,16)) + '</small></li>').join('') || '<li>Brak historii.</li>';
      if (!d.bot) $('historia').insertAdjacentHTML('afterend', '<p class="blad">Bot działa w trybie zapasowym (brak klucza Anthropic). Jakość propozycji może być niższa.</p>');
    } catch (e) { $('historia').innerHTML = '<li class="blad">' + esc(e.message) + '</li>'; }
  }
  $('btn-cofnij').onclick = async () => {
    if (!confirm('Cofnąć ostatnią zmianę na stronie? Wróci poprzednia wersja.')) return;
    status('Cofam…');
    try { const p = await api('/redakcja/cofnij', {}); status('Cofnięte. Commit: ' + p.krotki + '. Strona odświeży się w ciągu około minuty.'); historia(); }
    catch (e) { status(e.message, true); }
  };
  $('btn-zaproponuj').onclick = () => zaproponuj();
  if (klucz.value) historia(); else $('historia').innerHTML = '<li>Wklej klucz, żeby zobaczyć historię.</li>';
  klucz.addEventListener('change', historia);
</script></body></html>`;

// ---------- router ----------
export async function redakcja(req, env, path, json) {
  if (req.method === 'GET' && path === '/redakcja') {
    return new Response(REDAKCJA_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  const klucz = req.headers.get('X-Admin-Key') || '';
  if (!klucz || (klucz !== env.ADMIN_KEY && klucz !== env.REDAKCJA_KEY)) return json(req, { blad: 'Zły klucz redakcji.' }, 403);
  if (!env.GITHUB_TOKEN) return json(req, { blad: 'Brak GITHUB_TOKEN w sekretach workera.' }, 500);

  try {
    if (req.method === 'GET' && path === '/redakcja/stan') {
      const historia = await ghHistoria(env);
      return json(req, { historia, bot: Boolean(env.ANTHROPIC_API_KEY) });
    }

    const jedna = path.match(/^\/redakcja\/propozycja\/(\d+)$/);
    if (req.method === 'GET' && jedna) {
      await tabela(env);
      const row = await env.DB.prepare(`SELECT id, opis, tresc, status FROM propozycje WHERE id = ?`).bind(Number(jedna[1])).first();
      if (!row) return json(req, { blad: 'Nie ma takiej propozycji.' }, 404);
      return json(req, row);
    }

    if (req.method === 'POST' && path === '/redakcja/propozycja') {
      await tabela(env);
      const cialo = await req.json().catch(() => ({}));
      const polecenie = String(cialo.polecenie || '').trim().slice(0, 4000);
      if (polecenie.length < 5) return json(req, { blad: 'Napisz, co zmienić.' }, 400);

      let baza, kontekst = '';
      if (cialo.baza_id) {
        const poprzednia = await env.DB.prepare(`SELECT tresc, opis, polecenie, baza_sha FROM propozycje WHERE id = ?`).bind(Number(cialo.baza_id)).first();
        if (poprzednia) { baza = { sha: poprzednia.baza_sha, tresc: poprzednia.tresc }; kontekst = `poprzednie polecenie: "${poprzednia.polecenie}", bot zrobił: "${poprzednia.opis}". Plik poniżej zawiera już tamtą zmianę.`; }
      }
      if (!baza) baza = await ghPobierz(env);

      let { odp, model } = await zapytajBota(env, baza.tresc, polecenie, kontekst);
      let edycje = Array.isArray(odp.edycje) ? odp.edycje : [];
      if (odp.pytanie && !edycje.length) return json(req, { pytanie: String(odp.pytanie), model });

      let { wynik, bledy } = zastosujEdycje(baza.tresc, edycje);
      if (bledy.length) {
        // jedna automatyczna poprawka: bot dostaje listę nietrafionych fragmentów
        const drugi = await zapytajBota(env, baza.tresc, polecenie, `${kontekst} Poprzednia próba nie trafiła w kod. Błędy: ${bledy.join(' | ')}. Skopiuj fragmenty "szukaj" dokładnie z pliku.`);
        odp = drugi.odp; model = drugi.model;
        edycje = Array.isArray(odp.edycje) ? odp.edycje : [];
        ({ wynik, bledy } = zastosujEdycje(baza.tresc, edycje));
        if (bledy.length) return json(req, { blad: 'Bot nie trafił w kod strony. ' + bledy.join(' ') }, 422);
      }
      if (!edycje.length) return json(req, { blad: 'Bot nie zaproponował żadnej zmiany. Spróbuj opisać ją inaczej.' }, 422);

      const uwagi = sprawdzBezpieczenstwo(baza.tresc, wynik);
      const r = await env.DB.prepare(
        `INSERT INTO propozycje (polecenie, opis, edycje, tresc, baza_sha, model) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(polecenie, String(odp.opis || ''), JSON.stringify(edycje), wynik, baza.sha, model).run();
      return json(req, { id: r.meta.last_row_id, opis: String(odp.opis || ''), edycje, uwagi, model });
    }

    if (req.method === 'POST' && path === '/redakcja/publikuj') {
      await tabela(env);
      const { id } = await req.json().catch(() => ({}));
      const row = await env.DB.prepare(`SELECT * FROM propozycje WHERE id = ?`).bind(Number(id)).first();
      if (!row) return json(req, { blad: 'Nie ma takiej propozycji.' }, 404);
      if (row.status === 'opublikowana') return json(req, { blad: 'Ta propozycja jest już opublikowana.' }, 409);
      const aktualny = await ghPobierz(env);
      const c = await ghZapisz(env, row.tresc, aktualny.sha, `Redakcja: ${row.opis || row.polecenie.slice(0, 60)}\n\nPolecenie: ${row.polecenie}\nPropozycja #${row.id}, model ${row.model}`);
      await env.DB.prepare(`UPDATE propozycje SET status = 'opublikowana', commit_sha = ? WHERE id = ?`).bind(c.sha, row.id).run();
      return json(req, { ok: true, krotki: c.sha.slice(0, 7), url: c.url });
    }

    if (req.method === 'POST' && path === '/redakcja/cofnij') {
      const hist = await ghHistoria(env, 2);
      if (hist.length < 2) return json(req, { blad: 'Nie ma czego cofać.' }, 409);
      const poprzednia = await ghPobierz(env, hist[1].sha);
      const aktualny = await ghPobierz(env);
      const c = await ghZapisz(env, poprzednia.tresc, aktualny.sha, `Redakcja: cofnięcie zmiany ${hist[0].krotki} (${hist[0].wiadomosc.slice(0, 60)})`);
      return json(req, { ok: true, krotki: c.sha.slice(0, 7), url: c.url, cofnieto: hist[0].krotki });
    }
  } catch (e) {
    return json(req, { blad: e.message || String(e) }, 500);
  }
  return null;
}

export const _test = { zastosujEdycje, sprawdzBezpieczenstwo, wyciagnijJson, textToB64, b64ToText };
