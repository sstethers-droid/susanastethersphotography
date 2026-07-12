/* ==========================================================================
   Susana Stethers Photography — site behaviour
   Vanilla JS, no dependencies. Every feature degrades gracefully.
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------ Footer year */
  document.querySelectorAll('[data-year]').forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  /* --------------------------------------------- Owner-managed site images */
  var publicCfg = window.SITE_CONFIG || {};
  if (publicCfg.SUPABASE_URL && publicCfg.SUPABASE_ANON_KEY) {
    fetch(publicCfg.SUPABASE_URL + '/rest/v1/site_images?select=slot,url&url=not.is.null', {
      headers: { 'apikey': publicCfg.SUPABASE_ANON_KEY }
    }).then(function (res) {
      if (!res.ok) throw new Error('Could not load managed images');
      return res.json();
    }).then(function (rows) {
      var bySlot = {};
      rows.forEach(function (row) { bySlot[row.slot] = row.url; });
      document.querySelectorAll('img[src*="images/"]').forEach(function (img) {
        var file = (img.getAttribute('src') || '').split('/').pop().replace(/\.(jpe?g|webp|png)$/i, '');
        var slot = file.replace(/-(280|300|380|480|500|560|600|760|800|960|1000|1120|1600|3200)$/i, '');
        if (!bySlot[slot]) return;
        var picture = img.closest('picture');
        img.src = bySlot[slot];
        img.removeAttribute('srcset');
        if (picture) picture.querySelectorAll('source').forEach(function (source) { source.srcset = bySlot[slot]; });
      });
    }).catch(function () {
      // Local images remain visible if the optional owner image service is unavailable.
    });
  }

  /* ---------------------------------------------------------------- Carousel */
  document.querySelectorAll('[data-carousel-prev], [data-carousel-next]').forEach(function (btn) {
    var isNext = btn.hasAttribute('data-carousel-next');
    var track = document.getElementById(
      btn.getAttribute(isNext ? 'data-carousel-next' : 'data-carousel-prev')
    );
    if (!track) return;

    btn.addEventListener('click', function () {
      var first = track.firstElementChild;
      var gap = parseInt(getComputedStyle(track).columnGap || '22', 10) || 22;
      var step = (first ? first.getBoundingClientRect().width : 250) + gap;
      track.scrollBy({ left: isNext ? step : -step, behavior: 'smooth' });
    });
  });

  /* ----------------------------------------------------------- Hero gallery */
  var heroSlides = document.querySelectorAll('.hero__slide');
  var heroDots = document.querySelectorAll('.hero__dots button');
  var heroIndex = 0;
  var heroTimer;
  function showHero(index) {
    heroIndex = index;
    var hero = document.querySelector('.hero');
    if (hero) hero.setAttribute('data-hero-index', String(index));
    heroSlides.forEach(function (slide, i) { slide.classList.toggle('is-active', i === index); });
    heroDots.forEach(function (dot, i) {
      dot.classList.toggle('is-active', i === index);
      if (i === index) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
  }
  function startHero() {
    if (heroSlides.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    clearInterval(heroTimer);
    heroTimer = setInterval(function () { showHero((heroIndex + 1) % heroSlides.length); }, 6000);
  }
  heroDots.forEach(function (dot, i) {
    dot.addEventListener('click', function () { showHero(i); startHero(); });
  });
  startHero();

  /* --------------------------------------------------------------------- FAQ */
  document.querySelectorAll('.faq__q').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var panel = document.getElementById(btn.getAttribute('aria-controls'));
      var mark = btn.querySelector('.faq__mark');
      var open = btn.getAttribute('aria-expanded') === 'true';

      // Accordion: close whichever one is currently open
      if (!open) {
        document.querySelectorAll('.faq__q[aria-expanded="true"]').forEach(function (other) {
          other.setAttribute('aria-expanded', 'false');
          var om = other.querySelector('.faq__mark');
          if (om) om.textContent = '+';
          var op = document.getElementById(other.getAttribute('aria-controls'));
          if (op) op.hidden = true;
        });
      }

      btn.setAttribute('aria-expanded', String(!open));
      if (mark) mark.textContent = open ? '+' : '−';
      if (panel) panel.hidden = open;
    });
  });

  /* ------------------------------------------------------------ Contact form */
  var form = document.getElementById('contact-form');
  if (!form) return;

  var errorEl = document.getElementById('form-error');
  var successEl = document.getElementById('form-success');
  var submitBtn = document.getElementById('form-submit');
  var resetBtn = document.getElementById('form-reset');
  var cfg = window.SITE_CONFIG || {};

  // Deep link: /contact.html?session=Newborn preselects the dropdown,
  // so the "Book this session" buttons on the pricing page carry intent through.
  var preset = new URLSearchParams(location.search).get('session');
  if (preset) {
    var sel = document.getElementById('f-session');
    var match = Array.prototype.find.call(sel.options, function (o) { return o.value === preset; });
    if (match) sel.value = preset;
  }

  function showError(msg, field) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.focus();
    }
  }

  function clearError() {
    errorEl.hidden = true;
    errorEl.textContent = '';
    form.querySelectorAll('[aria-invalid]').forEach(function (el) {
      el.removeAttribute('aria-invalid');
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearError();

    var name = document.getElementById('f-name');
    var email = document.getElementById('f-email');
    var session = document.getElementById('f-session');
    var message = document.getElementById('f-message');
    var honeypot = document.getElementById('f-website');

    // Bot check: a human never sees this field, so anything in it is spam.
    // Pretend it worked — telling a bot it failed just invites a retry.
    if (honeypot && honeypot.value) {
      form.hidden = true;
      successEl.hidden = false;
      return;
    }

    if (!name.value.trim()) {
      return showError('Please add your name and email so I can get back to you.', name);
    }
    if (!email.value.trim()) {
      return showError('Please add your name and email so I can get back to you.', email);
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim())) {
      return showError('That email doesn’t look quite right — mind double-checking it?', email);
    }

    var payload = {
      name: name.value.trim(),
      email: email.value.trim(),
      session_type: session.value || null,
      message: message.value.trim() || null
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    send(payload)
      .then(function () {
        form.hidden = true;
        successEl.hidden = false;
        successEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      })
      .catch(function (err) {
        console.error('[contact]', err);
        showError(
          'Something went wrong sending your message. Please try again, or email me directly at ' +
          (cfg.FALLBACK_EMAIL || '') + '.'
        );
      })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send message';
      });
  });

  /**
   * Post the inquiry to Supabase's auto-generated REST endpoint.
   * No SDK needed — it's one fetch call, which keeps the page fast.
   * If Supabase isn't configured yet, fall back to opening the visitor's
   * email client so a real lead is never silently dropped.
   */
  function send(payload) {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      var subject = 'Session inquiry — ' + payload.name;
      var body =
        'Name: ' + payload.name + '\n' +
        'Email: ' + payload.email + '\n' +
        'Session: ' + (payload.session_type || 'Not specified') + '\n\n' +
        (payload.message || '');
      window.location.href =
        'mailto:' + (cfg.FALLBACK_EMAIL || '') +
        '?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(body);
      return Promise.resolve();
    }

    return fetch(cfg.SUPABASE_URL + '/rest/v1/inquiries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': cfg.SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + cfg.SUPABASE_ANON_KEY,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error('Supabase responded ' + res.status + ': ' + t);
        });
      }
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      form.reset();
      form.hidden = false;
      successEl.hidden = true;
      clearError();
      document.getElementById('f-name').focus();
    });
  }
})();
