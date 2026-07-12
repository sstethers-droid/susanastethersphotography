/* ===========================================================================
   Owner portal
   ---------------------------------------------------------------------------
   SECURITY NOTE — read this before changing anything in this file.

   Nothing here is a security control. This code runs in the visitor's browser;
   they can edit it, or skip it entirely. An attacker does not run your
   JavaScript — they call the Supabase REST API directly, using the public key
   that is sitting in plain sight in js/config.js.

   The real protection is Row Level Security, in supabase/schema.sql:
     - anon may INSERT an inquiry and nothing else. It cannot read one back.
     - reading/updating inquiries, text and photos requires a row in
       public.admins, keyed to a specific user id — NOT to the `authenticated`
       role. Someone who signs up becomes authenticated; they still get nothing.

   The checks below exist to give Susana a sane experience (send her to the
   login page, hide the UI until she's known), not to keep anyone out. If you
   ever find yourself relying on a check in this file to protect data: stop,
   and put it in a policy instead.
   =========================================================================== */
(function () {
  'use strict';

  var cfg = window.SITE_CONFIG || {};
  if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return;
  var db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  function say(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
    el.className = 'admin-message' + (kind ? ' is-' + kind : '');
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ==================================================================== LOGIN */
  var loginForm = document.getElementById('login-form');
  if (loginForm) {
    var loginMsg = document.getElementById('login-message');
    var loginBtn = document.getElementById('login-submit');

    db.auth.getSession().then(function (r) {
      if (r.data.session) location.replace('/admin');
    });

    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      say(loginMsg, '');
      loginBtn.disabled = true;
      loginBtn.textContent = 'Signing in…';

      db.auth
        .signInWithPassword({
          email: document.getElementById('login-email').value.trim().toLowerCase(),
          password: document.getElementById('login-password').value,
        })
        .then(function (r) {
          if (r.error) throw r.error;
          location.replace('/admin');
        })
        .catch(function () {
          // Deliberately vague. Saying "no such account" would tell an attacker
          // which emails exist. Wrong password and unknown user look identical.
          say(loginMsg, 'That email and password don’t match.', 'error');
          loginBtn.disabled = false;
          loginBtn.textContent = 'Sign in';
        });
    });
    return;
  }

  /* ==================================================================== ADMIN */
  var app = document.getElementById('admin-app');
  if (!app) return;

  var loading = document.getElementById('admin-loading');
  var state = { content: [], images: [], bookings: [], dirty: {} };

  db.auth.getUser().then(function (r) {
    if (!r.data.user) { location.replace('/login'); return; }
    // Ask the SERVER whether this user is an admin. is_admin() is a
    // SECURITY DEFINER function over a table nobody can read — the browser
    // cannot fake the answer.
    return db.rpc('is_admin').then(function (res) {
      if (res.error || res.data !== true) {
        return db.auth.signOut().finally(function () { location.replace('/login'); });
      }
      document.getElementById('owner-email').textContent = r.data.user.email;
      loading.hidden = true;
      app.hidden = false;
      loadContent();
      loadPhotos();
      loadBookings();
    });
  });

  document.getElementById('sign-out').addEventListener('click', function () {
    db.auth.signOut().then(function () { location.replace('/login'); });
  });

  /* ------------------------------------------------------------------- tabs */
  document.querySelectorAll('[data-admin-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var tab = btn.dataset.adminTab;
      document.querySelectorAll('[data-admin-tab]').forEach(function (b) {
        b.classList.toggle('is-active', b === btn);
      });
      ['content', 'photos', 'bookings'].forEach(function (t) {
        document.getElementById(t + '-panel').hidden = t !== tab;
      });
      document.getElementById('admin-title').textContent =
        tab === 'content' ? 'Website text' : tab === 'photos' ? 'Website photos' : 'Bookings';
    });
  });

  /* ============================================================ WEBSITE TEXT */
  function loadContent() {
    db.from('site_content').select('*').order('page').order('sort').then(function (r) {
      if (r.error) { say(document.getElementById('content-message'), r.error.message, 'error'); return; }
      state.content = r.data || [];
      renderContent();
    });
  }

  function renderContent() {
    var root = document.getElementById('content-groups');
    root.replaceChildren();

    var byPage = {};
    state.content.forEach(function (row) { (byPage[row.page] || (byPage[row.page] = [])).push(row); });

    Object.keys(byPage).forEach(function (page) {
      var details = el('details', 'cms-page');
      details.open = page === 'home';
      details.append(el('summary', 'cms-page__title', page.charAt(0).toUpperCase() + page.slice(1)));

      var bySection = {};
      byPage[page].forEach(function (row) { (bySection[row.section] || (bySection[row.section] = [])).push(row); });

      Object.keys(bySection).forEach(function (section) {
        details.append(el('h3', 'cms-section', section));

        bySection[section].forEach(function (row) {
          var field = el('label', 'cms-field');
          field.append(el('span', 'cms-field__label', row.label));

          var input = row.kind === 'textarea' ? el('textarea') : el('input');
          if (row.kind === 'textarea') input.rows = 3; else input.type = 'text';
          input.value = row.value;

          // Live counter on the Google description: it gets cut off past ~160
          // characters, and under ~70 it wastes the space.
          if (row.key.indexOf('.meta.description') !== -1) {
            var count = el('span', 'cms-field__count');
            var upd = function () {
              var n = input.value.length;
              count.textContent = n + ' / 160';
              count.className = 'cms-field__count' +
                (n > 160 ? ' is-over' : n < 70 ? ' is-short' : ' is-good');
            };
            input.addEventListener('input', upd);
            upd();
            field.append(count);
          }

          input.addEventListener('input', function () {
            state.dirty[row.key] = input.value;
            markDirty();
          });

          field.append(input);
          details.append(field);
        });
      });

      root.append(details);
    });
  }

  /* ----------------------------------------------------------- save & publish */
  var saveBar = document.getElementById('save-bar');
  var saveBtn = document.getElementById('save-publish');
  var saveMsg = document.getElementById('save-message');

  function markDirty() {
    var n = Object.keys(state.dirty).length;
    saveBar.hidden = n === 0;
    document.getElementById('dirty-count').textContent =
      n + (n === 1 ? ' unsaved change' : ' unsaved changes');
  }

  // Don't let her lose work by closing the tab mid-edit.
  window.addEventListener('beforeunload', function (e) {
    if (Object.keys(state.dirty).length) { e.preventDefault(); e.returnValue = ''; }
  });

  saveBtn.addEventListener('click', function () {
    var keys = Object.keys(state.dirty);
    if (!keys.length) return;

    saveBtn.disabled = true;
    say(saveMsg, 'Saving…');

    Promise.all(keys.map(function (key) {
      return db.from('site_content')
        .update({ value: state.dirty[key], updated_at: new Date().toISOString() })
        .eq('key', key);
    }))
      .then(function (results) {
        var bad = results.filter(function (r) { return r.error; });
        if (bad.length) throw new Error(bad[0].error.message);
        state.dirty = {};
        markDirty();
        return publish();
      })
      .catch(function (e) { say(saveMsg, e.message, 'error'); })
      .finally(function () { saveBtn.disabled = false; });
  });

  /**
   * Saving writes to the database — but the live site is static HTML, so it
   * only changes when Vercel rebuilds. This kicks that off.
   *
   * The deploy-hook URL lives in a table only an admin can read. If it were in
   * config.js, any visitor could spam rebuilds of her website.
   */
  function publish() {
    say(saveMsg, 'Publishing to the live site…');
    return db.from('admin_settings')
      .select('value')
      .eq('key', 'vercel_deploy_hook')
      .maybeSingle()
      .then(function (r) {
        if (r.error || !r.data || !r.data.value) {
          say(saveMsg, 'Saved. (Auto-publish isn’t configured yet — see README.)', 'success');
          return;
        }
        return fetch(r.data.value, { method: 'POST' }).then(function () {
          say(saveMsg, 'Saved. Your changes will be live in about a minute.', 'success');
        });
      });
  }

  /* =================================================================== PHOTOS */
  function loadPhotos() {
    db.from('site_images').select('*').order('section').order('sort').order('label').then(function (r) {
      if (r.error) { say(document.getElementById('photos-message'), r.error.message, 'error'); return; }
      state.images = r.data || [];
      renderPhotos();
    });
  }

  function renderPhotos() {
    var root = document.getElementById('photo-groups');
    root.replaceChildren();

    var bySection = {};
    state.images.forEach(function (row) { (bySection[row.section] || (bySection[row.section] = [])).push(row); });

    Object.keys(bySection).forEach(function (section) {
      var group = el('section', 'photo-group');
      group.append(el('h3', 'cms-section', section));
      var grid = el('div', 'photo-grid');

      bySection[section].forEach(function (row) {
        var card = el('article', 'photo-card');

        var preview = el('div', 'photo-card__preview');
        var img = el('img');
        img.src = row.url || 'images/' + row.slot + '-560.jpg';
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', function () {
          img.replaceWith(el('div', 'photo-card__empty', 'No photo yet'));
        });
        preview.append(img);

        var body = el('div', 'photo-card__body');
        body.append(el('h4', '', row.label));

        var file = el('input');
        file.type = 'file';
        file.accept = 'image/jpeg,image/png,image/webp';

        // Alt text is both an accessibility requirement and a real SEO signal —
        // it's how Google works out what a photograph actually shows.
        var altWrap = el('label', 'cms-field');
        altWrap.append(el('span', 'cms-field__label', 'Describe this photo (for Google & screen readers)'));
        var alt = el('input');
        alt.type = 'text';
        alt.value = row.alt || '';
        alt.placeholder = 'e.g. Mother holding her newborn in a sunlit nursery';
        altWrap.append(alt);

        var btn = el('button', 'admin-secondary', 'Save photo');
        btn.type = 'button';
        var status = el('p', 'photo-card__status', '');

        btn.addEventListener('click', function () {
          var f = file.files[0];
          var altChanged = (alt.value || '') !== (row.alt || '');
          if (!f && !altChanged) { status.textContent = 'Nothing to save.'; return; }
          if (f && f.size > 15 * 1024 * 1024) { status.textContent = 'Please choose an image under 15 MB.'; return; }

          btn.disabled = true;
          btn.textContent = f ? 'Uploading…' : 'Saving…';

          var chain = Promise.resolve(null);
          if (f) {
            var safe = f.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
            var path = row.slot + '/' + Date.now() + '-' + safe;
            chain = db.storage.from('site-media')
              .upload(path, f, { cacheControl: '31536000', upsert: false })
              .then(function (up) {
                if (up.error) throw up.error;
                return {
                  url: db.storage.from('site-media').getPublicUrl(path).data.publicUrl,
                  storage_path: path,
                };
              });
          }

          chain
            .then(function (uploaded) {
              var patch = { alt: alt.value || null, updated_at: new Date().toISOString() };
              if (uploaded) { patch.url = uploaded.url; patch.storage_path = uploaded.storage_path; }
              return db.from('site_images').update(patch).eq('slot', row.slot).select().single()
                .then(function (u) {
                  if (u.error) throw u.error;
                  var old = row.storage_path;
                  Object.assign(row, u.data);
                  if (uploaded) { img.src = row.url; file.value = ''; }
                  // Bin the old file so storage doesn't grow forever.
                  if (uploaded && old) db.storage.from('site-media').remove([old]);
                });
            })
            .then(publish)
            .then(function () { status.textContent = 'Saved — live in about a minute.'; })
            .catch(function (e) { status.textContent = e.message; })
            .finally(function () {
              btn.disabled = false;
              btn.textContent = 'Save photo';
            });
        });

        body.append(file, altWrap, btn, status);
        card.append(preview, body);
        grid.append(card);
      });

      group.append(grid);
      root.append(group);
    });
  }

  /* ================================================================= BOOKINGS */
  var filter = 'all';

  function loadBookings() {
    say(document.getElementById('bookings-message'), 'Loading…');
    db.from('inquiries').select('*').order('created_at', { ascending: false }).then(function (r) {
      if (r.error) { say(document.getElementById('bookings-message'), r.error.message, 'error'); return; }
      state.bookings = r.data || [];
      document.getElementById('new-count').textContent =
        state.bookings.filter(function (b) { return b.status === 'new'; }).length;
      say(document.getElementById('bookings-message'),
        state.bookings.length ? '' : 'No inquiries yet. Contact-form submissions appear here.');
      renderBookings();
    });
  }

  document.getElementById('refresh-bookings').addEventListener('click', loadBookings);
  document.querySelectorAll('[data-status-filter]').forEach(function (b) {
    b.addEventListener('click', function () {
      filter = b.dataset.statusFilter;
      document.querySelectorAll('[data-status-filter]').forEach(function (x) {
        x.classList.toggle('is-active', x === b);
      });
      renderBookings();
    });
  });

  function renderBookings() {
    var list = document.getElementById('booking-list');
    list.replaceChildren();

    state.bookings
      .filter(function (b) { return filter === 'all' || b.status === filter; })
      .forEach(function (b) {
        var card = el('article', 'booking-card');

        var info = el('div');
        info.append(el('h2', '', b.name));

        var meta = el('div', 'booking-card__meta');
        var mail = el('a', '', b.email);
        mail.href = 'mailto:' + b.email;
        meta.append(
          mail,
          el('div', '', b.session_type || 'Session not selected'),
          el('div', '', new Date(b.created_at).toLocaleString())
        );
        info.append(meta, el('p', 'booking-card__message', b.message || 'No message included.'));

        var controls = el('div', 'booking-card__controls');

        var statusLabel = el('label', '', 'Status');
        var status = el('select');
        ['new', 'contacted', 'booked', 'completed', 'archived'].forEach(function (v) {
          var o = el('option', '', v.charAt(0).toUpperCase() + v.slice(1));
          o.value = v;
          o.selected = b.status === v;
          status.append(o);
        });
        statusLabel.append(status);

        var dateLabel = el('label', '', 'Session date');
        var date = el('input');
        date.type = 'date';
        date.value = b.session_date || '';
        dateLabel.append(date);

        var notesLabel = el('label', '', 'Private notes');
        var notes = el('textarea');
        notes.value = b.admin_notes || '';
        notesLabel.append(notes);

        var save = el('button', 'admin-secondary', 'Save');
        save.type = 'button';
        save.addEventListener('click', function () {
          save.disabled = true;
          save.textContent = 'Saving…';
          db.from('inquiries')
            .update({
              status: status.value,
              session_date: date.value || null,
              admin_notes: notes.value || null,
            })
            .eq('id', b.id)
            .select()
            .single()
            .then(function (r) {
              if (r.error) throw r.error;
              Object.assign(b, r.data);
              save.textContent = 'Saved';
              setTimeout(function () { save.textContent = 'Save'; save.disabled = false; }, 1200);
              loadBookings();
            })
            .catch(function (e) {
              save.textContent = e.message;
              save.disabled = false;
            });
        });

        controls.append(statusLabel, dateLabel, notesLabel, save);
        card.append(info, controls);
        list.append(card);
      });
  }
})();
