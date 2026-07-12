# Setup runbook

Do these in order. Steps 1–4 are the security work; 5–6 turn on auto-publish.

---

## 1. Run the schema (Supabase)

Supabase dashboard → **SQL Editor** → **New query** → paste the entire contents of
`supabase/schema.sql` → **Run**.

At the bottom it prints a verification table. You want:

| check | result |
|---|---|
| RLS enabled? — inquiries | `YES ✅` |
| RLS enabled? — site_images | `YES ✅` |
| RLS enabled? — site_content | `YES ✅` |
| RLS enabled? — admins | `YES ✅` |
| Public can read inquiries? | `NO ✅` |
| Admin registered? | `NO ❌` *(expected — fixed in step 3)* |

**If "Public can read inquiries?" says `YES ❌`, stop.** That means her client list
is readable by anyone on the internet. Don't go live until it says `NO`.

---

## 2. Seed the editable content

Same SQL Editor → new query → paste the contents of `supabase/seed.sql` → **Run**.

That loads the 135 text fields and 33 photo slots into the database so they show
up in the portal. It's safe to re-run — it never overwrites anything Susana has
already edited.

---

## 3. Create Susana's account

**Do NOT use a signup form** — there isn't one any more, on purpose. A public
signup endpoint let anyone create an account against her database.

Supabase dashboard → **Authentication** → **Users** → **Add user** → **Create new user**

- Email: `susanastethersphotography@gmail.com`
- Password: something strong
- ✅ tick **Auto Confirm User**

Then, back in the SQL Editor, register her as the admin:

```sql
insert into public.admins (user_id, email)
select id, email from auth.users
where lower(email) = lower('susanastethersphotography@gmail.com')
on conflict (user_id) do nothing;

-- confirm it worked — should return exactly 1 row
select * from public.admins;
```

Nothing in the portal works until that row exists. That's the design: being
signed in is not the same as being an admin.

---

## 4. Turn off public signups

Supabase dashboard → **Authentication** → **Sign In / Providers** → **Email**
→ turn **Allow new users to sign up** **OFF**.

Belt and braces. The RLS policies already mean a random signup gets access to
nothing, but there's no reason to let strangers create accounts at all.

---

## 5. Tell Vercel about Supabase

The build reads content from Supabase, so it needs the connection details.

Vercel → project → **Settings** → **Environment Variables** → add both, for all
environments:

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://tmqekundfuqcoutneruv.supabase.co` |
| `SUPABASE_ANON_KEY` | the `sb_publishable_...` key (same one in `js/config.js`) |

Both are public values — this is not a secret leak. **Never add the service-role
key here.**

If these are missing the site still builds; it just uses the text committed in
`content.fallback.json` and ignores Susana's edits.

---

## 6. Auto-publish (so "Save" actually updates the live site)

The website is static HTML, so it only changes when Vercel rebuilds. This wires
the portal's **Save & publish** button to trigger that.

1. Vercel → project → **Settings** → **Git** → **Deploy Hooks**
2. Create one: name `admin-publish`, branch `main`
3. Copy the URL it gives you
4. In Supabase SQL Editor:

```sql
update public.admin_settings
set value = 'PASTE_THE_DEPLOY_HOOK_URL_HERE', updated_at = now()
where key = 'vercel_deploy_hook';
```

That URL is stored in a table only an admin can read. It deliberately does *not*
go in `js/config.js` — anyone who has it can trigger rebuilds of her site.

Without this step everything still works; the portal just says *"Saved.
(Auto-publish isn't configured yet)"* and changes appear on the next push.

---

## Verify it's actually secure

After all of the above, run this in a terminal. It's what an attacker would do —
call the API directly with the public key, skipping the website entirely:

```bash
curl -s "https://tmqekundfuqcoutneruv.supabase.co/rest/v1/inquiries?select=*" \
  -H "apikey: sb_publishable_JzZDyw274XrMeOskClD5eA_04YSF1At"
```

**Expected:** `[]` — even after real inquiries exist.

If that ever returns actual names and emails, the policies aren't applied and
client data is exposed. Nothing else in the codebase can save you from that.

---

## How Susana uses it

1. Go to `/login`, sign in
2. **Website text** — edit any headline, paragraph, price, FAQ answer
3. **Website photos** — replace any photo, and describe it (helps Google + screen readers)
4. **Bookings** — every contact-form submission, with status, session date, private notes
5. Hit **Save & publish** → live in about a minute

She never touches code, GitHub, or the terminal.
