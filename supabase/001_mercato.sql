-- Il deposito di ALBA: gli esiti di vendita condivisi e le impostazioni.
-- Si esegue una volta sola, nel SQL Editor di Supabase.
--
-- Cosa c'e' dentro: marca, categoria, condizione, quanto era stato suggerito,
-- quanto e' stato incassato, in quanti giorni. Cosa NON c'e', e non ci deve
-- finire mai: foto, testo scritto dall'utente, e qualunque cosa che dica CHI
-- ha venduto. "dispositivo" e' un'impronta casuale nata nel browser: serve a
-- contare quanti esiti arrivano dalla stessa parte, non a riconoscere qualcuno.

create table if not exists public.esiti (
  id               bigint generated always as identity primary key,
  creato_il        timestamptz not null default now(),
  marca            text not null check (length(marca) between 1 and 40),
  categoria        text check (categoria is null or length(categoria) <= 40),
  condizione       text check (condizione is null or length(condizione) <= 30),
  prezzo_suggerito numeric(10,2) not null check (prezzo_suggerito > 0 and prezzo_suggerito <= 100000),
  prezzo_venduto   numeric(10,2) not null check (prezzo_venduto  > 0 and prezzo_venduto  <= 100000),
  giorni           int check (giorni is null or (giorni >= 0 and giorni <= 3650)),
  dispositivo      text not null check (length(dispositivo) between 8 and 64),

  -- Un capo venduto a un ventesimo o a cinque volte il suggerito non e' un
  -- dato, e' un errore di battitura o qualcuno che gioca: non entra proprio.
  -- Tenerlo fuori qui vale piu' che filtrarlo dopo, perche' questa riga vale
  -- anche per chi scrivesse nel database da un'altra strada.
  constraint esito_plausibile check (
    prezzo_venduto >= prezzo_suggerito * 0.05 and
    prezzo_venduto <= prezzo_suggerito * 5
  )
);

-- Lo scarto in percentuale e' quello su cui si fanno tutti i conti: calcolato
-- una volta qui invece che in ogni query.
alter table public.esiti
  add column if not exists scarto numeric(6,2)
  generated always as (round((prezzo_venduto - prezzo_suggerito) / prezzo_suggerito * 100, 2)) stored;

create index if not exists esiti_marca_idx on public.esiti (lower(marca), creato_il desc);
create index if not exists esiti_categoria_idx on public.esiti (lower(categoria), creato_il desc);

create table if not exists public.impostazioni (
  chiave        text primary key,
  valore        text not null,
  aggiornato_il timestamptz not null default now()
);

-- Acceso di default: se il sito ha un ALBA_PIN, il codice si chiede. Lo si
-- spegne dal tasto dentro ALBA, non da qui.
insert into public.impostazioni (chiave, valore) values ('pin_attivo', '1')
  on conflict (chiave) do nothing;

-- Nessuno entra da fuori: le due tabelle hanno RLS acceso e nessuna policy,
-- quindi le chiavi pubbliche non ci arrivano. Ci arriva solo la function di
-- ALBA, che usa la service key e le policy le scavalca.
alter table public.esiti enable row level security;
alter table public.impostazioni enable row level security;

-- La banda del mercato. Prima prova la marca, poi la categoria, poi tutto
-- quanto: sotto p_min esiti non risponde, perche' tre vendite non sono un
-- mercato e un numero costruito su tre vendite sembrerebbe una misura.
-- Mediane e non medie: e' quello che rende il conto difficile da spostare per
-- chi volesse mandare numeri finti.
create or replace function public.banda_mercato(
  p_marca text default null,
  p_categoria text default null,
  p_min int default 5
)
returns table (n int, scarto numeric, giorni numeric, ambito text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ambito text;
begin
  -- Solo gli ultimi diciotto mesi: i prezzi dell'usato di tre anni fa non
  -- dicono niente su quelli di adesso.
  if p_marca is not null and (
       select count(*) from public.esiti
        where lower(marca) = lower(p_marca) and creato_il > now() - interval '18 months') >= p_min then
    v_ambito := 'marca';
    return query
      select count(*)::int,
             round(percentile_cont(0.5) within group (order by e.scarto)::numeric, 0),
             round(percentile_cont(0.5) within group (order by e.giorni)::numeric, 0),
             v_ambito
        from public.esiti e
       where lower(e.marca) = lower(p_marca) and e.creato_il > now() - interval '18 months';
    return;
  end if;

  if p_categoria is not null and (
       select count(*) from public.esiti
        where lower(categoria) = lower(p_categoria) and creato_il > now() - interval '18 months') >= p_min then
    v_ambito := 'categoria';
    return query
      select count(*)::int,
             round(percentile_cont(0.5) within group (order by e.scarto)::numeric, 0),
             round(percentile_cont(0.5) within group (order by e.giorni)::numeric, 0),
             v_ambito
        from public.esiti e
       where lower(e.categoria) = lower(p_categoria) and e.creato_il > now() - interval '18 months';
    return;
  end if;

  v_ambito := 'tutti';
  return query
    select count(*)::int,
           round(percentile_cont(0.5) within group (order by e.scarto)::numeric, 0),
           round(percentile_cont(0.5) within group (order by e.giorni)::numeric, 0),
           v_ambito
      from public.esiti e
     where e.creato_il > now() - interval '18 months'
    having count(*) >= p_min;
end;
$$;

revoke all on function public.banda_mercato(text, text, int) from anon, authenticated;
