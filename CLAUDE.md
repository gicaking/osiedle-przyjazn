# osiedle_przyjazn — oficjalna strona Inicjatywy Osiedle Przyjaźń

Strona https://osiedleprzyjazn.waw.pl (Warszawa, Bemowo, Jelonki). Repo `gicaking/osiedle-przyjazn`, branch `master`. Od 2026-09-19 strona jest oficjalną stroną Inicjatywy Osiedle Przyjaźń (wcześniej strona sąsiedzka). Motyw: własny, drewniano-zielony (NIE kopia Facebooka, Andrzej to odrzucił). Głównym motywem graficznym jest logo Inicjatywy `img/logo.png` (naklejka w hero, wizytówka w O nas, nav, stopka, favicon).

## Architektura

- **Front:** jeden plik `index.html` (CSS inline w `<style>`, JS tablicy na końcu). Sekcje po `id`: `onas` (tekst, wizytówka, cele, postulaty, blok `#kontakt`), `historia`, `ludzie`, `tablica`, `kuznia`, `wsieci`, `<footer>`. Fonty Google (Fraunces, Work Sans, Caveat). Kolory w `:root` (tynk, smoła, sosna, okiennica, domek, deska, papier, logo). Obrazek udostępniania: `og.jpg` (logo plus nazwa na tynku). Kanały: Facebook, Instagram (inicjatywa_osiedle_przyjazn), X (@OsiedlePrzyjazn), mail.
- **Hosting:** GitHub Pages z `master` (build legacy, `CNAME`). Deploy = push na `master`, ~1 min. DNS w Cloudflare (rekordy A na GitHub Pages).
- **Backend tablicy:** `worker/` = Cloudflare Worker `tablica-przyjazn`, domena `api.osiedleprzyjazn.waw.pl`, D1 `tablica_przyjazn` (id w `wrangler.toml`). Endpointy: `GET/POST /ogloszenia`, `POST /ogloszenia/:id/serce`, `DELETE /ogloszenia/:id` (nagłówek `X-Admin-Key` = secret `ADMIN_KEY`), `GET/POST /wizyta` (dzienny licznik; tabela `wizyty` NIE jest w `schema.sql`, założona ręcznie), `GET /gospodarz` (panel moderacji, HTML w workerze). Stałe: `DNI_WAZNOSCI = 60`, `LIMITY` pól.
- **Deploy workera:** `cd worker && npx wrangler deploy` (tylko właściciel; wymaga `wrangler login`).
- **Redakcja (panel admina z botem):** `worker/src/redakcja.js`, panel pod `https://api.osiedleprzyjazn.waw.pl/redakcja` (klucz = `ADMIN_KEY`, ten sam co gospodarz tablicy). Endpointy: `GET /redakcja/stan` (historia commitów), `POST /redakcja/propozycja` `{polecenie, baza_id?}` (bot proponuje edycje szukaj/zamień, zapis w D1 `propozycje`), `GET /redakcja/propozycja/:id` (pełny HTML do podglądu), `POST /redakcja/publikuj` `{id}` (commit `index.html` przez GitHub Contents API), `POST /redakcja/cofnij` (przywraca poprzednią wersję pliku nowym commitem). Sekrety: `GITHUB_TOKEN` (fine-grained PAT, Contents: read/write na repo), `ANTHROPIC_API_KEY` (model `claude-opus-5`; bez klucza tryb zapasowy Workers AI, binding `AI`). Tabela `propozycje` tworzy się sama.

## Zasady treści (ważne przy każdej edycji)

- Ton sąsiedzki, ciepły, NVC. Krótkie zdania. Po polsku z polskimi znakami.
- Sekcja **O nas** (tekst, cele, postulaty, kontakt, spotkania) to oficjalny tekst Inicjatywy dostarczony 2026-09-19. Zmieniać tylko na prośbę Andrzeja. Postulaty wobec ZMSP są tam celowo (to głos Inicjatywy), ale poza tą sekcją nadal bez wątków prawnych i sporów lokatorskich.
- Fakty do dat: domy studenckie od 1955, Inicjatywa od 2012, Karuzela zamknięta 2021, wpis do rejestru zabytków 7 listopada 2024 (MWKZ, razem z Karuzelą), wypowiedzenie umów studentom 2025.
- Bez myślników w tekstach (styl Andrzeja): kropki, przecinki, dwukropki.
- Osoby tylko za zgodą; bez danych dzieci. Linki tylko do miejsc związanych z osiedlem (Inicjatywa przyjazn.org, BCK bemowskie.pl, źródła historyczne).
- Nie ruszać `CNAME`, `robots.txt`, `sitemap.xml` bez potrzeby. Po zmianie treści zaktualizować `<meta name="description">` i `og:` tylko gdy zmienia się sens strony.

## Współtworzenie

`CONTRIBUTING.md` (po polsku, dla sąsiadów bez kodu), szablony w `.github/`. PR-y scala właściciel. Gdy pojawi się drugi edytor z prawem zapisu: włączyć branch protection na `master` (require PR).

## Testowanie lokalne

`python3 -m http.server 8000` w katalogu repo. Uwaga: lokalna kopia gada z produkcyjnym API tablicy, więc testowe kartki są prawdziwe (zdejmuje panel `/gospodarz`).
