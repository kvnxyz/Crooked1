/* =========================
   AUDIT LOGS
   A read-only record of sales: search, filters, pages of 10,
   Excel export and a details view. Exchanges are made on the
   Exchanges page.
========================= */
const PAGE_SIZE = 10;
const COLUMN_COUNT = 6;

const filters = { search: '', status: '', payment: '', from: '', to: '' };
let currentPage = 1;
let totalTransactions = 0;
let latestRequest = 0;
let focusPagerAfterLoad = false;

const transactionBody = document.getElementById('transactionTableBody');
const transactionSummary = document.getElementById('transactionSummary');
const transactionPager = document.getElementById('transactionPagination');
const searchInput = document.getElementById('transactionSearch');
const statusFilter = document.getElementById('statusFilter');
const paymentFilter = document.getElementById('paymentFilter');
const fromDate = document.getElementById('fromDate');
const toDate = document.getElementById('toDate');
const clearFiltersButton = document.getElementById('clearFilters');

function filterParams(extra = {}) {
    const params = new URLSearchParams();
    Object.entries({ ...filters, ...extra }).forEach(([key, value]) => {
        if (value !== '' && value !== null && value !== undefined) params.set(key, value);
    });
    return params;
}

function hasActiveFilters() {
    return Object.values(filters).some(Boolean);
}

/* =========================
   LIST
========================= */
// quiet: a live refresh keeps the current rows on screen until the new ones arrive.
async function loadTransactions(page = currentPage, { quiet = false } = {}) {
    const request = ++latestRequest;
    if (!quiet) {
        UI.tableSkeleton(transactionBody, COLUMN_COUNT, PAGE_SIZE);
        transactionSummary.textContent = 'Loading transactions...';
    }

    try {
        const data = await UI.fetchJson(`${apiBase}/api/POS/Transaction/search?${filterParams({ page, pageSize: PAGE_SIZE })}`);
        // A newer search or page request replaced this one while it was loading.
        if (request !== latestRequest) return;

        currentPage = data.page;
        totalTransactions = data.totalItems;
        renderTransactions(data.items, { fade: !quiet });
        transactionSummary.textContent = hasActiveFilters()
            ? `${data.totalItems.toLocaleString('en-PH')} transaction${data.totalItems === 1 ? '' : 's'} match your search and filters.`
            : `${data.totalItems.toLocaleString('en-PH')} transaction${data.totalItems === 1 ? '' : 's'} in total.`;
        UI.pagination(transactionPager, {
            page: data.page,
            totalPages: data.totalPages,
            totalItems: data.totalItems,
            pageSize: data.pageSize,
            itemLabel: 'transactions',
            onChange: goToPage
        });

        if (focusPagerAfterLoad) {
            transactionPager.querySelector('[aria-current="page"]')?.focus();
            focusPagerAfterLoad = false;
        }
    } catch (error) {
        if (request !== latestRequest) return;
        console.error('Transaction Error:', error);
        totalTransactions = 0;
        transactionPager.replaceChildren();
        transactionSummary.textContent = 'Transactions could not be loaded.';
        UI.tableMessage(transactionBody, COLUMN_COUNT, {
            isError: true,
            title: 'Unable to load transactions',
            message: error.message,
            actionLabel: 'Try again',
            onAction: () => loadTransactions(currentPage)
        });
    }
}

function goToPage(page) {
    focusPagerAfterLoad = true;
    loadTransactions(page);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('view-transactions').scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
}

function paymentLabel(method) {
    const label = UI.el('span', 'payment-method');
    const iconName = { Cash: 'fa-money-bill-wave', GCash: 'fa-mobile-screen-button' }[method] || 'fa-circle-question';
    label.append(UI.icon(iconName), method || 'Unknown');
    return label;
}

function renderTransactions(transactions, { fade = true } = {}) {
    if (!transactions.length) {
        UI.tableMessage(transactionBody, COLUMN_COUNT, hasActiveFilters()
            ? {
                icon: 'fa-magnifying-glass',
                title: 'No matching transactions',
                message: 'Try a different search, or clear the filters to see every sale.',
                actionLabel: 'Clear filters',
                actionIcon: 'fa-xmark',
                onAction: clearFilters
            }
            : {
                icon: 'fa-receipt',
                title: 'No transactions yet',
                message: 'Sales made at the POS will appear here.'
            });
        return;
    }

    UI.fillTable(transactionBody, transactions.map(transaction => {
        const viewButton = UI.el('button', 'btn btn-ghost btn-sm transaction-view-button');
        viewButton.type = 'button';
        viewButton.append(UI.icon('fa-eye'), 'View');
        viewButton.setAttribute('aria-label',
            `View details of transaction ${transaction.referenceId || `#${transaction.transactionId}`}`);
        viewButton.addEventListener('click', () => openDetails(transaction));

        const row = document.createElement('tr');
        row.append(
            UI.cell(transaction.dateTime, 'col-muted'),
            UI.cell(UI.formatPeso(transaction.totalAmount), 'col-amount'),
            UI.cell(transaction.referenceId || '—', 'col-muted'),
            UI.cell(paymentLabel(transaction.paymentMethod)),
            UI.cell(UI.statusBadge(transaction.status)),
            UI.cell(viewButton, 'col-action')
        );
        return row;
    }), { fade });
}

/* =========================
   SEARCH & FILTERS
========================= */
function applyFilters() {
    filters.search = searchInput.value.trim();
    filters.status = statusFilter.value;
    filters.payment = paymentFilter.value;
    filters.from = fromDate.value;
    filters.to = toDate.value;
    // Each date field can't go past the other, so the range is never backwards.
    toDate.min = fromDate.value;
    fromDate.max = toDate.value;
    clearFiltersButton.hidden = !hasActiveFilters();
    loadTransactions(1);
}

function clearFilters() {
    document.getElementById('transactionFilters').reset();
    applyFilters();
    searchInput.focus();
}

/* =========================
   EXPORT
========================= */
async function exportTransactions(event) {
    if (!totalTransactions) {
        UI.toast(hasActiveFilters() ? 'No transactions match your filters, so there is nothing to export.' : 'There are no transactions to export yet.');
        return;
    }

    const restore = UI.setLoading(event.currentTarget, 'Exporting...');
    try {
        const fileName = await UI.download(`${apiBase}/api/POS/Transaction/export?${filterParams()}`, 'crkd-transactions.xlsx');
        UI.toast(`Exported ${totalTransactions.toLocaleString('en-PH')} transaction${totalTransactions === 1 ? '' : 's'} to ${fileName}.`, { tone: 'success' });
    } catch (error) {
        console.error('Export Error:', error);
        UI.toast(error.message || 'The export failed. Please try again.', { tone: 'error' });
    } finally {
        restore();
    }
}

/* =========================
   DETAILS (read-only)
========================= */
const detailsModal = document.getElementById('transactionDetailsModal');
const detailsBody = document.getElementById('detailsBody');
const detailsExchangeLink = document.getElementById('detailsExchangeLink');

function detailsSkeleton() {
    const grid = UI.el('div', 'detail-grid');
    for (let index = 0; index < 6; index++) {
        const pair = UI.el('div');
        pair.append(UI.skeleton('skeleton-text', '50%'), UI.skeleton('skeleton-text', '80%'));
        grid.appendChild(pair);
    }
    const items = UI.el('div');
    for (let index = 0; index < 3; index++) items.appendChild(UI.skeleton('skeleton-text', `${90 - index * 15}%`));
    detailsBody.replaceChildren(grid, items);
}

function renderDetails({ transaction, items, exchanges, canExchange, exchangeUntil }) {
    const summary = UI.el('dl', 'detail-grid');
    summary.append(
        UI.detailPair('Reference ID', transaction.referenceId || '—'),
        UI.detailPair('Date & time', transaction.dateTime),
        UI.detailPair('Payment method', paymentLabel(transaction.paymentMethod)),
        UI.detailPair('Sold by', transaction.soldBy || 'Unknown'),
        UI.detailPair('Status', UI.statusBadge(transaction.status)),
        UI.detailPair('Total amount', UI.formatPeso(transaction.totalAmount))
    );
    // Sales with a coupon or a manual discount: totalAmount is what the customer paid after it.
    if (transaction.discountAmount > 0) {
        const name = transaction.manualDiscountPercent
            ? `Manual ${transaction.manualDiscountPercent}%`
            : transaction.discountCode || 'Coupon';
        summary.appendChild(UI.detailPair('Discount', `${name} · −${UI.formatPeso(transaction.discountAmount)}`));
    }

    const itemsSection = UI.el('section', 'details-section');
    itemsSection.appendChild(UI.el('h3', null, 'Items'));
    if (items.length) {
        const table = UI.el('table', 'transaction-table details-table');
        const head = UI.el('thead');
        const headRow = UI.el('tr');
        ['Product', 'Size / Color', 'Qty', 'Unit price', 'Subtotal'].forEach(label => {
            const th = UI.el('th', null, label);
            th.scope = 'col';
            headRow.appendChild(th);
        });
        head.appendChild(headRow);
        const body = UI.el('tbody');
        items.forEach(item => {
            const product = UI.el('div', 'details-product');
            product.appendChild(UI.el('span', null, item.productName));
            if (item.exchangeReason) product.appendChild(UI.badge(item.exchangeReason, 'info'));
            const row = UI.el('tr');
            row.append(
                UI.cell(product),
                UI.cell(UI.variantLabel(item.size, item.color), 'col-muted'),
                UI.cell(String(item.quantity)),
                UI.cell(UI.formatPeso(item.unitPrice), 'col-muted'),
                UI.cell(UI.formatPeso(item.unitPrice * item.quantity), 'col-amount')
            );
            body.appendChild(row);
        });
        table.append(head, body);
        UI.labelCells(body);
        const scroll = UI.el('div', 'details-table-scroll');
        scroll.appendChild(table);
        itemsSection.appendChild(scroll);
    } else {
        itemsSection.appendChild(UI.el('p', 'details-empty', 'Item details were not recorded for this sale.'));
    }

    const sections = [summary, itemsSection];
    if (exchanges.length) {
        const history = UI.el('section', 'details-section');
        history.appendChild(UI.el('h3', null, 'Exchange history'));
        const list = UI.el('ol', 'exchange-history');
        exchanges.forEach(exchange => {
            const entry = UI.el('li');
            entry.appendChild(UI.el('p', 'exchange-history-meta', `${exchange.createdAt} · processed by ${exchange.processedBy}`));
            const changes = UI.el('ul');
            exchange.items.forEach(item => {
                changes.appendChild(UI.el('li', null,
                    `${item.productName}: ${UI.variantLabel(item.returnedSize, item.returnedColor)} → ` +
                    `${UI.variantLabel(item.newSize, item.newColor)} × ${item.quantity} (${item.reason})`));
            });
            entry.appendChild(changes);
            if (exchange.notes) entry.appendChild(UI.el('p', 'exchange-history-notes', `Note: ${exchange.notes}`));
            list.appendChild(entry);
        });
        history.appendChild(list);
        sections.push(history);
    }

    detailsBody.replaceChildren(...sections);
    detailsBody.classList.add('fade-in');

    detailsExchangeLink.hidden = !canExchange;
    detailsExchangeLink.title = canExchange ? `Items can be exchanged until ${exchangeUntil}.` : '';
    detailsExchangeLink.href = `exchange.html?sale=${encodeURIComponent(transaction.referenceId || transaction.transactionId)}`;
}

async function openDetails(transaction) {
    document.getElementById('detailsTitle').textContent =
        `Transaction ${transaction.referenceId || `#${transaction.transactionId}`}`;
    detailsExchangeLink.hidden = true;
    detailsBody.classList.remove('fade-in');
    detailsSkeleton();
    openModalElement(detailsModal, closeDetails);

    try {
        renderDetails(await UI.fetchJson(`${apiBase}/api/POS/Transaction/${encodeURIComponent(transaction.transactionId)}/details`));
    } catch (error) {
        console.error('Transaction Details Error:', error);
        const retry = UI.el('button', 'btn btn-secondary btn-sm');
        retry.type = 'button';
        retry.append(UI.icon('fa-rotate-right'), 'Try again');
        retry.addEventListener('click', () => openDetails(transaction));
        const message = UI.el('div', 'details-error');
        message.append(UI.el('p', null, error.message || 'The transaction details could not be loaded.'), retry);
        detailsBody.replaceChildren(message);
    }
}

function closeDetails() {
    closeModalElement(detailsModal);
}

/* =========================
   PAGE LOAD
========================= */
document.addEventListener('DOMContentLoaded', () => {
    const role = localStorage.getItem('userRole');
    if (role && role.toLowerCase() !== 'owner') {
        document.getElementById('exportButton')?.remove();
        detailsExchangeLink.remove();
        document.getElementById('detailsSubtitle').textContent = "Sale records can't be edited.";
    }

    const debouncedFilter = UI.debounce(applyFilters, 350);
    searchInput.addEventListener('input', debouncedFilter);
    [statusFilter, paymentFilter, fromDate, toDate].forEach(control => control.addEventListener('change', applyFilters));
    document.getElementById('transactionFilters').addEventListener('submit', event => {
        event.preventDefault();
        applyFilters();
    });
    clearFiltersButton.addEventListener('click', clearFilters);

    document.getElementById('exportButton')?.addEventListener('click', exportTransactions);

    detailsModal.querySelectorAll('[data-close-details]').forEach(button => button.addEventListener('click', closeDetails));
    detailsModal.addEventListener('click', event => {
        if (event.target === detailsModal) closeDetails();
    });

    loadTransactions(1);
    Live.on(['transactions', 'exchanges'], () => loadTransactions(currentPage, { quiet: true }));
});
