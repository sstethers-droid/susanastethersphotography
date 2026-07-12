(function () {
  'use strict';
  var cfg = window.SITE_CONFIG || {};
  var OWNER_EMAIL = 'susanastethersphotography@gmail.com';
  if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return;
  var client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  function message(el, text, kind) {
    el.textContent = text;
    el.hidden = !text;
    el.className = 'admin-message' + (kind ? ' is-' + kind : '');
  }

  var loginForm = document.getElementById('login-form');
  if (loginForm) {
    var loginMessage = document.getElementById('login-message');
    client.auth.getSession().then(function (result) {
      if (result.data.session && result.data.session.user.email === OWNER_EMAIL) location.replace('/admin.html');
    });
    loginForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var email = document.getElementById('login-email').value.trim().toLowerCase();
      var password = document.getElementById('login-password').value;
      if (email !== OWNER_EMAIL) return message(loginMessage, 'This portal is only available to the website owner.', 'error');
      message(loginMessage, 'Signing you in…');
      client.auth.signInWithPassword({ email: email, password: password }).then(function (result) {
        if (result.error) throw result.error;
        location.replace('/admin.html');
      }).catch(function (error) { message(loginMessage, error.message, 'error'); });
    });
    document.getElementById('create-account').addEventListener('click', function () {
      var email = document.getElementById('login-email').value.trim().toLowerCase();
      var password = document.getElementById('login-password').value;
      if (email !== OWNER_EMAIL) return message(loginMessage, 'Use your approved business email to create the owner account.', 'error');
      if (password.length < 8) return message(loginMessage, 'Choose a secure password with at least 8 characters first.', 'error');
      message(loginMessage, 'Creating your owner account…');
      client.auth.signUp({ email: email, password: password, options: { emailRedirectTo: location.origin + '/admin.html' } }).then(function (result) {
        if (result.error) throw result.error;
        if (result.data.session) location.replace('/admin.html');
        else message(loginMessage, 'Check your business email and click the confirmation link, then return here to sign in.', 'success');
      }).catch(function (error) { message(loginMessage, error.message, 'error'); });
    });
    document.getElementById('forgot-password').addEventListener('click', function () {
      var email = document.getElementById('login-email').value.trim().toLowerCase();
      if (email !== OWNER_EMAIL) return message(loginMessage, 'Enter your approved business email first.', 'error');
      client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/login.html' }).then(function (result) {
        if (result.error) throw result.error;
        message(loginMessage, 'Password reset email sent. Check your inbox.', 'success');
      }).catch(function (error) { message(loginMessage, error.message, 'error'); });
    });
    return;
  }

  var app = document.getElementById('admin-app');
  if (!app) return;
  var loading = document.getElementById('admin-loading');
  var bookings = [];
  var activeFilter = 'all';
  var fallbackImages = {
    'hero':'images/hero-1600.jpg','hero-maternity':'images/hero-maternity-1600.jpg','hero-newborn':'images/hero-newborn-1600.jpg',
    'about-portrait':'images/about-portrait-960.jpg','exp-wide':'images/exp-wide-1600.jpg','contact':'images/contact-1000.jpg'
  };
  ['sess-newborn','sess-family','sess-maternity','sess-couples'].forEach(function (s) { fallbackImages[s] = 'images/' + s + '-560.jpg'; });
  ['pkg-newborn','pkg-family','pkg-maternity'].forEach(function (s) { fallbackImages[s] = 'images/' + s + '-760.jpg'; });
  ['exp-1'].forEach(function (s) { fallbackImages[s] = 'images/' + s + '-1120.jpg'; });
  ['exp-2'].forEach(function (s) { fallbackImages[s] = 'images/' + s + '-600.jpg'; });
  for (var n=1;n<=6;n++) fallbackImages['ig-'+n] = 'images/ig-'+n+'-600.jpg';
  ['newborn','family','motherhood','milestone'].forEach(function (cat) { for(var i=1;i<=3;i++) fallbackImages['portfolio-'+cat+'-'+i]='images/portfolio-'+cat+'-'+i+'-800.jpg'; });

  client.auth.getUser().then(function (result) {
    var user = result.data.user;
    if (!user || user.email !== OWNER_EMAIL) {
      client.auth.signOut().finally(function () { location.replace('/login.html'); });
      return;
    }
    document.getElementById('owner-email').textContent = user.email;
    loading.hidden = true;
    app.hidden = false;
    loadBookings();
  });

  document.getElementById('sign-out').addEventListener('click', function () { client.auth.signOut().then(function () { location.replace('/login.html'); }); });
  document.querySelectorAll('[data-admin-tab]').forEach(function (button) {
    button.addEventListener('click', function () {
      var tab = button.dataset.adminTab;
      document.querySelectorAll('[data-admin-tab]').forEach(function (b) { b.classList.toggle('is-active', b === button); });
      document.getElementById('bookings-panel').hidden = tab !== 'bookings';
      document.getElementById('photos-panel').hidden = tab !== 'photos';
      document.getElementById('admin-title').textContent = tab === 'bookings' ? 'Bookings' : 'Website photos';
      if (tab === 'photos') loadPhotos();
    });
  });
  document.getElementById('refresh-bookings').addEventListener('click', loadBookings);
  document.querySelectorAll('[data-status-filter]').forEach(function (button) {
    button.addEventListener('click', function () {
      activeFilter = button.dataset.statusFilter;
      document.querySelectorAll('[data-status-filter]').forEach(function (b) { b.classList.toggle('is-active', b === button); });
      renderBookings();
    });
  });

  function loadBookings() {
    message(document.getElementById('bookings-message'), 'Loading bookings…');
    client.from('inquiries').select('*').order('created_at', { ascending:false }).then(function (result) {
      if (result.error) throw result.error;
      bookings = result.data || [];
      document.getElementById('new-count').textContent = bookings.filter(function (b) { return b.status === 'new'; }).length;
      message(document.getElementById('bookings-message'), bookings.length ? '' : 'No inquiries yet. New contact-form submissions will appear here.');
      renderBookings();
    }).catch(function (error) { message(document.getElementById('bookings-message'), error.message, 'error'); });
  }

  function el(tag, className, text) { var node=document.createElement(tag); if(className)node.className=className; if(text!=null)node.textContent=text; return node; }
  function renderBookings() {
    var list = document.getElementById('booking-list'); list.replaceChildren();
    bookings.filter(function (b) { return activeFilter === 'all' || b.status === activeFilter; }).forEach(function (booking) {
      var card=el('article','booking-card'); var info=el('div'); var title=el('h2','',booking.name); var meta=el('div','booking-card__meta');
      meta.append(el('div','',booking.email),el('div','',booking.session_type||'Session not selected'),el('div','',new Date(booking.created_at).toLocaleString()));
      info.append(title,meta,el('p','booking-card__message',booking.message||'No message included.'));
      var controls=el('div','booking-card__controls');
      var statusLabel=el('label','', 'Status'); var status=el('select'); ['new','contacted','booked','completed','archived'].forEach(function(v){var o=el('option','',v.charAt(0).toUpperCase()+v.slice(1));o.value=v;o.selected=booking.status===v;status.append(o);}); statusLabel.append(status);
      var dateLabel=el('label','', 'Session date'); var date=el('input');date.type='date';date.value=booking.session_date||'';dateLabel.append(date);
      var notesLabel=el('label','', 'Private notes'); var notes=el('textarea');notes.value=booking.admin_notes||'';notesLabel.append(notes);
      var save=el('button','admin-secondary booking-save','Save changes');save.type='button';
      save.addEventListener('click',function(){save.disabled=true;save.textContent='Saving…';client.from('inquiries').update({status:status.value,session_date:date.value||null,admin_notes:notes.value||null}).eq('id',booking.id).select().single().then(function(r){if(r.error)throw r.error;Object.assign(booking,r.data);save.textContent='Saved';setTimeout(function(){save.textContent='Save changes';save.disabled=false;},1200);}).catch(function(e){save.textContent=e.message;save.disabled=false;});});
      controls.append(statusLabel,dateLabel,notesLabel,save); card.append(info,controls); list.append(card);
    });
  }

  var photosLoaded=false;
  function loadPhotos() {
    if (photosLoaded) return; photosLoaded=true;
    client.from('site_images').select('*').order('section').order('label').then(function(result){if(result.error)throw result.error;renderPhotos(result.data||[]);message(document.getElementById('photos-message'),'');}).catch(function(error){photosLoaded=false;message(document.getElementById('photos-message'),error.message,'error');});
  }
  function renderPhotos(rows) {
    var root=document.getElementById('photo-groups');root.replaceChildren();var sections={};rows.forEach(function(r){(sections[r.section]||(sections[r.section]=[])).push(r);});
    Object.keys(sections).forEach(function(section){var group=el('section','photo-group');group.append(el('h2','',section));var grid=el('div','photo-grid');sections[section].forEach(function(row){
      var card=el('article','photo-card');var preview=el('div','photo-card__preview');var image=el('img');image.src=row.url||fallbackImages[row.slot]||'';image.alt='Current '+row.label;preview.append(image);var body=el('div','photo-card__body');body.append(el('h3','',row.label));var input=el('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';var upload=el('button','admin-secondary','Replace photo');upload.type='button';var status=el('p','photo-card__status','');
      upload.addEventListener('click',function(){var file=input.files[0];if(!file){status.textContent='Choose an image first.';return;}if(file.size>15728640){status.textContent='Please choose an image under 15 MB.';return;}upload.disabled=true;upload.textContent='Uploading…';var safe=file.name.toLowerCase().replace(/[^a-z0-9.]+/g,'-');var path=row.slot+'/'+Date.now()+'-'+safe;client.storage.from('site-media').upload(path,file,{cacheControl:'3600',upsert:false}).then(function(r){if(r.error)throw r.error;var publicUrl=client.storage.from('site-media').getPublicUrl(path).data.publicUrl;return client.from('site_images').update({url:publicUrl,storage_path:path,updated_at:new Date().toISOString()}).eq('slot',row.slot).select().single().then(function(u){if(u.error)throw u.error;return {updated:u.data,old:row.storage_path};});}).then(function(done){row.url=done.updated.url;row.storage_path=done.updated.storage_path;image.src=row.url;input.value='';status.textContent='Updated on the website.';upload.textContent='Replace photo';upload.disabled=false;if(done.old)client.storage.from('site-media').remove([done.old]);}).catch(function(e){status.textContent=e.message;upload.textContent='Replace photo';upload.disabled=false;});});
      body.append(input,upload,status);card.append(preview,body);grid.append(card);
    });group.append(grid);root.append(group);});
  }
})();
