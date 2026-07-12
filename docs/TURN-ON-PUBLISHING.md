<!--
  secret-scan: allow-example
  This file shows what a deploy-hook URL looks like, so the build's secret
  scanner would otherwise flag it. The URLs below are placeholders, not real.
-->

# Turn on publishing

**For: Susana — 5 minutes, one time only.**

Right now, when you edit your website and hit **Save & publish**, your changes
get saved — but the live website doesn't update yet. You'd see a message saying
*"Auto-publish isn't configured yet."*

This connects the last wire. Once you've done it, hitting **Save & publish**
will update susanastethersphotography.com about a minute later, automatically,
forever. You only do this once.

---

## Why this step exists

Your website isn't built fresh every time someone visits — that would be slow.
Instead it's pre-built and served as finished pages, which is why it loads fast
and why Google can read it properly.

The trade-off: when you change the text, something has to tell the website
*"rebuild yourself with the new words."* That's what this does.

---

## Part 1 — Get the link from Vercel

Vercel is the service that hosts your website.

1. Go to **vercel.com** and sign in
2. Click your **susanastethersphotography** project
3. Click **Settings** (along the top)
4. Click **Git** (in the left-hand menu)
5. Scroll down to a section called **Deploy Hooks**
6. Fill in the two boxes:
   - **Hook Name:** `admin-publish`
   - **Git Branch Name:** `main`
7. Click **Create Hook**

It will show you a long web address starting with
`https://api.vercel.com/v1/integrations/deploy/...`

8. Click **Copy** to copy it

> ### ⚠️ Treat this link like a password
> Anyone who has it can make your website rebuild itself over and over.
> **Don't** paste it into an email, a message, a document, or the code.
> It goes in exactly one place — the next step.

---

## Part 2 — Give the link to your website

Supabase is where your website's text, photos and client inquiries are stored.

1. Go to **supabase.com** and sign in
2. Open your project
3. In the left-hand menu, click **SQL Editor**
4. Click **New query**
5. Copy the four lines below and paste them into the big empty box:

```sql
update public.admin_settings
set value = 'PASTE_YOUR_LINK_HERE',
    updated_at = now()
where key = 'vercel_deploy_hook';
```

6. Now select the words `PASTE_YOUR_LINK_HERE` — **keep the single quotes
   around it** — and paste your copied link over them.

   It should end up looking like this (your link will be different):

   ```sql
   set value = 'https://api.vercel.com/v1/integrations/deploy/prj_abc123/XyZ789',
   ```

7. Click **Run** (bottom right, or press Cmd+Enter)

You should see **Success. No rows returned.** That's what you want.

---

## Part 3 — Check it worked

1. Go to **susanastethersphotography.com/admin** and sign in
2. Click **Website text**
3. Change any word — even just add a full stop somewhere
4. Click **Save & publish**

**You should see:** *"Saved. Your changes will be live in about a minute."*

If it still says *"Auto-publish isn't configured yet"*, the link didn't save.
Go back to Part 2 and check the quotes are still there around the link.

5. Wait a minute, then open your website in a new tab and confirm the change
   is really there. (You may need to press **Cmd+Shift+R** to force a refresh.)

---

## If something goes wrong

Nothing here can break your website. The worst case is that publishing doesn't
turn on and everything carries on exactly as it does today — your edits still
save, they just don't go live automatically.

If you get stuck, send Juan a screenshot of what you're seeing.

---

## For Juan — why the link isn't in this repo

The deploy-hook URL is a capability URL: possession *is* authorisation. There's
no second factor, no signature, nothing to check — a `POST` to it triggers a
build, full stop.

Committing it would put it in git history permanently (and in a public repo,
in front of everyone). Instead it lives in `public.admin_settings`, which has
RLS allowing `SELECT` only to a user in `public.admins`. The admin page reads it
at publish time; an anonymous visitor querying that table gets `[]`.

Verify that's still true:

```bash
curl -s "https://tmqekundfuqcoutneruv.supabase.co/rest/v1/admin_settings?select=*" \
  -H "apikey: sb_publishable_JzZDyw274XrMeOskClD5eA_04YSF1At"
```

Expected: `[]` — even after she's pasted the hook in.
