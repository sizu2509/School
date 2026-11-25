-- ============================================================
-- স্কুল + অফিস ম্যানেজমেন্ট ওয়েবসাইট — সম্পূর্ণ PostgreSQL / Supabase SQL স্কিমা
-- চালান: Supabase Dashboard → SQL Editor → New query → Run
-- স্ক্রিপ্টটি একাধিকবার চালানো নিরাপদ (IF NOT EXISTS / ON CONFLICT)।
-- ============================================================

-- ১. স্কুলের সেটিংস
create table if not exists public.school_settings (
  id text primary key default 'main',
  name text not null default 'আমার স্কুল',
  motto text default 'জ্ঞানেই আলো, চরিত্রেই শক্তি',
  established text default '',
  address text default '',
  phone text default '',
  email text default '',
  show_yearly_cost_at_admission boolean not null default true,
  principal_name text default '',
  principal_phone text default '',
  id_logo text default '',
  principal_signature text default '',
  principal_msg text default '',
  fb text default '',
  yt text default '',
  ig text default '',
  updated_at timestamptz not null default now()
);

-- ২. শ্রেণিসমূহ (প্লে থেকে দ্বাদশ — ১৫টি শ্রেণি)
create table if not exists public.classes (
  id text primary key,
  name text not null unique,
  display_order integer not null default 0,
  sections text default 'ক, খ, গ',
  room text default '',
  capacity integer not null default 0,
  extra_activities jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- ৩. শ্রেণির শাখাসমূহ (প্রতিটি শ্রেণির ৩টি শাখা: শাখার নাম, রুম নং, আসন সংখ্যা)
create table if not exists public.class_sections (
  id text primary key,
  class_id text not null references public.classes(id) on delete cascade,
  section_name text not null,
  room_no text not null default '',
  seat_capacity integer not null default 40,
  subjects jsonb,
  updated_at timestamptz not null default now(),
  unique (class_id, section_name)
);

-- ৪. বিষয় ও বোর্ড বইসমূহ
create table if not exists public.subjects (
  id text primary key,
  name text not null default '',
  code text default '',
  classes text default 'সব শ্রেণি',
  book_group text default 'সাধারণ',
  section text default 'সব শাখা',
  updated_at timestamptz not null default now()
);

-- ৪.১ শ্রেণিভিত্তিক বোর্ড বইসমূহ (প্লে থেকে দ্বাদশ — এনসিটিবি তালিকা)
create table if not exists public.board_books (
  id text primary key,
  class_id text not null references public.classes(id) on delete cascade,
  class_name text not null default '',
  book_group text not null default 'সাধারণ',
  title text not null default '',
  display_order integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (class_id, book_group, title)
);

-- ৪.২ শ্রেণিভিত্তিক এক্সট্রা অ্যাকটিভিটিস (প্রতিটি শ্রেণির জন্য ১১টি সহপাঠ্যক্রমিক বিষয়)
create table if not exists public.class_extra_activities (
  id text primary key,
  class_id text not null references public.classes(id) on delete cascade,
  class_name text not null default '',
  title text not null default '',
  display_order integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (class_id, title)
);

-- ৫. শিক্ষার্থী
create table if not exists public.students (
  id text primary key,
  name text not null default '',
  cls text default '',
  roll integer,
  section text default 'ক',
  guardian text default '',
  phone text default '',
  payable numeric not null default 0,
  paid numeric not null default 0,
  photo text default '',
  admission_date text default '',
  updated_at timestamptz not null default now()
);

-- ৬. শিক্ষকবৃন্দ
create table if not exists public.teachers (
  id text primary key,
  name text not null default '',
  subject text default '',
  phone text default '',
  qualification text default '',
  photo text default '',
  updated_at timestamptz not null default now()
);

-- ৭. নোটিশ বোর্ড
create table if not exists public.notices (
  id text primary key,
  title text not null default '',
  body text default '',
  date text default '',
  updated_at timestamptz not null default now()
);

-- ৮. অনলাইন ভর্তি আবেদন
create table if not exists public.admissions (
  id text primary key,
  name text not null default '',
  cls text default '',
  section text default 'ক',
  guardian text default '',
  phone text default '',
  address text default '',
  status text not null default 'pending',
  apply_date text default '',
  updated_at timestamptz not null default now()
);

-- ৯. ফি ও বকেয়া
create table if not exists public.fees (
  id text primary key,
  student_id text not null references public.students(id) on delete cascade,
  payable numeric not null default 0,
  paid numeric not null default 0,
  updated_at timestamptz not null default now()
);

-- ১০. দৈনিক হাজিরা
create table if not exists public.attendance (
  id text primary key,
  att_date text not null,
  cls text default '',
  student_id text not null references public.students(id) on delete cascade,
  status text not null default 'P',
  scan_time text default '',
  updated_at timestamptz not null default now()
);

-- ১১. পরীক্ষা ও ফলাফল
create table if not exists public.results (
  id text primary key,
  student_id text not null references public.students(id) on delete cascade,
  marks jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ১২. লাইব্রেরি — বই ও ধার দেওয়া
create table if not exists public.books (
  id text primary key,
  title text not null default '',
  author text default '',
  copies integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.book_loans (
  id text primary key,
  book_id text not null references public.books(id) on delete cascade,
  student_id text not null references public.students(id) on delete cascade,
  loan_date text default '',
  returned boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ১৩. পরিবহন রুট
create table if not exists public.transport_routes (
  id text primary key,
  name text not null default '',
  vehicle text default '',
  driver text default '',
  stops text default '',
  updated_at timestamptz not null default now()
);

-- ============================================================
-- অফিস ম্যানেজমেন্ট টেবিলসমূহ
-- ============================================================

create table if not exists public.departments (
  id text primary key,
  name text not null default '',
  head text default '',
  note text default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.employees (
  id text primary key,
  name text not null default '',
  dept text default '',
  designation text default '',
  phone text default '',
  email text default '',
  salary numeric not null default 0,
  join_date text default '',
  status text default 'সক্রিয়',
  updated_at timestamptz not null default now()
);

create table if not exists public.office_attendance (
  id text primary key,
  att_date text not null,
  emp_id text not null references public.employees(id) on delete cascade,
  status text not null default 'P',
  updated_at timestamptz not null default now()
);

create table if not exists public.leaves (
  id text primary key,
  emp_id text not null references public.employees(id) on delete cascade,
  type text default '',
  from_date text default '',
  to_date text default '',
  reason text default '',
  status text not null default 'pending',
  updated_at timestamptz not null default now()
);

create table if not exists public.payroll (
  id text primary key,
  emp_id text not null references public.employees(id) on delete cascade,
  month text default '',
  basic numeric not null default 0,
  allowance numeric not null default 0,
  deduction numeric not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id text primary key,
  title text not null default '',
  emp_id text default '',
  due text default '',
  priority text default 'মাঝারি',
  status text not null default 'চলমান',
  updated_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id text primary key,
  title text not null default '',
  category text default '',
  amount numeric not null default 0,
  exp_date text default '',
  note text default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.office_docs (
  id text primary key,
  title text not null default '',
  category text default '',
  doc_date text default '',
  note text default '',
  updated_at timestamptz not null default now()
);

-- ============================================================
-- শিক্ষার্থীর বার্ষিক খরচ টেবিলসমূহ
-- ============================================================

create table if not exists public.cost_types (
  id text primary key,
  name text not null default '',
  amount numeric not null default 0,
  is_custom boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.student_costs (
  id text primary key,
  student_id text not null references public.students(id) on delete cascade,
  cost_type_id text default '',
  name text not null default '',
  amount numeric not null default 0,
  paid numeric not null default 0,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- শিক্ষার্থীর পেমেন্ট হিস্টোরি ও ওয়েবসাইট ফটো/ভিডিও মিডিয়া
-- ============================================================

create table if not exists public.student_payment_history (
  id text primary key,
  student_id text not null references public.students(id) on delete cascade,
  pay_date text not null default '',
  pay_time text default '',
  head text not null default '',
  amount numeric not null default 0,
  note text default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.school_media (
  id text primary key,
  title text not null default '',
  media_type text not null default 'photo' check (media_type in ('photo', 'video')),
  category text not null default 'গ্যালারি',
  file_url text not null default '',
  storage_path text default '',
  description text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- পুরনো টেবিল থাকলে নতুন কলাম নিরাপদে যোগ করুন (Idempotent Upgrade)
alter table public.school_settings add column if not exists principal_phone text default '';
alter table public.school_settings add column if not exists id_logo text default '';
alter table public.school_settings add column if not exists principal_signature text default '';
alter table public.classes add column if not exists extra_activities jsonb not null default '[]'::jsonb;
alter table public.class_sections add column if not exists subjects jsonb;
alter table public.subjects add column if not exists section text default 'সব শাখা';
alter table public.students add column if not exists photo text default '';
alter table public.students add column if not exists admission_date text default '';
alter table public.attendance add column if not exists scan_time text default '';

-- পারফরম্যান্স ইনডেক্স
create index if not exists idx_students_cls_section on public.students(cls, section);
create index if not exists idx_student_costs_sid on public.student_costs(student_id);
create index if not exists idx_payment_history_sid on public.student_payment_history(student_id);
create index if not exists idx_attendance_date_cls on public.attendance(att_date, cls);
create index if not exists idx_school_media_type_created on public.school_media(media_type, created_at desc);

-- ============================================================
-- Supabase Storage Bucket (ফটো ও ভিডিও আপলোডের জন্য 'school-media')
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'school-media',
  'school-media',
  true,
  52428800,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'
  ]
)
on conflict (id) do update set
  public = true,
  file_size_limit = 52428800,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "school_media_public_read" on storage.objects;
create policy "school_media_public_read"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'school-media');

drop policy if exists "school_media_public_insert" on storage.objects;
create policy "school_media_public_insert"
  on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'school-media');

drop policy if exists "school_media_public_update" on storage.objects;
create policy "school_media_public_update"
  on storage.objects for update to anon, authenticated
  using (bucket_id = 'school-media')
  with check (bucket_id = 'school-media');

drop policy if exists "school_media_public_delete" on storage.objects;
create policy "school_media_public_delete"
  on storage.objects for delete to anon, authenticated
  using (bucket_id = 'school-media');

-- ============================================================
-- Row Level Security (RLS) চালু ও নীতি
-- ============================================================

alter table public.school_settings enable row level security;
alter table public.classes enable row level security;
alter table public.class_sections enable row level security;
alter table public.subjects enable row level security;
alter table public.board_books enable row level security;
alter table public.class_extra_activities enable row level security;
alter table public.students enable row level security;
alter table public.student_payment_history enable row level security;
alter table public.school_media enable row level security;
alter table public.teachers enable row level security;
alter table public.notices enable row level security;
alter table public.admissions enable row level security;
alter table public.fees enable row level security;
alter table public.attendance enable row level security;
alter table public.results enable row level security;
alter table public.books enable row level security;
alter table public.book_loans enable row level security;
alter table public.transport_routes enable row level security;
alter table public.departments enable row level security;
alter table public.employees enable row level security;
alter table public.office_attendance enable row level security;
alter table public.leaves enable row level security;
alter table public.payroll enable row level security;
alter table public.tasks enable row level security;
alter table public.expenses enable row level security;
alter table public.office_docs enable row level security;
alter table public.cost_types enable row level security;
alter table public.student_costs enable row level security;

do $$
declare
  tbl text;
  tbls text[] := array[
    'school_settings', 'classes', 'class_sections', 'subjects', 'board_books',
    'class_extra_activities', 'students', 'student_payment_history', 'school_media',
    'teachers', 'notices', 'admissions', 'fees', 'attendance', 'results',
    'books', 'book_loans', 'transport_routes', 'departments', 'employees',
    'office_attendance', 'leaves', 'payroll', 'tasks', 'expenses',
    'office_docs', 'cost_types', 'student_costs'
  ];
begin
  foreach tbl in array tbls loop
    execute format('drop policy if exists "school_all_access" on public.%I;', tbl);
    execute format('create policy "school_all_access" on public.%I for all to anon, authenticated using (true) with check (true);', tbl);
  end loop;
end $$;

-- ডিফল্ট স্কুল সেটিংস (প্রথমবার থাকলে কিছু পরিবর্তন করবে না)
insert into public.school_settings (
  id, name, motto, address, principal_msg
) values (
  'main',
  'আমার স্কুল',
  'জ্ঞানেই আলো, চরিত্রেই শক্তি',
  'মেইন রোড, সদর উপজেলা',
  'শিক্ষাই জাতির মেরুদণ্ড। আমাদের লক্ষ্য প্রতিটি শিক্ষার্থীকে জ্ঞান, চরিত্র ও মানবিক মূল্যবোধে গড়ে তোলা — যাতে তারা আগামীর বাংলাদেশ গড়ার কারিগর হতে পারে।'
) on conflict (id) do nothing;

-- ============================================================
-- প্রাথমিক ডেটা: প্লে থেকে দ্বাদশ শ্রেণি (১৫টি শ্রেণি ও ৪৫টি শাখা)
-- ============================================================

insert into public.classes (id, name, display_order, sections, room, capacity) values
  ('cls-1',  'প্লে',      1,  'ক, খ, গ', '১০১, ১০২, ১০৩', 90),
  ('cls-2',  'নার্সারি',  2,  'ক, খ, গ', '১০৪, ১০৫, ১০৬', 90),
  ('cls-3',  'কেজি',      3,  'ক, খ, গ', '১০৭, ১০৮, ১০৯', 105),
  ('cls-4',  'প্রথম',     4,  'ক, খ, গ', '১১০, ১১১, ১১২', 120),
  ('cls-5',  'দ্বিতীয়',   5,  'ক, খ, গ', '১১৩, ১১৪, ১১৫', 120),
  ('cls-6',  'তৃতীয়',    6,  'ক, খ, গ', '২০১, ২০২, ২০৩', 120),
  ('cls-7',  'চতুর্থ',    7,  'ক, খ, গ', '২০৪, ২০৫, ২০৬', 120),
  ('cls-8',  'পঞ্চম',     8,  'ক, খ, গ', '২০৭, ২০৮, ২০৯', 135),
  ('cls-9',  'ষষ্ঠ',      9,  'ক, খ, গ', '২১০, ২১১, ২১২', 135),
  ('cls-10', 'সপ্তম',     10, 'ক, খ, গ', '২১৩, ২১৪, ২১৫', 135),
  ('cls-11', 'অষ্টম',     11, 'ক, খ, গ', '৩০১, ৩০২, ৩০৩', 135),
  ('cls-12', 'নবম',      12, 'সাইন্স, ইকমার্স, মানবিক', '৩০৪, ৩০৫, ৩০৬', 150),
  ('cls-13', 'দশম',      13, 'সাইন্স, ইকমার্স, মানবিক', '৩০৭, ৩০৮, ৩০৯', 150),
  ('cls-14', 'একাদশ',    14, 'সাইন্স, ইকমার্স, মানবিক', '৪০১, ৪০২, ৪০৩', 150),
  ('cls-15', 'দ্বাদশ',    15, 'সাইন্স, ইকমার্স, মানবিক', '৪০৪, ৪০৫, ৪০৬', 150)
on conflict (id) do update set
  name = excluded.name,
  display_order = excluded.display_order,
  sections = excluded.sections,
  room = excluded.room,
  capacity = excluded.capacity,
  updated_at = now();

insert into public.class_sections (id, class_id, section_name, room_no, seat_capacity) values
  ('cls-1-a',  'cls-1',  'ক', '১০১', 30), ('cls-1-b',  'cls-1',  'খ', '১০২', 30), ('cls-1-c',  'cls-1',  'গ', '১০৩', 30),
  ('cls-2-a',  'cls-2',  'ক', '১০৪', 30), ('cls-2-b',  'cls-2',  'খ', '১০৫', 30), ('cls-2-c',  'cls-2',  'গ', '১০৬', 30),
  ('cls-3-a',  'cls-3',  'ক', '১০৭', 35), ('cls-3-b',  'cls-3',  'খ', '১০৮', 35), ('cls-3-c',  'cls-3',  'গ', '১০৯', 35),
  ('cls-4-a',  'cls-4',  'ক', '১১০', 40), ('cls-4-b',  'cls-4',  'খ', '১১১', 40), ('cls-4-c',  'cls-4',  'গ', '১১২', 40),
  ('cls-5-a',  'cls-5',  'ক', '১১৩', 40), ('cls-5-b',  'cls-5',  'খ', '১১৪', 40), ('cls-5-c',  'cls-5',  'গ', '১১৫', 40),
  ('cls-6-a',  'cls-6',  'ক', '২০১', 40), ('cls-6-b',  'cls-6',  'খ', '২০২', 40), ('cls-6-c',  'cls-6',  'গ', '২০৩', 40),
  ('cls-7-a',  'cls-7',  'ক', '২০৪', 40), ('cls-7-b',  'cls-7',  'খ', '২০৫', 40), ('cls-7-c',  'cls-7',  'গ', '২০৬', 40),
  ('cls-8-a',  'cls-8',  'ক', '২০৭', 45), ('cls-8-b',  'cls-8',  'খ', '২০৮', 45), ('cls-8-c',  'cls-8',  'গ', '২০৯', 45),
  ('cls-9-a',  'cls-9',  'ক', '২১০', 45), ('cls-9-b',  'cls-9',  'খ', '২১১', 45), ('cls-9-c',  'cls-9',  'গ', '২১২', 45),
  ('cls-10-a', 'cls-10', 'ক', '২১৩', 45), ('cls-10-b', 'cls-10', 'খ', '২১৪', 45), ('cls-10-c', 'cls-10', 'গ', '২১৫', 45),
  ('cls-11-a', 'cls-11', 'ক', '৩০১', 45), ('cls-11-b', 'cls-11', 'খ', '৩০২', 45), ('cls-11-c', 'cls-11', 'গ', '৩০৩', 45),
  ('cls-12-a', 'cls-12', 'সাইন্স', '৩০৪', 50), ('cls-12-b', 'cls-12', 'ইকমার্স', '৩০৫', 50), ('cls-12-c', 'cls-12', 'মানবিক', '৩০৬', 50),
  ('cls-13-a', 'cls-13', 'সাইন্স', '৩০৭', 50), ('cls-13-b', 'cls-13', 'ইকমার্স', '৩০৮', 50), ('cls-13-c', 'cls-13', 'মানবিক', '৩০৯', 50),
  ('cls-14-a', 'cls-14', 'সাইন্স', '৪০১', 50), ('cls-14-b', 'cls-14', 'ইকমার্স', '৪০২', 50), ('cls-14-c', 'cls-14', 'মানবিক', '৪০৩', 50),
  ('cls-15-a', 'cls-15', 'সাইন্স', '৪০৪', 50), ('cls-15-b', 'cls-15', 'ইকমার্স', '৪০৫', 50), ('cls-15-c', 'cls-15', 'মানবিক', '৪০৬', 50)
on conflict (id) do update set
  class_id = excluded.class_id,
  section_name = excluded.section_name,
  room_no = excluded.room_no,
  seat_capacity = excluded.seat_capacity,
  updated_at = now();

insert into public.board_books (id, class_id, class_name, book_group, title, display_order) values
  ('bb-1-1',  'cls-1',  'প্লে',      'সাধারণ', 'আমার বাংলা বই (প্রাক-প্রাথমিক)', 1),
  ('bb-1-2',  'cls-1',  'প্লে',      'সাধারণ', 'English for Today (Pre-Primary)', 2),
  ('bb-1-3',  'cls-1',  'প্লে',      'সাধারণ', 'সহজ গণিত (প্রাথমিক)', 3),
  ('bb-1-4',  'cls-1',  'প্লে',      'সাধারণ', 'পরিবেশ পরিচিতি ও ছবি আঁকা', 4),
  ('bb-2-1',  'cls-2',  'নার্সারি',  'সাধারণ', 'আমার বাংলা বই (নার্সারি)', 1),
  ('bb-2-2',  'cls-2',  'নার্সারি',  'সাধারণ', 'English for Today (Nursery)', 2),
  ('bb-2-3',  'cls-2',  'নার্সারি',  'সাধারণ', 'প্রাথমিক গণিত (নার্সারি)', 3),
  ('bb-2-4',  'cls-2',  'নার্সারি',  'সাধারণ', 'পরিবেশ ও নৈতিক শিক্ষা', 4),
  ('bb-3-1',  'cls-3',  'কেজি',      'সাধারণ', 'আমার বাংলা বই (কেজি)', 1),
  ('bb-3-2',  'cls-3',  'কেজি',      'সাধারণ', 'English for Today (KG)', 2),
  ('bb-3-3',  'cls-3',  'কেজি',      'সাধারণ', 'প্রাথমিক গণিত (কেজি)', 3),
  ('bb-3-4',  'cls-3',  'কেজি',      'সাধারণ', 'সাধারণ বিজ্ঞান ও পরিবেশ', 4),
  ('bb-3-5',  'cls-3',  'কেজি',      'সাধারণ', 'ধর্ম ও নৈতিক শিক্ষা', 5),
  ('bb-4-1',  'cls-4',  'প্রথম',     'সাধারণ', 'আমার বাংলা বই', 1),
  ('bb-4-2',  'cls-4',  'প্রথম',     'সাধারণ', 'English for Today', 2),
  ('bb-4-3',  'cls-4',  'প্রথম',     'সাধারণ', 'প্রাথমিক গণিত', 3),
  ('bb-5-1',  'cls-5',  'দ্বিতীয়',   'সাধারণ', 'আমার বাংলা বই', 1),
  ('bb-5-2',  'cls-5',  'দ্বিতীয়',   'সাধারণ', 'English for Today', 2),
  ('bb-5-3',  'cls-5',  'দ্বিতীয়',   'সাধারণ', 'প্রাথমিক গণিত', 3),
  ('bb-6-1',  'cls-6',  'তৃতীয়',    'সাধারণ', 'আমার বাংলা বই', 1),
  ('bb-6-2',  'cls-6',  'তৃতীয়',    'সাধারণ', 'English for Today', 2),
  ('bb-6-3',  'cls-6',  'তৃতীয়',    'সাধারণ', 'প্রাথমিক গণিত', 3),
  ('bb-6-4',  'cls-6',  'তৃতীয়',    'সাধারণ', 'প্রাথমিক বিজ্ঞান', 4),
  ('bb-6-5',  'cls-6',  'তৃতীয়',    'সাধারণ', 'বাংলাদেশ ও বিশ্বপরিচয়', 5),
  ('bb-6-6',  'cls-6',  'তৃতীয়',    'সাধারণ', 'ধর্ম ও নৈতিক শিক্ষা', 6),
  ('bb-7-1',  'cls-7',  'চতুর্থ',    'সাধারণ', 'আমার বাংলা বই', 1),
  ('bb-7-2',  'cls-7',  'চতুর্থ',    'সাধারণ', 'English for Today', 2),
  ('bb-7-3',  'cls-7',  'চতুর্থ',    'সাধারণ', 'প্রাথমিক গণিত', 3),
  ('bb-7-4',  'cls-7',  'চতুর্থ',    'সাধারণ', 'প্রাথমিক বিজ্ঞান', 4),
  ('bb-7-5',  'cls-7',  'চতুর্থ',    'সাধারণ', 'বাংলাদেশ ও বিশ্বপরিচয়', 5),
  ('bb-7-6',  'cls-7',  'চতুর্থ',    'সাধারণ', 'ধর্ম ও নৈতিক শিক্ষা', 6),
  ('bb-8-1',  'cls-8',  'পঞ্চম',     'সাধারণ', 'আমার বাংলা বই', 1),
  ('bb-8-2',  'cls-8',  'পঞ্চম',     'সাধারণ', 'English for Today', 2),
  ('bb-8-3',  'cls-8',  'পঞ্চম',     'সাধারণ', 'প্রাথমিক গণিত', 3),
  ('bb-8-4',  'cls-8',  'পঞ্চম',     'সাধারণ', 'প্রাথমিক বিজ্ঞান', 4),
  ('bb-8-5',  'cls-8',  'পঞ্চম',     'সাধারণ', 'বাংলাদেশ ও বিশ্বপরিচয়', 5),
  ('bb-8-6',  'cls-8',  'পঞ্চম',     'সাধারণ', 'ধর্ম ও নৈতিক শিক্ষা', 6),
  ('bb-9-1',  'cls-9',  'ষষ্ঠ',      'সাধারণ', 'বাংলা (চারুপাঠ)', 1),
  ('bb-9-2',  'cls-9',  'ষষ্ঠ',      'সাধারণ', 'আনন্দ পাঠ', 2),
  ('bb-9-3',  'cls-9',  'ষষ্ঠ',      'সাধারণ', 'English for Today', 3),
  ('bb-9-4',  'cls-9',  'ষষ্ঠ',      'সাধারণ', 'গণিত', 4),
  ('bb-9-5',  'cls-9',  'ষষ্ঠ',      'সাধারণ', 'বিজ্ঞান', 5),
  ('bb-9-6',  'cls-9',  'ষষ্ঠ',      'সাধারণ', 'ইতিহাস ও সামাজিক বিজ্ঞান', 6),
  ('bb-9-7',  'cls-9',  'ষষ্ঠ',      'সাধারণ', 'ডিজিটাল প্রযুক্তি', 7),
  ('bb-9-8',  'cls-9',  'ষষ্ঠ',      'সাধারণ', 'স্বাস্থ্য সুরক্ষা', 8),
  ('bb-9-9',  'cls-9',  'ষষ্ঠ',      'সাধারণ', 'জীবন ও জীবিকা', 9),
  ('bb-9-10', 'cls-9',  'ষষ্ঠ',      'সাধারণ', 'শিল্প ও সংস্কৃতি', 10),
  ('bb-9-11', 'cls-9',  'ষষ্ঠ',      'সাধারণ', 'ধর্ম ও নৈতিক শিক্ষা', 11),
  ('bb-10-1', 'cls-10', 'সপ্তম',     'সাধারণ', 'বাংলা (সপ্তবর্ণা)', 1),
  ('bb-10-2', 'cls-10', 'সপ্তম',     'সাধারণ', 'আনন্দ পাঠ', 2),
  ('bb-10-3', 'cls-10', 'সপ্তম',     'সাধারণ', 'English for Today', 3),
  ('bb-10-4', 'cls-10', 'সপ্তম',     'সাধারণ', 'গণিত', 4),
  ('bb-10-5', 'cls-10', 'সপ্তম',     'সাধারণ', 'বিজ্ঞান', 5),
  ('bb-10-6', 'cls-10', 'সপ্তম',     'সাধারণ', 'ইতিহাস ও সামাজিক বিজ্ঞান', 6),
  ('bb-10-7', 'cls-10', 'সপ্তম',     'সাধারণ', 'ডিজিটাল প্রযুক্তি', 7),
  ('bb-10-8', 'cls-10', 'সপ্তম',     'সাধারণ', 'স্বাস্থ্য সুরক্ষা', 8),
  ('bb-10-9', 'cls-10', 'সপ্তম',     'সাধারণ', 'জীবন ও জীবিকা', 9),
  ('bb-10-10','cls-10', 'সপ্তম',     'সাধারণ', 'শিল্প ও সংস্কৃতি', 10),
  ('bb-10-11','cls-10', 'সপ্তম',     'সাধারণ', 'ধর্ম ও নৈতিক শিক্ষা', 11),
  ('bb-11-1', 'cls-11', 'অষ্টম',     'সাধারণ', 'বাংলা (সাহিত্য কণিকা)', 1),
  ('bb-11-2', 'cls-11', 'অষ্টম',     'সাধারণ', 'আনন্দ পাঠ', 2),
  ('bb-11-3', 'cls-11', 'অষ্টম',     'সাধারণ', 'English for Today', 3),
  ('bb-11-4', 'cls-11', 'অষ্টম',     'সাধারণ', 'গণিত', 4),
  ('bb-11-5', 'cls-11', 'অষ্টম',     'সাধারণ', 'বিজ্ঞান', 5),
  ('bb-11-6', 'cls-11', 'অষ্টম',     'সাধারণ', 'ইতিহাস ও সামাজিক বিজ্ঞান', 6),
  ('bb-11-7', 'cls-11', 'অষ্টম',     'সাধারণ', 'ডিজিটাল প্রযুক্তি', 7),
  ('bb-11-8', 'cls-11', 'অষ্টম',     'সাধারণ', 'স্বাস্থ্য সুরক্ষা', 8),
  ('bb-11-9', 'cls-11', 'অষ্টম',     'সাধারণ', 'জীবন ও জীবিকা', 9),
  ('bb-11-10','cls-11', 'অষ্টম',     'সাধারণ', 'শিল্প ও সংস্কৃতি', 10),
  ('bb-11-11','cls-11', 'অষ্টম',     'সাধারণ', 'ধর্ম ও নৈতিক শিক্ষা', 11),
  ('bb-12-1', 'cls-12', 'নবম',      'আবশ্যিক', 'বাংলা সাহিত্য ও সহপাঠ', 1),
  ('bb-12-2', 'cls-12', 'নবম',      'আবশ্যিক', 'বাংলা ভাষার ব্যাকরণ ও নির্মিতি', 2),
  ('bb-12-3', 'cls-12', 'নবম',      'আবশ্যিক', 'English for Today', 3),
  ('bb-12-4', 'cls-12', 'নবম',      'আবশ্যিক', 'English Grammar and Composition', 4),
  ('bb-12-5', 'cls-12', 'নবম',      'আবশ্যিক', 'গণিত', 5),
  ('bb-12-6', 'cls-12', 'নবম',      'আবশ্যিক', 'তথ্য ও যোগাযোগ প্রযুক্তি (ICT)', 6),
  ('bb-12-7', 'cls-12', 'নবম',      'আবশ্যিক', 'ধর্ম ও নৈতিক শিক্ষা', 7),
  ('bb-12-8', 'cls-12', 'নবম',      'সাইন্স',  'পদার্থবিজ্ঞান', 8),
  ('bb-12-9', 'cls-12', 'নবম',      'সাইন্স',  'রসায়ন', 9),
  ('bb-12-10','cls-12', 'নবম',      'সাইন্স',  'জীববিজ্ঞান', 10),
  ('bb-12-11','cls-12', 'নবম',      'সাইন্স',  'উচ্চতর গণিত', 11),
  ('bb-12-12','cls-12', 'নবম',      'সাইন্স',  'বাংলাদেশ ও বিশ্বপরিচয়', 12),
  ('bb-12-13','cls-12', 'নবম',      'ইকমার্স', 'হিসাববিজ্ঞান', 13),
  ('bb-12-14','cls-12', 'নবম',      'ইকমার্স', 'ব্যবসায় উদ্যোগ', 14),
  ('bb-12-15','cls-12', 'নবম',      'ইকমার্স', 'ফিন্যান্স ও ব্যাংকিং', 15),
  ('bb-12-16','cls-12', 'নবম',      'ইকমার্স', 'বিজ্ঞান (বাণিজ্য ও মানবিক)', 16),
  ('bb-12-17','cls-12', 'নবম',      'মানবিক',  'বাংলাদেশের ইতিহাস ও বিশ্বসভ্যতা', 17),
  ('bb-12-18','cls-12', 'নবম',      'মানবিক',  'ভূগোল ও পরিবেশ', 18),
  ('bb-12-19','cls-12', 'নবম',      'মানবিক',  'পৌরনীতি ও নাগরিকতা', 19),
  ('bb-12-20','cls-12', 'নবম',      'মানবিক',  'অর্থনীতি', 20),
  ('bb-12-21','cls-12', 'নবম',      'মানবিক',  'বিজ্ঞান (মানবিক)', 21),
  ('bb-13-1', 'cls-13', 'দশম',      'আবশ্যিক', 'বাংলা সাহিত্য ও সহপাঠ', 1),
  ('bb-13-2', 'cls-13', 'দশম',      'আবশ্যিক', 'বাংলা ভাষার ব্যাকরণ ও নির্মিতি', 2),
  ('bb-13-3', 'cls-13', 'দশম',      'আবশ্যিক', 'English for Today', 3),
  ('bb-13-4', 'cls-13', 'দশম',      'আবশ্যিক', 'English Grammar and Composition', 4),
  ('bb-13-5', 'cls-13', 'দশম',      'আবশ্যিক', 'গণিত', 5),
  ('bb-13-6', 'cls-13', 'দশম',      'আবশ্যিক', 'তথ্য ও যোগাযোগ প্রযুক্তি (ICT)', 6),
  ('bb-13-7', 'cls-13', 'দশম',      'আবশ্যিক', 'ধর্ম ও নৈতিক শিক্ষা', 7),
  ('bb-13-8', 'cls-13', 'দশম',      'সাইন্স',  'পদার্থবিজ্ঞান', 8),
  ('bb-13-9', 'cls-13', 'দশম',      'সাইন্স',  'রসায়ন', 9),
  ('bb-13-10','cls-13', 'দশম',      'সাইন্স',  'জীববিজ্ঞান', 10),
  ('bb-13-11','cls-13', 'দশম',      'সাইন্স',  'উচ্চতর গণিত', 11),
  ('bb-13-12','cls-13', 'দশম',      'সাইন্স',  'বাংলাদেশ ও বিশ্বপরিচয়', 12),
  ('bb-13-13','cls-13', 'দশম',      'ইকমার্স', 'হিসাববিজ্ঞান', 13),
  ('bb-13-14','cls-13', 'দশম',      'ইকমার্স', 'ব্যবসায় উদ্যোগ', 14),
  ('bb-13-15','cls-13', 'দশম',      'ইকমার্স', 'ফিন্যান্স ও ব্যাংকিং', 15),
  ('bb-13-16','cls-13', 'দশম',      'ইকমার্স', 'বিজ্ঞান (বাণিজ্য ও মানবিক)', 16),
  ('bb-13-17','cls-13', 'দশম',      'মানবিক',  'বাংলাদেশের ইতিহাস ও বিশ্বসভ্যতা', 17),
  ('bb-13-18','cls-13', 'দশম',      'মানবিক',  'ভূগোল ও পরিবেশ', 18),
  ('bb-13-19','cls-13', 'দশম',      'মানবিক',  'পৌরনীতি ও নাগরিকতা', 19),
  ('bb-13-20','cls-13', 'দশম',      'মানবিক',  'অর্থনীতি', 20),
  ('bb-13-21','cls-13', 'দশম',      'মানবিক',  'বিজ্ঞান (মানবিক)', 21),
  ('bb-14-1', 'cls-14', 'একাদশ',    'আবশ্যিক', 'সাহিত্যপাঠ ও সহপাঠ (বাংলা ১ম ও ২য় পত্র)', 1),
  ('bb-14-2', 'cls-14', 'একাদশ',    'আবশ্যিক', 'English for Today (1st & 2nd Paper)', 2),
  ('bb-14-3', 'cls-14', 'একাদশ',    'আবশ্যিক', 'তথ্য ও যোগাযোগ প্রযুক্তি (ICT)', 3),
  ('bb-14-4', 'cls-14', 'একাদশ',    'সাইন্স',  'পদার্থবিজ্ঞান (১ম ও ২য় পত্র)', 4),
  ('bb-14-5', 'cls-14', 'একাদশ',    'সাইন্স',  'রসায়ন (১ম ও ২য় পত্র)', 5),
  ('bb-14-6', 'cls-14', 'একাদশ',    'সাইন্স',  'জীববিজ্ঞান (১ম ও ২য় পত্র)', 6),
  ('bb-14-7', 'cls-14', 'একাদশ',    'সাইন্স',  'উচ্চতর গণিত (১ম ও ২য় পত্র)', 7),
  ('bb-14-8', 'cls-14', 'একাদশ',    'ইকমার্স', 'হিসাববিজ্ঞান (১ম ও ২য় পত্র)', 8),
  ('bb-14-9', 'cls-14', 'একাদশ',    'ইকমার্স', 'ব্যবসায় সংগঠন ও ব্যবস্থাপনা (১ম ও ২য় পত্র)', 9),
  ('bb-14-10','cls-14', 'একাদশ',    'ইকমার্স', 'ফিন্যান্স, ব্যাংকিং ও বিমা (১ম ও ২য় পত্র)', 10),
  ('bb-14-11','cls-14', 'একাদশ',    'ইকমার্স', 'উৎপাদন ব্যবস্থাপনা ও বিপণন / অর্থনীতি', 11),
  ('bb-14-12','cls-14', 'একাদশ',    'মানবিক',  'পৌরনীতি ও সুশাসন (১ম ও ২য় পত্র)', 12),
  ('bb-14-13','cls-14', 'একাদশ',    'মানবিক',  'ইতিহাস / ইসলামের ইতিহাস ও সংস্কৃতি', 13),
  ('bb-14-14','cls-14', 'একাদশ',    'মানবিক',  'সমাজবিজ্ঞান / সমাজকর্ম', 14),
  ('bb-14-15','cls-14', 'একাদশ',    'মানবিক',  'অর্থনীতি (১ম ও ২য় পত্র)', 15),
  ('bb-14-16','cls-14', 'একাদশ',    'মানবিক',  'যুক্তিবিদ্যা / ভূগোল', 16),
  ('bb-15-1', 'cls-15', 'দ্বাদশ',    'আবশ্যিক', 'সাহিত্যপাঠ ও সহপাঠ (বাংলা ১ম ও ২য় পত্র)', 1),
  ('bb-15-2', 'cls-15', 'দ্বাদশ',    'আবশ্যিক', 'English for Today (1st & 2nd Paper)', 2),
  ('bb-15-3', 'cls-15', 'দ্বাদশ',    'আবশ্যিক', 'তথ্য ও যোগাযোগ প্রযুক্তি (ICT)', 3),
  ('bb-15-4', 'cls-15', 'দ্বাদশ',    'সাইন্স',  'পদার্থবিজ্ঞান (১ম ও ২য় পত্র)', 4),
  ('bb-15-5', 'cls-15', 'দ্বাদশ',    'সাইন্স',  'রসায়ন (১ম ও ২য় পত্র)', 5),
  ('bb-15-6', 'cls-15', 'দ্বাদশ',    'সাইন্স',  'জীববিজ্ঞান (১ম ও ২য় পত্র)', 6),
  ('bb-15-7', 'cls-15', 'দ্বাদশ',    'সাইন্স',  'উচ্চতর গণিত (১ম ও ২য় পত্র)', 7),
  ('bb-15-8', 'cls-15', 'দ্বাদশ',    'ইকমার্স', 'হিসাববিজ্ঞান (১ম ও ২য় পত্র)', 8),
  ('bb-15-9', 'cls-15', 'দ্বাদশ',    'ইকমার্স', 'ব্যবসায় সংগঠন ও ব্যবস্থাপনা (১ম ও ২য় পত্র)', 9),
  ('bb-15-10','cls-15', 'দ্বাদশ',    'ইকমার্স', 'ফিন্যান্স, ব্যাংকিং ও বিমা (১ম ও ২য় পত্র)', 10),
  ('bb-15-11','cls-15', 'দ্বাদশ',    'ইকমার্স', 'উৎপাদন ব্যবস্থাপনা ও বিপণন / অর্থনীতি', 11),
  ('bb-15-12','cls-15', 'দ্বাদশ',    'মানবিক',  'পৌরনীতি ও সুশাসন (১ম ও ২য় পত্র)', 12),
  ('bb-15-13','cls-15', 'দ্বাদশ',    'মানবিক',  'ইতিহাস / ইসলামের ইতিহাস ও সংস্কৃতি', 13),
  ('bb-15-14','cls-15', 'দ্বাদশ',    'মানবিক',  'সমাজবিজ্ঞান / সমাজকর্ম', 14),
  ('bb-15-15','cls-15', 'দ্বাদশ',    'মানবিক',  'অর্থনীতি (১ম ও ২য় পত্র)', 15),
  ('bb-15-16','cls-15', 'দ্বাদশ',    'মানবিক',  'যুক্তিবিদ্যা / ভূগোল', 16)
on conflict (id) do update set
  class_id = excluded.class_id,
  class_name = excluded.class_name,
  book_group = excluded.book_group,
  title = excluded.title,
  display_order = excluded.display_order,
  updated_at = now();

insert into public.class_extra_activities (id, class_id, class_name, title, display_order)
select
  'ea-' || c.display_order || '-' || a.ord,
  c.id,
  c.name,
  a.title,
  a.ord
from public.classes c
cross join (values
  (1,  'কম্পিউটার ল্যাব'),
  (2,  'কোরআন শিক্ষা'),
  (3,  'স্পোকেন ল্যাব'),
  (4,  'স্পোর্টস'),
  (5,  'সুইমিং'),
  (6,  'জিম'),
  (7,  'আবৃত্তি'),
  (8,  'গান'),
  (9,  'অভিনয়'),
  (10, 'নৃত্য'),
  (11, 'ডিবেটিং')
) as a(ord, title)
on conflict (id) do update set
  class_id = excluded.class_id,
  class_name = excluded.class_name,
  title = excluded.title,
  display_order = excluded.display_order,
  updated_at = now();

insert into public.cost_types (id, name, amount, is_custom) values
  ('ct-admission',   'ভর্তি ফি',                            5000,  false),
  ('ct-uniform',     'পোশাক / ইউনিফর্ম',                   2500,  false),
  ('ct-tuition',     'টিউশন ফি (বার্ষিক)',                  12000, false),
  ('ct-stationary',  'স্টেশনারি (খাতা, কলম ও সহায়ক সামগ্রী)', 1500,  false),
  ('ct-exam',        'পরীক্ষা ফি',                          2000,  false),
  ('ct-sports',      'ক্রীড়া ফি',                           800,   false),
  ('ct-festival',    'উৎসব ফি',                            700,   false),
  ('ct-transport',   'পরিবহন ফি',                          6000,  false),
  ('ct-library',     'লাইব্রেরি ফি',                         500,   false),
  ('ct-lab',         'ল্যাব / কম্পিউটার ফি',                  1500,  false),
  ('ct-development', 'উন্নয়ন ফি',                           1000,  false)
on conflict (id) do update set
  name = excluded.name,
  amount = excluded.amount,
  updated_at = now();

insert into public.students (id, name, cls, roll, section, guardian, phone, payable, paid) values
  ('s-play-1',    'আরিয়ান আহমেদ',        'প্লে',     1, 'ক',       'মোঃ রাশেদ আহমেদ',     '01711-210101', 33500, 33500),
  ('s-play-2',    'মুনতাহা তাসনিম',      'প্লে',     2, 'খ',       'সাদিয়া আফরিন',       '01812-210102', 33500, 20000),
  ('s-play-3',    'জায়ান করিম',          'প্লে',     3, 'গ',       'মোঃ করিম উল্লাহ',     '01913-210103', 33500, 12000),
  ('s-nursery-1', 'তানিশা জান্নাত',       'নার্সারি', 1, 'ক',       'ফারজানা ইয়াসমিন',    '01711-210201', 33500, 33500),
  ('s-nursery-2', 'আহনাফ ইসলাম',        'নার্সারি', 2, 'খ',       'মোঃ শফিকুল ইসলাম',   '01812-210202', 33500, 15000),
  ('s-nursery-3', 'নুসাইবা হক',          'নার্সারি', 3, 'গ',       'নাজমুল হক',           '01614-210203', 33500, 5000),
  ('s-kg-1',      'রাইয়ান হাসান',        'কেজি',     1, 'ক',       'মাহমুদুল হাসান',      '01711-210301', 33500, 33500),
  ('s-kg-2',      'সাবিহা সুলতানা',      'কেজি',     2, 'খ',       'তাহমিনা আক্তার',      '01913-210302', 33500, 25000),
  ('s-kg-3',      'ইহসান মাহমুদ',        'কেজি',     3, 'গ',       'তারেক মাহমুদ',        '01515-210303', 33500, 10000),
  ('s-one-1',     'আফরান চৌধুরী',        'প্রথম',    1, 'ক',       'জাহাঙ্গীর চৌধুরী',    '01711-210401', 33500, 33500),
  ('s-one-2',     'মেহজাবিন নূর',        'প্রথম',    2, 'খ',       'নূরজাহান বেগম',       '01812-210402', 33500, 21500),
  ('s-one-3',     'তাওহীদ রহমান',        'প্রথম',    3, 'গ',       'মশিউর রহমান',         '01614-210403', 33500, 0),
  ('s-two-1',     'নাবিহা আক্তার',       'দ্বিতীয়', 1, 'ক',       'মোঃ হাবিবুর রহমান',   '01711-210501', 33500, 33500),
  ('s-two-2',     'সাফওয়ান মিয়া',        'দ্বিতীয়', 2, 'খ',       'জাকির মিয়া',          '01913-210502', 33500, 18500),
  ('s-two-3',     'তাসফিয়া করিম',        'দ্বিতীয়', 3, 'গ',       'রেজাউল করিম',         '01515-210503', 33500, 12000),
  ('s-three-1',   'ফাহিম মুনতাসির',      'তৃতীয়',  1, 'ক',       'মোঃ আজিজুল হক',       '01711-210601', 33500, 33500),
  ('s-three-2',   'আরিবা তাবাসসুম',      'তৃতীয়',  2, 'খ',       'শাহানা পারভীন',       '01812-210602', 33500, 24000),
  ('s-three-3',   'নাফিস ইকবাল',         'তৃতীয়',  3, 'গ',       'মোঃ ইকবাল হোসেন',     '01614-210603', 33500, 7500),
  ('s-four-1',    'সাদিয়া ইসলাম',        'চতুর্থ',  1, 'ক',       'মোঃ নজরুল ইসলাম',    '01711-210701', 33500, 33500),
  ('s-four-2',    'তানভীর আলম',         'চতুর্থ',  2, 'খ',       'খোরশেদ আলম',         '01913-210702', 33500, 16500),
  ('s-four-3',    'মালিহা রহমান',        'চতুর্থ',  3, 'গ',       'সাইফুর রহমান',        '01515-210703', 33500, 5000),
  ('s-five-1',    'তাহমিদ সাদিক',        'পঞ্চম',    1, 'ক',       'মোঃ সাদিকুর রহমান',   '01711-210801', 33500, 33500),
  ('s-five-2',    'রাইসা মনি',           'পঞ্চম',    2, 'খ',       'রোকসানা আক্তার',      '01812-210802', 33500, 27000),
  ('s-five-3',    'সাকিব আল হাসান',      'পঞ্চম',    3, 'গ',       'মোঃ ইমরান হোসেন',     '01614-210803', 33500, 10000),
  ('s-six-1',     'তানভীর হাসান',        'ষষ্ঠ',     1, 'ক',       'মোঃ কামরুল হাসান',    '01711-210901', 33500, 33500),
  ('s-six-2',     'মারিয়া আক্তার',      'ষষ্ঠ',     2, 'খ',       'মোঃ সেলিম মিয়া',      '01913-210902', 33500, 19500),
  ('s-six-3',     'আরিফুল ইসলাম',       'ষষ্ঠ',     3, 'গ',       'মোঃ রফিকুল ইসলাম',   '01515-210903', 33500, 8000),
  ('s-seven-1',   'জান্নাতুল ফেরদৌস',    'সপ্তম',    1, 'ক',       'ফরিদা ইয়াসমিন',      '01711-211001', 33500, 33500),
  ('s-seven-2',   'নাঈমুর রহমান',        'সপ্তম',    2, 'খ',       'মোঃ মিজানুর রহমান',   '01812-211002', 33500, 22000),
  ('s-seven-3',   'তাসনিম তাবাসসুম',     'সপ্তম',    3, 'গ',       'নাসরিন সুলতানা',      '01614-211003', 33500, 0),
  ('s-eight-1',   'রাফিউজ্জামান খান',     'অষ্টম',    1, 'ক',       'আসাদুজ্জামান খান',    '01711-211101', 33500, 33500),
  ('s-eight-2',   'সুমাইয়া খাতুন',      'অষ্টম',    2, 'খ',       'মোঃ আব্দুল মালেক',    '01913-211102', 33500, 26000),
  ('s-eight-3',   'মেহেদী হাসান মিরাজ',  'অষ্টম',    3, 'গ',       'মোঃ আনোয়ার হোসেন',   '01515-211103', 33500, 14000),
  ('s-nine-1',    'আবীর হোসেন',          'নবম',      1, 'সাইন্স',  'মোঃ মোজাম্মেল হক',    '01711-211201', 33500, 33500),
  ('s-nine-2',    'নুসরাত জাহান',        'নবম',      2, 'ইকমার্স', 'মোঃ দেলোয়ার হোসেন',  '01812-211202', 33500, 21000),
  ('s-nine-3',    'সাব্বির আহমেদ',       'নবম',      3, 'মানবিক',  'মোঃ জসিম উদ্দিন',     '01614-211203', 33500, 9500),
  ('s-ten-1',     'ফারহান সাদিক',        'দশম',      1, 'সাইন্স',  'মোঃ আমিনুল ইসলাম',   '01711-211301', 33500, 33500),
  ('s-ten-2',     'তানহা তাবাসসুম',      'দশম',      2, 'ইকমার্স', 'সেলিনা বেগম',         '01913-211302', 33500, 28000),
  ('s-ten-3',     'রাকিবুল ইসলাম',       'দশম',      3, 'মানবিক',  'মোঃ মনিরুল ইসলাম',   '01515-211303', 33500, 15000),
  ('s-eleven-1',  'মুশফিকুর রহিম',       'একাদশ',    1, 'সাইন্স',  'মোঃ মাহবুবুর রহমান',  '01711-211401', 33500, 33500),
  ('s-eleven-2',  'লামিয়া ইসলাম',       'একাদশ',    2, 'ইকমার্স', 'মোঃ শহীদুল ইসলাম',   '01812-211402', 33500, 20500),
  ('s-eleven-3',  'তৌহিদুল ইসলাম',      'একাদশ',    3, 'মানবিক',  'আব্দুল জলিল',         '01614-211403', 33500, 5000),
  ('s-twelve-1',  'আশরাফুল আলম',        'দ্বাদশ',    1, 'সাইন্স',  'মোঃ শামসুল আলম',     '01711-211501', 33500, 33500),
  ('s-twelve-2',  'সাদিয়া আফরোজ',       'দ্বাদশ',    2, 'ইকমার্স', 'মাহফুজা খাতুন',       '01913-211502', 33500, 24500),
  ('s-twelve-3',  'হাসিবুল হাসান',       'দ্বাদশ',    3, 'মানবিক',  'মোঃ ফিরোজ কবির',     '01515-211503', 33500, 12500)
on conflict (id) do nothing;

-- ============================================================
-- প্রতিটি শ্রেণি ও শাখায় আসন অনুযায়ী পূর্ণ শিক্ষার্থী (১,৯০৫ জন) সিড
-- ============================================================
do $$
declare
  first_names text[] := array[
    'আরিয়ান', 'মুনতাহা', 'জায়ান', 'তানিশা', 'আহনাফ', 'নুসাইবা', 'রাইয়ান', 'সাবিহা', 'ইহসান', 'আফরান',
    'মেহজাবিন', 'তাওহীদ', 'নাবিহা', 'সাফওয়ান', 'তাসফিয়া', 'ফাহিম', 'আরিবা', 'নাফিস', 'সাদিয়া', 'তানভীর',
    'মালিহা', 'তাহমিদ', 'রাইসা', 'সাকিব', 'মারিয়া', 'আরিফুল', 'জান্নাতুল', 'নাঈমুর', 'তাসনিম', 'রাফিউজ্জামান',
    'সুমাইয়া', 'মেহেদী', 'আবীর', 'নুসরাত', 'সাব্বির', 'ফারহান', 'তানহা', 'রাকিবুল', 'মুশফিকুর', 'লামিয়া',
    'তৌহিদুল', 'আশরাফুল', 'হাসিবুল', 'আরাফাত', 'ফারিহা', 'জুবায়ের', 'তাবাসসুম', 'আদনান', 'জারা', 'শাদমান'
  ];
  last_names text[] := array[
    'আহমেদ', 'ইসলাম', 'হোসেন', 'রহমান', 'হাসান', 'আক্তার', 'চৌধুরী', 'খান', 'করিম', 'মাহমুদ',
    'হক', 'সুলতানা', 'জাহান', 'খাতুন', 'আলম', 'সিদ্দিক', 'সরকার', 'মিয়া', 'উদ্দিন', 'তালুকদার'
  ];
  g_prefixes text[] := array['মোঃ', 'আব্দুল', 'কামরুল', 'মিজানুর', 'রফিকুল', 'শফিকুল', 'নজরুল', 'মাহবুবুর', 'আমিনুল', 'সাইফুল'];
  ph_prefixes text[] := array['017', '018', '019', '016', '015', '013'];
  paid_samples numeric[] := array[33500, 33500, 28500, 25000, 22000, 18500, 15000, 12000, 8500, 5000, 0];

  cls_rec record;
  sec_rec record;
  c_idx int := 0;
  s_idx int := 0;
  cur_cnt int := 0;
  max_roll int := 0;
  missing_cnt int := 0;
  seq_cnt int := 45;
  k int := 0;
  r_num int := 0;
  sid text;
  f_name text;
  l_name text;
  g_pre text;
  g_first text;
  ph_num text;
  paid_val numeric;
begin
  for cls_rec in select id, name, display_order from public.classes order by display_order asc loop
    c_idx := cls_rec.display_order - 1;
    select coalesce(max(roll), 0) into max_roll from public.students where cls = cls_rec.name;
    s_idx := 0;
    for sec_rec in
      select id, section_name, seat_capacity
      from public.class_sections
      where class_id = cls_rec.id
      order by id asc
    loop
      select count(*) into cur_cnt
      from public.students
      where cls = cls_rec.name and section = sec_rec.section_name;
      missing_cnt := greatest(0, coalesce(sec_rec.seat_capacity, 0) - cur_cnt);
      for k in 0..(missing_cnt - 1) loop
        seq_cnt := seq_cnt + 1;
        max_roll := max_roll + 1;
        r_num := max_roll;
        sid := 's-full-' || (c_idx + 1) || '-' || (s_idx + 1) || '-' || (cur_cnt + k + 1);
        f_name := first_names[1 + ((c_idx * 17 + s_idx * 11 + k * 3 + r_num) % array_length(first_names, 1))];
        l_name := last_names[1 + ((c_idx * 7 + s_idx * 13 + k * 5 + r_num) % array_length(last_names, 1))];
        g_pre := g_prefixes[1 + ((c_idx + s_idx + k) % array_length(g_prefixes, 1))];
        g_first := first_names[1 + ((c_idx * 5 + s_idx * 9 + k * 7 + 3) % array_length(first_names, 1))];
        ph_num := ph_prefixes[1 + ((seq_cnt + k) % array_length(ph_prefixes, 1))]
          || lpad((11 + ((c_idx * 7 + s_idx * 3 + k) % 88))::text, 2, '0')
          || '-'
          || lpad((100000 + ((seq_cnt * 7919) % 899999))::text, 6, '0');
        paid_val := paid_samples[1 + ((c_idx + s_idx + k) % array_length(paid_samples, 1))];

        insert into public.students (id, name, cls, roll, section, guardian, phone, payable, paid)
        values (sid, f_name || ' ' || l_name, cls_rec.name, r_num, sec_rec.section_name, g_pre || ' ' || g_first || ' ' || l_name, ph_num, 33500, paid_val)
        on conflict (id) do nothing;
      end loop;
      s_idx := s_idx + 1;
    end loop;
  end loop;
end $$;

insert into public.student_costs (id, student_id, cost_type_id, name, amount, paid)
select
  st.id || '-' || ct.id,
  st.id,
  ct.id,
  ct.name,
  ct.amount,
  greatest(0, least(ct.amount, st.paid - coalesce(ct.prev_sum, 0)))
from public.students st
cross join (
  select
    c.id,
    c.name,
    c.amount,
    sum(c.amount) over (
      order by case c.id
        when 'ct-admission'   then 1
        when 'ct-uniform'     then 2
        when 'ct-tuition'     then 3
        when 'ct-stationary'  then 4
        when 'ct-exam'        then 5
        when 'ct-sports'      then 6
        when 'ct-festival'    then 7
        when 'ct-transport'   then 8
        when 'ct-library'     then 9
        when 'ct-lab'         then 10
        when 'ct-development' then 11
        else 99
      end
      rows between unbounded preceding and 1 preceding
    ) as prev_sum
  from public.cost_types c
  where not c.is_custom
) ct
where st.id like 's-%'
on conflict (id) do nothing;

-- ============================================================
-- লাইভ রিয়েলটাইম সিঙ্ক (Supabase Realtime Publication)
-- ============================================================
do $$
declare
  tbl text;
  tbls text[] := array[
    'school_settings', 'classes', 'class_sections', 'subjects', 'board_books',
    'class_extra_activities', 'students', 'student_payment_history', 'school_media',
    'teachers', 'notices', 'admissions', 'fees', 'attendance', 'results',
    'books', 'book_loans', 'transport_routes', 'departments', 'employees',
    'office_attendance', 'leaves', 'payroll', 'tasks', 'expenses',
    'office_docs', 'cost_types', 'student_costs'
  ];
begin
  foreach tbl in array tbls loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = tbl
    ) then
      execute format('alter publication supabase_realtime add table public.%I;', tbl);
    end if;
  end loop;
end $$;

