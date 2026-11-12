/* =========================
   PRODUCTS
========================= */
async function fetchProducts() {
    try {
        const products = await UI.fetchJson(`${apiBase}/api/Products/get-products`);
        renderProductGrid(products || []);
        await fetchArchivedProducts();
    } catch (error) {
        console.error('Products Error:', error);
        showProductGridMessage('Unable to load products.', error.message, true);
    }
}

// Fills the product grid with a message, e.g. when it is empty or failed to load.
function showProductGridMessage(title, message, canRetry = false) {
    const grid = document.getElementById('productGrid');
    if (!grid) return;

    const box = UI.el('div', 'product-grid-message');
    box.appendChild(UI.icon(canRetry ? 'fa-triangle-exclamation' : 'fa-shirt'));
    box.appendChild(UI.el('p', 'product-grid-message-title', title));
    if (message) box.appendChild(UI.el('p', null, message));
    if (canRetry) {
        const retry = UI.el('button', 'btn btn-secondary btn-sm');
        retry.type = 'button';
        retry.append(UI.icon('fa-rotate-right'), 'Try again');
        retry.addEventListener('click', () => {
            UI.cardSkeletons(grid, { count: 8, cardClass: 'product-card', mediaHeight: '200px', lines: 4 });
            fetchProducts();
        });
        box.appendChild(retry);
    }
    UI.doneLoading(grid);
    grid.replaceChildren(box);
}

/* =========================
   ARCHIVE PRODUCT
========================= */
// Archives one size or color.
async function archiveProduct(id) {
    const product = productsById.get(id);
    const productName = product ? UI.variantName(product.product_name, product.size, product.color) : 'this product';

    showDialog(
        'Archive Product',
        `Are you sure you want to archive "${productName}"? It will be hidden from inventory and the POS until restored.`,
        async () => {
            try {
                const response = await fetch(`${apiBase}/api/Products/archive-product/${id}`, {
                    method: 'POST'
                });

                if (response.ok) {
                    // Refreshed first, so the dialog returns focus to the updated Manage window.
                    await fetchProducts();
                    showDialog('Product Archived', `"${productName}" has been archived.`);
                } else {
                    const errorData = await response.json().catch(() => ({}));
                    showDialog('Archive Failed', errorData.message || 'Failed to archive product.');
                }
            } catch (error) {
                console.error('Archive Product Error:', error);
                showDialog('Connection Error', 'Cannot connect to the server.');
            }
        },
        null,
        { confirmText: 'Archive', danger: true }
    );
}

// Archives every size and color of a product in one request (archive-group), which writes one
// activity log entry for the whole product.
function archiveWholeProduct(variants) {
    if (variants.length === 1) {
        archiveProduct(variants[0].id);
        return;
    }

    const productName = variants[0].product_name;
    showDialog(
        'Archive Product',
        `Archive "${productName}" and all ${variants.length} of its sizes and colors? They will be hidden from inventory and the POS until restored.`,
        async () => {
            try {
                await UI.fetchJson(`${apiBase}/api/Products/archive-group/${variants[0].id}`, { method: 'POST' });
                await fetchProducts();
                showDialog('Product Archived', `"${productName}" has been archived.`);
            } catch (error) {
                console.error('Archive Product Error:', error);
                showDialog('Archive Failed', error.message || 'Unable to archive the product.');
            }
        },
        null,
        { confirmText: 'Archive', danger: true }
    );
}

async function fetchArchivedProducts() {
    const grid = document.getElementById('archivedProductGrid');
    if (!grid) return;
    if (localStorage.getItem('userRole')?.toLowerCase() !== 'owner') {
        document.getElementById('archivedProductsSection')?.remove();
        return;
    }

    try {
        const response = await fetch(`${apiBase}/api/Products/get-archived-products`);
        if (!response.ok) throw new Error(`Archived products request failed (${response.status})`);

        const products = await response.json();
        grid.replaceChildren();
        if (products.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'archived-products-empty';
            empty.textContent = 'No archived products.';
            grid.appendChild(empty);
            return;
        }

        products.forEach(product => {
            const card = document.createElement('article');
            card.className = 'archived-product-card';

            const image = document.createElement('img');
            image.src = product.image_url || '';
            image.alt = product.product_name;

            const info = document.createElement('div');
            info.className = 'archived-product-info';
            const name = document.createElement('strong');
            name.textContent = product.product_name;
            const description = document.createElement('span');
            // The size and color tell apart archived rows of the same product.
            description.textContent =
                `${product.category} · ${UI.variantLabel(product.size, product.color)} · ₱${Number(product.price).toLocaleString('en-PH')}`;
            info.append(name, description);

            const restoreButton = document.createElement('button');
            restoreButton.type = 'button';
            restoreButton.className = 'btn btn-secondary btn-sm';
            restoreButton.textContent = 'Restore';
            restoreButton.setAttribute('aria-label', `Restore ${product.product_name}`);
            restoreButton.addEventListener('click', () => restoreProduct(product.id, product.product_name));

            card.append(image, info, restoreButton);
            grid.appendChild(card);
        });
    } catch (error) {
        console.error('Archived Products Error:', error);
        const message = document.createElement('p');
        message.className = 'archived-products-empty';
        message.textContent = 'Unable to load archived products. Restart the API if you just added archive support, then refresh.';
        grid.replaceChildren(message);
    }
}

async function restoreProduct(id, productName) {
    showDialog(
        'Restore Product',
        `Restore "${productName}" to active products and POS?`,
        async () => {
            try {
                const response = await fetch(`${apiBase}/api/Products/restore-product/${id}`, { method: 'POST' });
                if (!response.ok) {
                    const error = await response.json().catch(() => ({}));
                    throw new Error(error.message || `Restore failed (${response.status})`);
                }

                await fetchProducts();
                showDialog('Product Restored', `"${productName}" is active again.`);
            } catch (error) {
                console.error('Restore Product Error:', error);
                showDialog('Restore Failed', error.message || 'Unable to restore product.');
            }
        },
        null,
        { confirmText: 'Restore' }
    );
}

/* =========================
   PRODUCT MANAGEMENT
   Each size and color is its own row in the products table. The grid shows one card per
   product (name and category, the same grouping as the POS), with its sizes and colors in
   the Manage window.
========================= */
const productsById = new Map();
// Each product's sizes and colors, by groupKeyOf, in the order the API lists the products.
let productGroups = new Map();
let activeCategory = 'All';

// The API saves this path when no photo was chosen. Products added before sizes could share a
// photo may have it on some sizes, so it never takes the place of a real photo on the card.
const DEFAULT_PRODUCT_IMAGE = '/images/default-product.png';

const groupKeyOf = product => JSON.stringify([product.product_name, product.category]);

// By color, then from the smallest size to the largest.
function compareVariants(a, b) {
    return (a.color || '').localeCompare(b.color || '') || UI.compareSizes(a.size || '', b.size || '');
}

function groupProducts(products) {
    const groups = new Map();
    products.forEach(product => {
        const key = groupKeyOf(product);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(product);
    });
    groups.forEach(variants => variants.sort(compareVariants));
    return groups;
}

function countLabel(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// "4 sizes · 2 colors · 23 in stock", or "... · Out of stock" when none is left.
function productSummary(variants) {
    const distinct = values => new Set(values.map(value => value?.trim().toLowerCase()).filter(Boolean)).size;
    const sizes = distinct(variants.map(variant => variant.size));
    const colors = distinct(variants.map(variant => variant.color));
    const stock = variants.reduce((total, variant) => total + Math.max(0, variant.stock_quantity), 0);

    const parts = [sizes ? countLabel(sizes, 'size') : 'One size'];
    if (colors) parts.push(countLabel(colors, 'color'));
    parts.push(stock > 0 ? `${stock.toLocaleString('en-PH')} in stock` : 'Out of stock');
    return { text: parts.join(' · '), isOut: stock === 0 };
}

// One price, or the range when the sizes and colors are priced differently.
function priceLabel(variants) {
    const prices = variants.map(variant => Number(variant.price));
    const lowest = Math.min(...prices);
    const highest = Math.max(...prices);
    const peso = amount => `₱${amount.toLocaleString()}`;
    return lowest === highest ? peso(lowest) : `${peso(lowest)}–${peso(highest)}`;
}

function productPhoto(variants) {
    const photos = variants.map(variant => variant.image_url).filter(Boolean);
    return photos.find(url => url !== DEFAULT_PRODUCT_IMAGE) || photos[0] || '';
}

// Fills in a copy of the card in products.html for one product and all of its sizes and colors.
function productCard(variants, isOwner) {
    const product = variants[0];
    const template = document.getElementById('productCardTemplate');
    const card = template.content.firstElementChild.cloneNode(true);
    const field = name => card.querySelector(`[data-field="${name}"]`);
    card.dataset.category = product.category;
    // The card doesn't list sizes and colors, so search still finds them here.
    card.dataset.search = [product.product_name, product.category, ...variants.flatMap(variant => [variant.size, variant.color])]
        .filter(Boolean).join(' ').toLowerCase();

    const photo = productPhoto(variants);
    if (photo) {
        const placeholder = field('image');
        const noImageText = placeholder.textContent;
        const image = UI.el('img');
        image.src = photo;
        image.alt = product.product_name;
        image.addEventListener('error', () => { placeholder.textContent = noImageText; });
        placeholder.replaceChildren(image);
    }

    field('category').textContent = product.category;
    field('price').textContent = priceLabel(variants);
    field('name').textContent = product.product_name;
    const summary = productSummary(variants);
    field('summary').textContent = summary.text;
    field('summary').classList.toggle('is-out', summary.isOut);

    const actions = field('actions');
    if (isOwner) {
        actions.querySelectorAll('.visually-hidden').forEach(name => {
            name.textContent = ` ${product.product_name}`;
        });
        actions.querySelector('[data-action="manage"]').addEventListener('click', () => openManageModal(groupKeyOf(product)));
        actions.querySelector('[data-action="archive"]').addEventListener('click', () => archiveWholeProduct(variants));
    } else {
        actions.remove();
    }

    return card;
}

function renderProductGrid(products) {
    const grid = document.getElementById('productGrid');
    const isOwner = localStorage.getItem('userRole')?.toLowerCase() === 'owner';

    if (!grid) return;
    UI.doneLoading(grid);
    grid.replaceChildren();
    productsById.clear();
    products.forEach(product => productsById.set(product.id, product));
    productGroups = groupProducts(products);

    if (products.length) {
        productGroups.forEach(variants => grid.appendChild(productCard(variants, isOwner)));
        applyProductFilters();
    } else {
        showProductGridMessage('No products yet', isOwner ? 'Use Add Product to create the first one.' : '');
    }

    refreshVariantSelects();
    refreshManageModal();
}

/* =========================
   MANAGE (one product's sizes and colors)
========================= */
let managedKey = null;

function openManageModal(key) {
    managedKey = key;
    renderManageModal();
    openModalElement(document.getElementById('productManageModal'), closeManageModal);
}

function closeManageModal() {
    managedKey = null;
    closeModalElement(document.getElementById('productManageModal'));
}

// Redraws an open Manage window from the latest products, or closes it when the product is
// gone (every size and color archived, or renamed).
function refreshManageModal() {
    if (!managedKey || document.getElementById('productManageModal').hidden) return;
    if (productGroups.has(managedKey)) renderManageModal({ fade: false });
    else closeManageModal();
}

function renderManageModal({ fade = true } = {}) {
    const variants = productGroups.get(managedKey) || [];
    const product = variants[0];
    if (!product) return;

    document.getElementById('manageProductTitle').textContent = product.product_name;
    document.getElementById('manageProductSummary').textContent =
        `${product.category} · ${priceLabel(variants)} · ${productSummary(variants).text}`;

    // The rows are rebuilt, so focus goes back to the same button, or to Add size or color when
    // its row is gone (an archived size).
    const rows = document.getElementById('manageVariantRows');
    const focused = rows.contains(document.activeElement) ? document.activeElement : null;
    UI.fillTable(rows, variants.map(variantRow), { fade });
    if (focused) {
        const again = rows.querySelector(`[data-variant-id="${focused.dataset.variantId}"][data-action="${focused.dataset.action}"]`);
        (again || document.getElementById('manageAddVariant')).focus();
    }
}

function variantRow(variant) {
    const name = UI.variantName(variant.product_name, variant.size, variant.color);
    const actions = UI.el('div', 'manage-row-actions');
    actions.append(
        variantButton(variant, 'edit', 'Edit', 'btn-secondary', `Edit ${name}`, () => openEditProductModal(variant.id)),
        variantButton(variant, 'archive', 'Archive', 'btn-danger-outline', `Archive ${name}`, () => archiveProduct(variant.id))
    );

    const row = UI.el('tr');
    row.append(
        UI.cell(variant.size?.trim() || 'One Size'),
        UI.cell(variant.color?.trim() || 'Default'),
        UI.cell(UI.formatPeso(variant.price), 'col-muted'),
        UI.cell(String(variant.stock_quantity)),
        UI.cell(UI.stockBadge(variant.stock_status)),
        UI.cell(actions, 'col-action')
    );
    return row;
}

function variantButton(variant, action, text, tone, label, onClick) {
    const button = UI.el('button', `btn ${tone} btn-sm`, text);
    button.type = 'button';
    button.dataset.variantId = variant.id;
    button.dataset.action = action;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', onClick);
    return button;
}

/* =========================
   SIZE & COLOR DROPDOWNS
   Each list starts with a blank choice (saved empty, shown elsewhere as
   "One Size" / "Default"), then common values and every value products
   already use, then "Other…", which shows a text box for a new value.
========================= */
const STANDARD_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
const STANDARD_COLORS = ['Black', 'White', 'Gray', 'Navy', 'Blue', 'Red', 'Green', 'Brown', 'Beige', 'Cream', 'Maroon', 'Pink', 'Yellow', 'Orange', 'Purple', 'Olive'];
const OTHER_CHOICE = '__other__';

function variantChoices(kind) {
    const standard = kind === 'size' ? STANDARD_SIZES : STANDARD_COLORS;
    const inUse = [...productsById.values()]
        .map(product => (kind === 'size' ? product.size : product.color)?.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));

    // One entry per value, ignoring case; the standard spelling wins.
    const seen = new Set();
    const choices = [...standard, ...inUse].filter(value => {
        const key = value.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    return kind === 'size' ? choices.sort(UI.compareSizes) : choices;
}

function otherInput(select) {
    return document.getElementById(`${select.id}Other`);
}

// The text box is shown, and required, only while "Other…" is chosen.
function syncOtherInput(select, { focus = false } = {}) {
    const input = otherInput(select);
    const isOther = select.value === OTHER_CHOICE;
    input.hidden = !isOther;
    input.required = isOther;
    if (focus && isOther) input.focus();
}

// Selects a product's size or color. A value missing from the list (older data) is added to it.
function setVariantValue(select, value) {
    const text = (value || '').trim();
    const match = [...select.options].find(option =>
        option.value !== OTHER_CHOICE && option.value.toLowerCase() === text.toLowerCase());
    if (!match) select.insertBefore(new Option(text, text), select.lastElementChild);
    select.value = match ? match.value : text;
    otherInput(select).value = '';
    syncOtherInput(select);
}

// Rebuilds a list from the current products, keeping what is chosen (or typed under "Other…").
function fillVariantSelect(select) {
    const kind = select.dataset.variant;
    const current = select.value;
    select.replaceChildren(
        new Option(kind === 'size' ? 'One Size' : 'No specific color', ''),
        ...variantChoices(kind).map(value => new Option(value, value)),
        new Option(kind === 'size' ? 'Other size…' : 'Other color…', OTHER_CHOICE)
    );

    if (current === OTHER_CHOICE) {
        select.value = OTHER_CHOICE;
        syncOtherInput(select);
    } else {
        setVariantValue(select, current);
    }
}

function refreshVariantSelects() {
    document.querySelectorAll('select[data-variant]').forEach(fillVariantSelect);
}

// The size or color to save: the chosen value, or the text typed under "Other…".
function readVariant(id) {
    const select = document.getElementById(id);
    return select.value === OTHER_CHOICE ? otherInput(select).value.trim() : select.value;
}

// Closing a product form with unsaved typing asks before throwing it away.
function markFormClean(form) {
    if (form) form.dataset.dirty = '';
}

function confirmDiscardChanges(form, onDiscard) {
    if (form?.dataset.dirty !== 'true') {
        onDiscard();
        return;
    }

    showDialog(
        'Discard Changes?',
        'You have unsaved changes in this form. Close it and discard them?',
        onDiscard,
        null,
        { confirmText: 'Discard', danger: true }
    );
}

// Up to 5 whole-number digits and 2 decimal places, the same limit as the API (₱99,999.99).
function checkPrice(text) {
    if (/^\d{1,5}(?:\.\d{0,2})?$/.test(text)) return true;
    showDialog('Invalid Price', 'Enter a price with up to 5 whole-number digits and 2 decimal places.');
    return false;
}

// A size and color the product already has would be a second row for the same item.
function findExistingVariant(name, category, size, color) {
    const same = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
    return [...productsById.values()].find(product =>
        same(product.product_name, name) && same(product.category, category)
        && same(product.size, size) && same(product.color, color));
}

/* =========================
   ADD PRODUCT
   A new product with its sizes and colors, or ("Add size or color" in the Manage window)
   more sizes and colors of one that exists.
========================= */
// The product (all of its rows) the form adds sizes and colors to, or null for a new product.
let addingTo = null;
let variantRowCount = 0;

function openAddModal(variants = null) {
    const form = document.getElementById('productForm');
    form.reset();
    addingTo = variants;

    // Adding to a product keeps its name, category, price and photo, so those fields are left out.
    const details = document.getElementById('productDetailsFields');
    details.disabled = Boolean(variants);
    details.hidden = Boolean(variants);
    const target = document.getElementById('addVariantTarget');
    target.hidden = !variants;
    if (variants) {
        const product = variants[0];
        target.textContent = `Adds to ${product.product_name} (${product.category}, ${priceLabel(variants)}) and uses its photo.`;
    }
    document.getElementById('addProductTitle').textContent = variants ? 'Add Size or Color' : 'Add New Product';
    document.getElementById('addProductSubmit').textContent = variants ? 'Add' : 'Save Product';

    document.getElementById('variantRows').replaceChildren();
    addVariantRow();
    markFormClean(form);
    openModalElement(document.getElementById('addProductModal'), () => closeAddModal());
    if (variants) document.querySelector('#variantRows select')?.focus();
}

function closeAddModal(force = false) {
    const form = document.getElementById('productForm');
    const close = () => {
        closeModalElement(document.getElementById('addProductModal'));
        form?.reset();
        markFormClean(form);
        addingTo = null;
    };

    if (force) close();
    else confirmDiscardChanges(form, close);
}

// Adds a size-and-color row from the template. Each row gets ids of its own, so its labels work
// and syncOtherInput finds its "Other…" text boxes (`${select.id}Other`).
function addVariantRow({ focus = false } = {}) {
    const number = ++variantRowCount;
    const row = document.getElementById('variantRowTemplate').content.firstElementChild.cloneNode(true);
    const field = name => row.querySelector(`[data-field="${name}"]`);
    ['size', 'color', 'stock'].forEach(name => {
        const control = field(name);
        control.id = `variant${name[0].toUpperCase()}${name.slice(1)}${number}`;
        field(`${name}Label`).htmlFor = control.id;
        if (name !== 'stock') field(`${name}Other`).id = `${control.id}Other`;
    });

    row.querySelector('[data-action="remove-row"]').addEventListener('click', () => removeVariantRow(row));
    document.getElementById('variantRows').appendChild(row);
    ['size', 'color'].forEach(name => {
        const select = field(name);
        fillVariantSelect(select);
        select.addEventListener('change', () => syncOtherInput(select, { focus: true }));
    });
    numberVariantRows();
    if (focus) field('size').focus();
}

function removeVariantRow(row) {
    const rows = [...document.querySelectorAll('#variantRows .variant-row')];
    const index = rows.indexOf(row);
    const next = rows[index + 1] || rows[index - 1];
    row.remove();
    numberVariantRows();
    document.getElementById('productForm').dataset.dirty = 'true';
    (next?.querySelector('select') || document.getElementById('addVariantRow')).focus();
}

// "Size and color 1", "Size and color 2", ... The only row can't be removed.
function numberVariantRows() {
    const rows = [...document.querySelectorAll('#variantRows .variant-row')];
    rows.forEach((row, index) => {
        const title = `Size and color ${index + 1}`;
        row.querySelector('[data-field="title"]').textContent = title;
        const remove = row.querySelector('[data-action="remove-row"]');
        remove.hidden = rows.length === 1;
        remove.setAttribute('aria-label', `Remove ${title.toLowerCase()}`);
    });
}

function readVariantRows() {
    return [...document.querySelectorAll('#variantRows .variant-row')].map(row => ({
        size: readVariant(row.querySelector('[data-field="size"]').id),
        color: readVariant(row.querySelector('[data-field="color"]').id),
        stock: row.querySelector('[data-field="stock"]').value
    }));
}

// The first size and color that is in more than one row, or null.
function findRepeatedRow(rows) {
    const seen = new Set();
    return rows.find(row => {
        const key = JSON.stringify([row.size.trim().toLowerCase(), row.color.trim().toLowerCase()]);
        if (seen.has(key)) return true;
        seen.add(key);
        return false;
    }) || null;
}

function saveProduct(event) {
    event.preventDefault();
    const product = addingTo?.[0];
    const name = product ? product.product_name : document.getElementById('prodName').value.trim();
    const category = product ? product.category : document.getElementById('prodCategory').value;
    const priceText = product ? String(product.price) : document.getElementById('prodPrice').value.trim();
    if (!product && !checkPrice(priceText)) return;

    const rows = readVariantRows();
    const repeated = findRepeatedRow(rows);
    if (repeated) {
        showDialog('Listed Twice', `${UI.variantLabel(repeated.size, repeated.color)} is in more than one row. Remove one of them.`);
        return;
    }
    const existing = rows.find(row => findExistingVariant(name, category, row.size, row.color));
    if (existing) {
        showDialog('Already Added',
            `"${UI.variantName(name, existing.size, existing.color)}" is already a product. Change its stock from Manage instead.`);
        return;
    }

    const labels = rows.map(row => UI.variantLabel(row.size, row.color)).join(', ');
    const variants = addingTo;
    showDialog(
        product ? 'Add Size or Color' : 'Add Product',
        product
            ? `Add ${labels} to "${name}"? ${rows.length === 1 ? 'It' : 'They'} will show up in inventory and the POS.`
            : `Add "${name}" (${labels}) to the product list? It will show up in inventory and the POS.`,
        () => submitNewProduct({ name, category, priceText, rows, variants }),
        null,
        { confirmText: product ? 'Add' : 'Add Product' }
    );
}

async function submitNewProduct({ name, category, priceText, rows, variants }) {
    const formData = new FormData();
    formData.append('ProductName', name);
    formData.append('Category', category);
    formData.append('Price', priceText);
    if (variants) {
        // The new sizes and colors get the photo the product's card shows.
        const photo = productPhoto(variants);
        formData.append('PhotoFromId', (variants.find(variant => variant.image_url === photo) || variants[0]).id);
    } else {
        const imageFile = document.getElementById('prodImage').files[0];
        if (imageFile) formData.append('ImageFile', imageFile);
    }
    rows.forEach((row, index) => {
        formData.append(`Variants[${index}].Size`, row.size);
        formData.append(`Variants[${index}].Color`, row.color);
        formData.append(`Variants[${index}].StockQuantity`, row.stock);
    });

    try {
        await UI.fetchJson(`${apiBase}/api/Products/add-variants`, { method: 'POST', body: formData });
        closeAddModal(true);
        showToast(variants
            ? (rows.length === 1 ? 'Size or color added.' : `${rows.length} sizes and colors added.`)
            : `"${name}" added to the product list.`, false);
        await fetchProducts();
    } catch (error) {
        console.error('Add Product Error:', error);
        showDialog('Could Not Save', error.message || 'Unable to save the product.');
    }
}

/* =========================
   EDIT ONE SIZE OR COLOR
   Its size, color and stock. The name, category, price and photo are shared, so they are
   changed with Edit details instead.
========================= */
function openEditProductModal(id) {
    const product = productsById.get(id);
    if (!product) {
        showDialog('Product Unavailable', 'Refresh the product list and try again.');
        return;
    }

    document.getElementById('editProdId').value = product.id;
    document.getElementById('editProductTitle').textContent =
        `Edit ${UI.variantName(product.product_name, product.size, product.color)}`;
    document.getElementById('editProdStock').value = product.stock_quantity;
    refreshVariantSelects();
    setVariantValue(document.getElementById('editProdSize'), product.size);
    setVariantValue(document.getElementById('editProdColor'), product.color);
    markFormClean(document.getElementById('editProductForm'));
    openModalElement(document.getElementById('editProductModal'), () => closeEditProductModal());
}

function closeEditProductModal(force = false) {
    const form = document.getElementById('editProductForm');
    const close = () => {
        closeModalElement(document.getElementById('editProductModal'));
        markFormClean(form);
    };

    if (force) close();
    else confirmDiscardChanges(form, close);
}

function saveProductEdit(event) {
    event.preventDefault();
    const product = productsById.get(Number(document.getElementById('editProdId').value));
    if (!product) {
        showDialog('Product Unavailable', 'Refresh the product list and try again.');
        return;
    }

    const size = readVariant('editProdSize');
    const color = readVariant('editProdColor');
    const label = UI.variantName(product.product_name, size, color);
    const existing = findExistingVariant(product.product_name, product.category, size, color);
    if (existing && existing.id !== product.id) {
        showDialog('Already Added', `"${label}" already exists. Change that one's stock instead.`);
        return;
    }

    const stock = document.getElementById('editProdStock').value;
    showDialog(
        'Save Changes',
        `Save your changes to "${label}"?`,
        () => submitProductEdit(product, size, color, stock),
        null,
        { confirmText: 'Save Changes' }
    );
}

async function submitProductEdit(product, size, color, stock) {
    // The shared details go back unchanged, so one size can't end up with its own price.
    const formData = new FormData();
    formData.append('ProductName', product.product_name);
    formData.append('Category', product.category);
    formData.append('Price', String(product.price));
    formData.append('StockQuantity', stock);
    formData.append('Size', size);
    formData.append('Color', color);

    try {
        const response = await fetch(`${apiBase}/api/Products/update-product/${product.id}`, {
            method: 'PUT',
            body: formData
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            const validationMessages = error.errors
                ? Object.values(error.errors).flat().join(' ')
                : '';
            throw new Error(validationMessages || error.message || error.title || `Product update failed (${response.status})`);
        }

        closeEditProductModal(true);
        await fetchProducts();
        showDialog('Product Updated', `"${UI.variantName(product.product_name, size, color)}" was saved.`);
    } catch (error) {
        console.error('Update Product Error:', error);
        showDialog('Update Failed', error.message || 'Unable to update product.');
    }
}

/* =========================
   EDIT DETAILS
   What every size and color of the product in the Manage window shares: its name, category,
   price and photo.
========================= */
function openEditDetailsModal() {
    const variants = productGroups.get(managedKey);
    if (!variants) return;
    const product = variants[0];

    document.getElementById('detailsName').value = product.product_name;
    const categorySelect = document.getElementById('detailsCategory');
    if (![...categorySelect.options].some(option => option.value === product.category)) {
        categorySelect.add(new Option(product.category, product.category));
    }
    categorySelect.value = product.category;
    document.getElementById('detailsPrice').value = product.price;
    const pricesDiffer = new Set(variants.map(variant => Number(variant.price))).size > 1;
    document.getElementById('editDetailsNote').textContent = pricesDiffer
        ? 'Changes apply to every size and color of this product. Its sizes have different prices now; saving gives them all this one.'
        : 'Changes apply to every size and color of this product.';

    const photo = productPhoto(variants);
    const preview = document.getElementById('detailsImagePreview');
    preview.onerror = () => { preview.hidden = true; };
    preview.src = photo;
    preview.hidden = !photo;
    const imageInput = document.getElementById('detailsImage');
    imageInput.value = '';
    imageInput.dispatchEvent(new Event('change'));

    markFormClean(document.getElementById('editDetailsForm'));
    openModalElement(document.getElementById('editDetailsModal'), () => closeEditDetailsModal());
}

function closeEditDetailsModal(force = false) {
    const form = document.getElementById('editDetailsForm');
    const close = () => {
        closeModalElement(document.getElementById('editDetailsModal'));
        markFormClean(form);
    };

    if (force) close();
    else confirmDiscardChanges(form, close);
}

function saveDetails(event) {
    event.preventDefault();
    const priceText = document.getElementById('detailsPrice').value.trim();
    if (!checkPrice(priceText)) return;

    const variants = productGroups.get(managedKey);
    if (!variants) {
        showDialog('Product Unavailable', 'Refresh the product list and try again.');
        return;
    }

    const name = document.getElementById('detailsName').value.trim();
    const scope = variants.length === 1 ? '' : ` They apply to all ${variants.length} of its sizes and colors.`;
    showDialog(
        'Save Changes',
        `Save these details for "${name}"?${scope}`,
        () => submitDetails(variants[0].id, priceText),
        null,
        { confirmText: 'Save Changes' }
    );
}

async function submitDetails(id, priceText) {
    const formData = new FormData();
    formData.append('ProductName', document.getElementById('detailsName').value.trim());
    formData.append('Category', document.getElementById('detailsCategory').value);
    formData.append('Price', priceText);
    const imageFile = document.getElementById('detailsImage').files[0];
    if (imageFile) formData.append('ImageFile', imageFile);

    try {
        const result = await UI.fetchJson(`${apiBase}/api/Products/update-details/${id}`, { method: 'PUT', body: formData });
        // A new name or category is a new key; the Manage window follows the product to it.
        managedKey = groupKeyOf({ product_name: result.productName, category: result.category });
        closeEditDetailsModal(true);
        await fetchProducts();
        showDialog('Product Updated', `"${result.productName}" was saved.`);
    } catch (error) {
        console.error('Update Details Error:', error);
        showDialog('Update Failed', error.message || 'Unable to save the product details.');
    }
}

// Search and the category buttons filter together.
function applyProductFilters() {
    const query = document.getElementById('productSearch')?.value.trim().toLowerCase() || '';
    document.querySelectorAll('.product-card').forEach(card => {
        const matchesCategory = activeCategory === 'All' || card.dataset.category === activeCategory;
        const matchesSearch = (card.dataset.search || '').includes(query);
        card.hidden = !(matchesCategory && matchesSearch);
    });
}

function filterByCategory(category, button) {
    activeCategory = category;
    document.querySelectorAll('.tab-btn').forEach(btn => {
        const isActive = btn === button;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
    });
    applyProductFilters();
}

/* =========================
   PAGE LOAD
========================= */
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('productSearch')?.addEventListener('input', applyProductFilters);
    document.getElementById('addNewProductBtn')?.addEventListener('click', () => openAddModal());
    document.getElementById('refreshArchivedBtn')?.addEventListener('click', () => fetchArchivedProducts());
    document.getElementById('productForm')?.addEventListener('submit', saveProduct);
    document.getElementById('editProductForm')?.addEventListener('submit', saveProductEdit);
    document.getElementById('editDetailsForm')?.addEventListener('submit', saveDetails);
    document.getElementById('addVariantRow')?.addEventListener('click', () => {
        addVariantRow({ focus: true });
        document.getElementById('productForm').dataset.dirty = 'true';
    });

    document.querySelectorAll('.tab-btn').forEach(button =>
        button.addEventListener('click', () => filterByCategory(button.dataset.category, button)));
    document.querySelectorAll('#addProductModal [data-close-modal]').forEach(button =>
        button.addEventListener('click', () => closeAddModal()));
    document.querySelectorAll('#editProductModal [data-close-modal]').forEach(button =>
        button.addEventListener('click', () => closeEditProductModal()));
    document.querySelectorAll('#editDetailsModal [data-close-modal]').forEach(button =>
        button.addEventListener('click', () => closeEditDetailsModal()));
    document.querySelectorAll('#productManageModal [data-close-manage]').forEach(button =>
        button.addEventListener('click', closeManageModal));
    document.getElementById('manageEditDetails').addEventListener('click', openEditDetailsModal);
    document.getElementById('manageAddVariant').addEventListener('click', () => {
        const variants = productGroups.get(managedKey);
        if (variants) openAddModal(variants);
    });

    ['prodPrice', 'detailsPrice'].forEach(id => {
        const input = document.getElementById(id);
        input?.addEventListener('input', () => limitAmountInput(input));
    });

    // Shows a newly chosen photo in place of the current one.
    document.getElementById('detailsImage')?.addEventListener('change', event => {
        const input = event.currentTarget;
        const preview = document.getElementById('detailsImagePreview');
        const imageFile = input.files[0];
        if (!imageFile) return;

        preview.src = URL.createObjectURL(imageFile);
        preview.hidden = false;
    });

    ['productForm', 'editProductForm', 'editDetailsForm'].forEach(id => {
        const form = document.getElementById(id);
        ['input', 'change'].forEach(type => form?.addEventListener(type, () => {
            form.dataset.dirty = 'true';
        }));
        // reset() puts the dropdowns back on their first choice; hide any "Other…" text box too.
        form?.addEventListener('reset', () => setTimeout(() =>
            form.querySelectorAll('select[data-variant]').forEach(select => syncOtherInput(select))));
    });

    refreshVariantSelects();
    document.querySelectorAll('select[data-variant]').forEach(select =>
        select.addEventListener('change', () => syncOtherInput(select, { focus: true })));

    const role = localStorage.getItem('userRole');
    const isOwner = role?.toLowerCase() === 'owner';
    const archivedProductsSection = document.getElementById('archivedProductsSection');
    if (archivedProductsSection) archivedProductsSection.hidden = !isOwner;

    const addProductBtn = document.getElementById('addNewProductBtn');
    if (addProductBtn && role && !isOwner) addProductBtn.hidden = true;

    const grid = document.getElementById('productGrid');
    if (grid) UI.cardSkeletons(grid, { count: 8, cardClass: 'product-card', mediaHeight: '200px', lines: 4 });
    fetchProducts();
    // 'forecast' too, because new low-stock thresholds change which items show as low.
    Live.on(['products', 'exchanges', 'forecast'], fetchProducts);
});
