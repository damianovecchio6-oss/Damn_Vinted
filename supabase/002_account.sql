-- Lo storico personale, per chi crea un account. Si esegue una volta sola,
-- nel SQL Editor di Supabase, dopo 001_mercato.sql (Auth deve gia' esistere,
-- ma su Supabase c'e' sempre: non e' un'estensione da attivare).
--
-- E' un altro giro rispetto a esiti/impostazioni: quella tabella e' anonima
-- per scelta, questa e' esplicitamente di una persona (auth.users). Restano
-- comunque due regole uguali: RLS accesa senza policy - nessuna chiave
-- pubblica ci arriva, solo la function con la service key, che controlla lei
-- che user_id sia quello di chi ha firmato il token - e niente qui dentro
-- che il deposito condiviso non deve mai vedere in giro: questa tabella non
-- alimenta banda_mercato, resta un fatto privato di chi l'ha scritta.

create table if not exists public.storico_utenti (
  id               text not null check (length(id) between 1 and 64),
  user_id          uuid not null references auth.users(id) on delete cascade,
  creato_il        timestamptz not null default now(),
  aggiornato_il    timestamptz not null default now(),

  nome             text check (nome is null or length(nome) <= 120),
  marca            text check (marca is null or length(marca) <= 60),
  taglia           text check (taglia is null or length(taglia) <= 20),
  condizione       text check (condizione is null or length(condizione) <= 30),
  titolo           text check (titolo is null or length(titolo) <= 200),
  descrizione      text check (descrizione is null or length(descrizione) <= 2000),
  hashtag          text check (hashtag is null or length(hashtag) <= 500),
  consiglio        text check (consiglio is null or length(consiglio) <= 500),
  fiducia          text check (fiducia is null or length(fiducia) <= 20),

  prezzo_suggerito numeric(10,2),
  range_min        numeric(10,2),
  range_max        numeric(10,2),

  -- L'esito della vendita e il profilo di fiducia per campo (sxProfilo): gia'
  -- oggetti piccoli e piatti lato client, entrano cosi' come sono.
  esito            jsonb,
  profilo          jsonb,

  -- Il percorso dentro il bucket Storage, non l'URL: quello si firma al volo
  -- quando si legge, cosi' non resta valido per sempre.
  foto_percorso    text,

  primary key (user_id, id)
);

create index if not exists storico_utenti_user_idx on public.storico_utenti (user_id, aggiornato_il desc);

alter table public.storico_utenti enable row level security;

-- Il bucket per le foto NON si crea da SQL: dal pannello Supabase, Storage >
-- New bucket > nome "storico-foto" > Public bucket **disattivato** (resta
-- privato, si legge solo con URL firmati che genera la function). Nessuna
-- policy da aggiungere: ci arriva solo la function, con la service key, che
-- bypassa le RLS di Storage come fa con quelle del database.
