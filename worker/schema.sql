CREATE TABLE IF NOT EXISTS ogloszenia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tytul TEXT NOT NULL,
  tresc TEXT NOT NULL,
  kategoria TEXT NOT NULL DEFAULT 'inne',
  podpis TEXT DEFAULT '',
  kontakt TEXT DEFAULT '',
  serca INTEGER DEFAULT 0,
  status TEXT DEFAULT 'ok',
  ip_hash TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ogloszenia_status_created ON ogloszenia(status, created_at DESC);

INSERT INTO ogloszenia (tytul, tresc, kategoria, podpis) VALUES
('Śpiewanie przy ognisku', 'Piątek po zmroku, podwórko przy dużym klonie. Gitara będzie, śpiewniki będą, przynieś tylko głos i coś na ruszt.', 'wydarzenie', 'sąsiedzi od klonu'),
('Plener rysunkowy', 'Sobota rano, zbiórka przy domkach z czerwonymi okiennicami. Kredki dla dzieci mamy, sztalugi swoje.', 'wydarzenie', 'ekipa plenerowa'),
('Oddam sadzonki malin', 'Rozrosły się przy płocie bardziej, niż planowałem. Do wzięcia od ręki, najlepiej z doniczką albo wiaderkiem.', 'wymiana', 'ogrodnik z alejki'),
('Meldunki dla Ratowniczki', 'Ratowniczka Osiedla przyjmuje zgłoszenia kotów do pogłaskania oraz kałuż do obserwacji. Kolejka bywa długa, prosimy o cierpliwość.', 'inne', 'sztab Ratowniczki'),
('Archiwum Głosów szuka uszu', 'Nagrywamy wspomnienia najstarszych sąsiadów. Jeśli Twoja babcia, dziadek albo Ty macie historię z osiedla, zapraszamy do opowiedzenia jej.', 'szukam', 'kronikarze'),
('Twoja kartka', 'To miejsce czeka na Twoje ogłoszenie. Kliknij Powieś kartkę i podziel się czymś z sąsiadami.', 'inne', 'tablica');
