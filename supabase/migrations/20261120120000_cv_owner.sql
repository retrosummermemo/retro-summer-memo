-- A CV is either general (one per profile or role: "CV React", "CV Arquitecto") or made for one
-- application: a copy of a general CV tailored to that posting. based_on remembers the CV it was
-- copied from. No foreign keys: a CV whose application is gone counts as general again, and the
-- original of a copy may be deleted without touching the copy.
alter table public.cvs
  add column application_id text,
  add column based_on text;

create index cvs_application on public.cvs (user_id, application_id) where application_id is not null;

-- CVs built for an application before this change: the only CV that application points to, when
-- no other application points to it and it targets the same company.
update public.cvs c
set application_id = a.id
from public.applications a
where a.user_id = c.user_id
  and a.attachment ->> 'kind' = 'cv'
  and a.attachment ->> 'cvId' = c.id
  and c.target_company <> ''
  and lower(trim(c.target_company)) = lower(trim(a.company))
  and (
    select count(*)
    from public.applications other
    where other.user_id = c.user_id
      and other.attachment ->> 'kind' = 'cv'
      and other.attachment ->> 'cvId' = c.id
  ) = 1;
