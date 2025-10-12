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
  const $searchInput = document.getElementById('search-input');
  const $searchBtn = document.getElementById('search-btn');
  const $searchResults = document.getElementById('search-results');

  console.log('DOM elements found:');
  console.log('Form:', $form);
  console.log('Save button:', $save);
  console.log('Reset button:', $reset);
  console.log('Reload button:', $reload);
  console.log('Table body:', $tbody);
  console.log('Status span:', $status);

  //temporarily disabled remote sync for testing
  // const sync = PouchDB.sync(localDB, remoteDB, { live: true, retry: true })
  //   .on('change', info => setStatus('syncing…'))
  //   .on('paused', err => setStatus(navigator.onLine ? 'idle' : 'offline'))
  //   .on('active', () => setStatus('syncing…'))
  //   .on('denied', err => { console.error('Denied', err); setStatus('denied'); })
  //   .on('complete', info => setStatus('complete'))
  //   .on('error', err => { console.error('Sync error', err); setStatus('error'); });

  // status offline for testing
  setStatus('offline - local only');

  function setStatus(text) { $status.textContent = text; }

  // CRUD helpers
  async function listProducts(limit = 30) {
    try {
      const res = await localDB.allDocs({ 
        include_docs: true,
        limit: 200  
      });
      
      console.log('Found', res.rows.length, 'documents to check');
      
      const validProducts = res.rows
        .map(r => r.doc)
        .filter(d => d && !d._id.startsWith('_design')) 
        .filter(d => d.brand && d.brand.trim() && d.product_name && d.product_name.trim())
        .sort((a, b) => (a.brand || '').localeCompare(b.brand || ''))
        .slice(0, limit);
      
      console.log('Returning', validProducts.length, 'valid products');
      return validProducts;
    } catch (error) {
      console.error('Error in listProducts:', error);
      return [];
    }
  }

  function generateId() {
    return Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
  }

  async function createOrUpdate(doc) {
    console.log('Creating/updating document:', doc);
    if (!doc._id) {
      doc._id = `product:${generateId()}`;
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
    console.log('Rendering products');
    const docs = await listProducts(30); 
    console.log('Displaying products:', docs.length, 'in alphabetical order');
    
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

  // Search functionality
  async function searchProducts(searchTerm) {
    if (!searchTerm.trim()) {
      $searchResults.innerHTML = '<div class="search-no-results">Please enter a product name to search.</div>';
      return;
    }

    try {
      const searches = [];
      
      const existingRes = await localDB.allDocs({ 
        include_docs: true,
        limit: 500
      });
      
      const userRes = await localDB.allDocs({ 
        include_docs: true,
        startkey: 'product:',
        endkey: 'product:\ufff0'
      });
      
      const allRows = [...existingRes.rows, ...userRes.rows];
      
      const products = allRows
        .map(r => r.doc)
        .filter(d => d && !d._id.startsWith('_design')) 
        .filter(d => d.brand && d.brand.trim() && d.product_name && d.product_name.trim())
        .filter(d => {
          const q = searchTerm.toLowerCase();
          return d.product_name?.toLowerCase().includes(q) || d.brand?.toLowerCase().includes(q);
        })
        // Remove duplicates by ID
        .filter((doc, index, array) => array.findIndex(d => d._id === doc._id) === index);

      displaySearchResults(products, searchTerm);
    } catch (error) {
      console.error('Search error:', error);
      $searchResults.innerHTML = '<div class="search-no-results">Error occurred while searching.</div>';
    }
  }

  function displaySearchResults(products, searchTerm) {
    if (products.length === 0) {
      $searchResults.innerHTML = `<div class="search-no-results">No products found matching "${escape(searchTerm)}".</div>`;
      return;
    }

    let html = `<h3>Found ${products.length} product(s) matching "${escape(searchTerm)}":</h3>`;
    
    products.forEach(product => {
      html += `
        <div class="search-result-item">
          <h3>${escape(product.brand)} - ${escape(product.product_name)}</h3>
          <div class="product-details">
            <div><strong>Category:</strong> ${escape(product.category || 'N/A')}</div>
            <div><strong>Price:</strong> $${Number(product.price_usd || 0).toFixed(2)}</div>
            <div><strong>Rating:</strong> ${Number(product.rating || 0).toFixed(1)}/5</div>
            <div><strong>ID:</strong> ${escape(product._id)}</div>
          </div>
        </div>
      `;
    });

    $searchResults.innerHTML = html;
  }

  // Events  
  if ($form) {
    $form.addEventListener('submit', async e => {
      e.preventDefault();
      console.log('Form submitted');
      
      try {
        const doc = getFormData();
        console.log('Form data:', doc);
        
        const result = await createOrUpdate(doc);
        console.log('Save result:', result);
        
        const saved = await localDB.get(result.id);
        console.log('Verified saved document:', saved);
        
        $form.reset();
        $form.brand.focus();
        
        await render();
        console.log('Product saved successfully - table refreshed');
        
      } catch (error) {
        console.error('Error saving product:', error);
        alert('Error saving product: ' + error.message);
      }
    });
    console.log('Form event listener attached successfully');
  } else {
    console.error('Form element not found!');
  }

  if ($reset) {
    $reset.addEventListener('click', () => {
      console.log('Reset button clicked');
      resetForm();
    });
  }
  
  if ($reload) {
    $reload.addEventListener('click', () => {
      console.log('Reload button clicked');
      render();
    });
  }

  if ($searchBtn) {
    $searchBtn.addEventListener('click', () => {
      const searchTerm = $searchInput.value;
      console.log('Searching for:', searchTerm);
      searchProducts(searchTerm);
    });
  }

  if ($searchInput) {
    $searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const searchTerm = $searchInput.value;
        console.log('Searching for (Enter key):', searchTerm);
        searchProducts(searchTerm);
      }
    });
  }

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
  render(); 

})();