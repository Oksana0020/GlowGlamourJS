(function () {
  const localDB = new PouchDB('cosmetics');
  const REMOTE_URL = 'http://admin:mtu12345@127.0.0.1:5984/cosmetics';
  const remoteDB = new PouchDB(REMOTE_URL, { skip_setup: false });

  const $status = document.getElementById('sync-status');
  const $tbody  = document.getElementById('products-body');
  const $form   = document.getElementById('product-form');
  const $save   = document.getElementById('save-btn');
  const $reset  = document.getElementById('reset-btn');
  const $reload = document.getElementById('reload-btn');

  const sync = PouchDB.sync(localDB, remoteDB, { live: true, retry: true })
    .on('change', info => setStatus('syncing…'))
    .on('paused', err => setStatus(navigator.onLine ? 'idle' : 'offline'))
    .on('active', () => setStatus('syncing…'))
    .on('denied', err => { console.error('Denied', err); setStatus('denied'); })
    .on('complete', info => setStatus('complete'))
    .on('error', err => { console.error('Sync error', err); setStatus('error'); });

  function setStatus(text) { $status.textContent = text; }

  // CRUD helpers
  async function listProducts() {
    const res = await localDB.allDocs({ include_docs: true, limit: 100 });
    return res.rows
      .map(r => r.doc)
      .filter(d => d && !d._id.startsWith('_design'))
      // filtering out products with empty or missing essential fields
      .filter(d => d.brand && d.brand.trim() && d.product_name && d.product_name.trim())
      .sort((a, b) => (a.brand || '').localeCompare(b.brand || ''));
  }

  async function createOrUpdate(doc) {
    console.log('Creating/updating document:', doc);
    if (!doc._id) {
      doc._id = `product:${crypto.randomUUID()}`;
    }
    
    console.log('Document with ID:', doc);

    try {
      const existing = await localDB.get(doc._id).catch(() => null);
      if (existing) {
        doc._rev = existing._rev;
        console.log('Updating existing document');
      } else {
        console.log('Creating new document');
      }
      
      const res = await localDB.put(doc);
      console.log('PouchDB put result:', res);
      return res;
    } catch (e) {
      console.error('Error in createOrUpdate:', e);
      if (e.status === 409) {
        console.log('Resolving conflict...');
        const current = await localDB.get(doc._id);
        doc._rev = current._rev;
        return localDB.put(doc);
      }
      throw e;
    }
  }

  function deleteProduct(id, rev) {
    return localDB.remove(id, rev);
  }

  async function cleanupEmptyProducts() {
    try {
      const res = await localDB.allDocs({ include_docs: true, limit: 100 });
      const emptyDocs = res.rows
        .map(r => r.doc)
        .filter(d => d && !d._id.startsWith('_design'))
        .filter(d => !d.brand || !d.brand.trim() || !d.product_name || !d.product_name.trim());
      
      for (const doc of emptyDocs) {
        await localDB.remove(doc._id, doc._rev);
      }
    } catch (err) {
      console.log('Cleanup completed or no empty products found');
    }
  }

  function getFormData() {
    const fd = new FormData($form);
    const m = Object.fromEntries(fd.entries());
    m.price_usd = Number(m.price_usd);
    m.rating    = Number(m.rating);
    if (!m._id) delete m._id;
    return m;
  }

  function fillForm(doc) {
    $form._id.value          = doc._id || '';
    $form.brand.value        = doc.brand || '';
    $form.product_name.value = doc.product_name || '';
    $form.category.value     = doc.category || '';
    $form.price_usd.value    = doc.price_usd ?? '';
    $form.rating.value       = doc.rating ?? '';
  }

  function resetForm() {
    fillForm({}); 
    $form.brand.focus();
  }

  async function render() {
    console.log('Rendering products...');
    const docs = await listProducts();
    console.log('Found products:', docs.length, docs);
    
    $tbody.innerHTML = '';
    for (const d of docs) {
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td>${escape(d.brand ?? '')}</td>
        <td>${escape(d.product_name ?? '')}</td>
        <td>${escape(d.category ?? '')}</td>
        <td>$${Number(d.price_usd ?? 0).toFixed(2)}</td>
        <td>${Number(d.rating ?? 0).toFixed(1)}</td>
        <td>
          <button data-act="edit" data-id="${d._id}">Edit</button>
          <button data-act="delete" data-id="${d._id}" data-rev="${d._rev}">Delete</button>
        </td>
      `;
      $tbody.appendChild(tr);
    }
  }

  function escape(s) {
    return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  // Events  
  $form.addEventListener('submit', async e => {
    e.preventDefault();
    console.log('Form submitted');
    
    try {
      const doc = getFormData();
      console.log('Form data:', doc);
      
      const result = await createOrUpdate(doc);
      console.log('Save result:', result);
      
      resetForm();
      await render();
      console.log('Product saved successfully');
    } catch (error) {
      console.error('Error saving product:', error);
      alert('Error saving product: ' + error.message);
    }
  });

  $reset.addEventListener('click', () => resetForm());
  $reload.addEventListener('click', () => render());

  $tbody.addEventListener('click', async e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const { act, id, rev } = btn.dataset;

    if (act === 'edit') {
      const doc = await localDB.get(id);
      fillForm(doc);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (act === 'delete') {
      if (confirm('Delete this product?')) {
        await deleteProduct(id, rev);
        await render();
      }
    }
  });

  localDB.changes({ live: true, include_docs: true })
    .on('change', () => render())
    .on('error', console.error);

  resetForm();
  cleanupEmptyProducts().then(() => render());

})();