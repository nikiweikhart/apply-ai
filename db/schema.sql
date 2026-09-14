-- Apply AI - Datenbankaufbau
-- Einfuegen im Supabase-Dashboard unter "SQL Editor" und ausfuehren.

-- =====================================================================
-- portals: welche Jobportale durchsucht werden und wie es zuletzt lief
-- =====================================================================
create table if not exists portals (
  id            text primary key,              -- z.B. 'willhaben'
  display_name  text not null,
  search_url    text not null,
  filters       jsonb not null default '{}',   -- Ort, Anstellungsart, Stichworte
  enabled       boolean not null default true,
  status        text not null default 'ok',    -- ok | adapter_broken | blocked | disabled
  status_note   text,
  last_run_at   timestamptz,
  last_ok_at    timestamptz,
  created_at    timestamptz not null default now()
);

-- =====================================================================
-- jobs: jede gefundene Stellenanzeige, genau einmal
-- =====================================================================
create table if not exists jobs (
  id            uuid primary key default gen_random_uuid(),
  portal_id     text references portals(id),
  external_id   text,                          -- ID des Portals, falls vorhanden
  url           text not null,
  fingerprint   text not null unique,          -- Hash aus Firma+Titel+Ort gegen Doppelte
  title         text not null,
  company       text,
  location      text,
  employment    text,                          -- geringfuegig / Teilzeit / ...
  description   text,                          -- voller Anzeigentext
  contact_email text,
  posted_at     timestamptz,
  found_at      timestamptz not null default now()
);
create index if not exists jobs_found_at_idx on jobs (found_at desc);

-- =====================================================================
-- scores: Bewertung einer Anzeige
-- =====================================================================
create table if not exists scores (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references jobs(id) on delete cascade,
  score         int  not null check (score between 0 and 100),
  reasoning     text not null,
  kjbg_ok       boolean not null,              -- Jugendschutz-Pruefung bestanden?
  kjbg_reason   text,                          -- warum nicht, falls nein
  hard_filtered boolean not null default false,-- schon vom Code-Filter aussortiert?
  model         text,                          -- welches Modell hat bewertet
  created_at    timestamptz not null default now(),
  unique (job_id)
);
create index if not exists scores_score_idx on scores (score desc);

-- =====================================================================
-- applications: eine Bewerbung zu einer Anzeige
-- =====================================================================
create table if not exists applications (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references jobs(id) on delete cascade,
  status        text not null default 'draft',
  -- draft | pending_approval | approved | sent | failed | needs_manual | rejected
  channel       text,                          -- mail | portal
  cover_letter  text,
  subject       text,
  sent_at       timestamptz,
  error         text,
  proof_path    text,                          -- Screenshot im Supabase-Speicher
  reply_status  text,                          -- keine | einladung | absage | rueckfrage
  reply_at      timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (job_id)
);
create index if not exists applications_status_idx on applications (status);

-- =====================================================================
-- settings: ein einziger Datensatz mit Nikis Profil und Regeln
-- =====================================================================
create table if not exists settings (
  id               int primary key default 1 check (id = 1),
  profile_text     text,                       -- Profiltext fuer Jobseiten
  cover_template   text,                       -- Anschreiben-Vorlage
  cv_storage_path  text,                       -- Pfad zum Lebenslauf im Speicher
  availability     jsonb not null default '{}',
  exclusions       jsonb not null default '{}',-- Ausschlussregeln (Branchen, Orte, ...)
  auto_send_min    int not null default 70,    -- ab dieser Punktzahl ohne Rueckfrage (2026-08-30 von 80 gesenkt)
  approval_min     int not null default 60,    -- ab dieser Punktzahl Telegram-Freigabe
  updated_at       timestamptz not null default now()
);
insert into settings (id) values (1) on conflict (id) do nothing;

-- =====================================================================
-- events: lueckenloses Protokoll inkl. Kosten
-- =====================================================================
create table if not exists events (
  id            bigserial primary key,
  agent         text not null,                 -- scout | score | write | freigabe | mail | browser
  level         text not null default 'info',  -- info | warn | error
  message       text not null,
  job_id        uuid references jobs(id) on delete set null,
  data          jsonb,
  input_tokens  int,
  output_tokens int,
  cost_usd      numeric(10,6),
  run_minutes   numeric(8,2),
  created_at    timestamptz not null default now()
);
create index if not exists events_created_at_idx on events (created_at desc);

-- =====================================================================
-- Zugriffsschutz: alles zu. Der Motor benutzt den service_role-Schluessel,
-- der diese Sperre umgeht. Ohne Regeln kommt sonst niemand an die Daten.
-- =====================================================================
alter table portals      enable row level security;
alter table jobs         enable row level security;
alter table scores       enable row level security;
alter table applications enable row level security;
alter table settings     enable row level security;
alter table events       enable row level security;

-- =====================================================================
-- Startwerte: die sechs Portale, auf denen Niki ein Profil hat.
-- prio       = Reihenfolge, in der die Adapter gebaut werden
-- bot_risiko = wie wahrscheinlich das Portal Automatisierung blockt
--
-- Diese Liste wird auch von engine/src/seed-portals.ts gepflegt
-- ("npm run seed") - dort ist sie aenderbar, ohne SQL anzufassen.
-- =====================================================================
insert into portals (id, display_name, search_url, filters) values
  ('hokify',     'hokify',         'https://hokify.at/jobs',
     '{"ort":"Wien","anstellung":["geringfuegig","Teilzeit"],"prio":1,"bot_risiko":"niedrig"}'),
  ('willhaben',  'willhaben Jobs', 'https://www.willhaben.at/jobs/',
     '{"ort":"Wien","anstellung":["geringfuegig","Teilzeit"],"prio":2,"bot_risiko":"niedrig"}'),
  ('ams',        'AMS alle jobs',  'https://jobs.ams.at/public/emps/jobs',
     '{"ort":"Wien","prio":3,"bot_risiko":"niedrig"}'),
  ('studentjob', 'StudentJob.at',  'https://www.studentjob.at/samstagsjob/wien',
     '{"ort":"Wien","prio":4,"bot_risiko":"niedrig"}'),
  ('karriere',   'karriere.at',    'https://www.karriere.at/jobs',
     '{"ort":"Wien","anstellung":["geringfuegig","Teilzeit"],"prio":5,"bot_risiko":"mittel"}'),
  ('indeed',     'Indeed AT',      'https://at.indeed.com/jobs',
     '{"ort":"Wien","anstellung":["geringfuegig","Teilzeit"],"prio":6,"bot_risiko":"hoch"}')
on conflict (id) do nothing;
