// Edytor klikalny: strona w trybie edycji, zapis = commit index.html na GitHub.
import EDYTOR_HTML from './edytor.html';
import EDYTOR_JS from './edytor_client.js.txt';
import { ghPobierz, ghZapisz, ghHeaders, textToB64, zastosujEdycje, sprawdzBezpieczenstwo, zapytajBota, GH } from './redakcja.js';

const MAX_PLIK = 3 * 1024 * 1024;

function bezpiecznaNazwa(n) {
  const base = String(n || 'zdjecie').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'zdjecie';
  return base.includes('.') ? base : base + '.jpg';
}

export function edytorStrony(req, path) {
  if (req.method === 'GET' && path === '/edytor') {
    return new Response(EDYTOR_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  if (req.method === 'GET' && path === '/edytor.js') {
    return new Response(EDYTOR_JS, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  return null;
}

// wywoływane z routera redakcji, po sprawdzeniu klucza i tokenu GitHub
export async function edytorApi(req, env, path, json) {
  if (req.method === 'GET' && path === '/redakcja/zrodlo') {
    const { sha, tresc } = await ghPobierz(env);
    return json(req, { sha, html: tresc });
  }

  if (req.method === 'POST' && path === '/redakcja/publikuj-html') {
    const cialo = await req.json().catch(() => ({}));
    const html = String(cialo.html || '');
    if (html.length < 5000 || !/^<!DOCTYPE html>/i.test(html.trim())) return json(req, { blad: 'To nie wygląda na całą stronę. Odśwież edytor i spróbuj ponownie.' }, 400);
    if (/data-edytor|contenteditable=/.test(html)) return json(req, { blad: 'W kodzie zostały ślady edytora. Odśwież edytor i spróbuj ponownie.' }, 400);
    const aktualny = await ghPobierz(env);
    if (html === aktualny.tresc) return json(req, { blad: 'Strona jest identyczna z opublikowaną, nie ma czego zapisywać.' }, 409);
    const uwagi = sprawdzBezpieczenstwo(aktualny.tresc, html);
    if (uwagi.length && !cialo.wymus) return json(req, { blad: 'Uwaga: ' + uwagi.join(' ') + ' (wymus)' }, 422);
    const opis = String(cialo.opis || '').trim().slice(0, 120) || 'zmiany w edytorze';
    const c = await ghZapisz(env, html, aktualny.sha, `Edytor: ${opis}`);
    return json(req, { ok: true, krotki: c.sha.slice(0, 7), url: c.url });
  }

  if (req.method === 'POST' && path === '/redakcja/plik') {
    const cialo = await req.json().catch(() => ({}));
    const dane = String(cialo.dane || '');
    if (!dane || dane.length > MAX_PLIK * 1.4) return json(req, { blad: 'Plik jest pusty albo za duży (limit 3 MB).' }, 400);
    if (!/^image\//.test(String(cialo.typ || ''))) return json(req, { blad: 'Można wgrywać tylko obrazki.' }, 400);
    const nazwa = bezpiecznaNazwa(cialo.nazwa);
    const sciezka = `img/${Date.now().toString(36)}-${nazwa}`;
    const r = await fetch(`https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${sciezka}`, {
      method: 'PUT',
      headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Edytor: zdjęcie ${nazwa}`, content: dane, branch: GH.branch }),
    });
    if (!r.ok) return json(req, { blad: `GitHub nie przyjął pliku (${r.status}).` }, 502);
    return json(req, { ok: true, sciezka });
  }

  if (req.method === 'POST' && path === '/redakcja/bot-html') {
    const cialo = await req.json().catch(() => ({}));
    const html = String(cialo.html || '');
    const polecenie = String(cialo.polecenie || '').trim().slice(0, 4000);
    if (html.length < 5000) return json(req, { blad: 'Brak treści strony.' }, 400);
    if (polecenie.length < 5) return json(req, { blad: 'Napisz, co zmienić.' }, 400);
    let { odp, model } = await zapytajBota(env, html, polecenie, '');
    let edycje = Array.isArray(odp.edycje) ? odp.edycje : [];
    if (odp.pytanie && !edycje.length) return json(req, { pytanie: String(odp.pytanie), model });
    let { wynik, bledy } = zastosujEdycje(html, edycje);
    if (bledy.length) {
      const drugi = await zapytajBota(env, html, polecenie, `Poprzednia próba nie trafiła w kod. Błędy: ${bledy.join(' | ')}. Skopiuj fragmenty "szukaj" dokładnie z pliku.`);
      odp = drugi.odp; model = drugi.model;
      edycje = Array.isArray(odp.edycje) ? odp.edycje : [];
      ({ wynik, bledy } = zastosujEdycje(html, edycje));
      if (bledy.length) return json(req, { blad: 'Bot nie trafił w kod strony. ' + bledy.join(' ') }, 422);
    }
    if (!edycje.length) return json(req, { blad: 'Bot nie zaproponował żadnej zmiany.' }, 422);
    return json(req, { html: wynik, opis: String(odp.opis || ''), model, edycje: edycje.length });
  }
  return null;
}
