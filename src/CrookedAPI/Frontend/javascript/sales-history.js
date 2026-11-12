/* =========================
   SALES HISTORY
   Every sale with who made it: search, a date range and pages of 10.
   It reads the same search endpoint as the Audit Logs.
========================= */
const PAGE_SIZE = 10;
const COLUMN_COUNT = 5;

const filters = { search: '', from: '', to: '' };
let currentPage = 1;
let latestRequest = 0;
let focusPagerAfterLoad = false;

const salesBody = document.getElementById('salesHistoryTableBody');
const salesSummary = document.getElementById('salesSummary');
const salesPager = document.getElementById('salesPagination');
const salesSearch = document.getElementById('salesSearch');
const salesFromDate = document.getElementById('salesFromDate');
const salesToDate = document.getElementById('salesToDate');
const salesClearFilters = document.getElementById('salesClearFilters');

function hasActiveFilters() {
    return Object.values(filters).some(Boolean);
}

function salesParams(page) {
    const params = new URLSearchParams({ page, pageSize: PAGE_SIZE });
    Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
    });
    return params;
}

// quiet: a live refresh keeps the current rows on screen until the new ones arrive.
async function loadSalesHistory(page = currentPage, { quiet = false } = {}) {
    const request = ++latestRequest;
    if (!quiet) {
        UI.tableSkeleton(salesBody, COLUMN_COUNT, PAGE_SIZE);
        salesSummary.textContent = 'Loading sales...';
    }

    try {
        const data = await UI.fetchJson(`${apiBase}/api/POS/Transaction/search?${salesParams(page)}`);
        // A newer search or page request replaced this one while it was loading.
        if (request !== latestRequest) return;

        currentPage = data.page;
        renderSales(data.items, { fade: !quiet });
        const count = `${data.totalItems.toLocaleString('en-PH')} sale${data.totalItems === 1 ? '' : 's'}`;
        salesSummary.textContent = hasActiveFilters() ? `${count} match your search and dates.` : `${count} in total.`;
        UI.pagination(salesPager, {
            page: data.page,
            totalPages: data.totalPages,
            totalItems: data.totalItems,
            pageSize: data.pageSize,
            itemLabel: 'sales',
            onChange: goToPage
        });

        if (focusPagerAfterLoad) {
            salesPager.querySelector('[aria-current="page"]')?.focus();
            focusPagerAfterLoad = false;
        }
    } catch (error) {
        if (request !== latestRequest) return;
        console.error('Sales History Error:', error);
        salesPager.replaceChildren();
        salesSummary.textContent = 'Sales could not be loaded.';
        UI.tableMessage(salesBody, COLUMN_COUNT, {
            isError: true,
            title: 'Unable to load sales history',
            message: error.message,
            actionLabel: 'Try again',
            onAction: () => loadSalesHistory(currentPage)
        });
    }
}

function goToPage(page) {
    focusPagerAfterLoad = true;
    loadSalesHistory(page);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('view-sales-history').scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
}

function renderSales(sales, { fade = true } = {}) {
    if (!sales.length) {
        UI.tableMessage(salesBody, COLUMN_COUNT, hasActiveFilters()
            ? {
                icon: 'fa-magnifying-glass',
                title: 'No matching sales',
                message: 'Try a different search or dates, or clear the filters to see every sale.',
                actionLabel: 'Clear filters',
                actionIcon: 'fa-xmark',
                onAction: clearFilters
            }
            : {
                icon: 'fa-chart-line',
                title: 'No sales recorded yet',
                message: 'Sales made at the POS will appear here.'
            });
        return;
    }

    UI.fillTable(salesBody, sales.map(sale => {
        const row = document.createElement('tr');
        row.append(
            UI.cell(sale.dateTime, 'col-muted'),
            UI.cell(sale.referenceId || '—'),
            UI.cell(UI.formatPeso(sale.totalAmount)),
            UI.cell(sale.soldBy || 'Unknown', 'col-muted'),
            UI.cell(UI.statusBadge(sale.status))
        );
        return row;
    }), { fade });
}

/* =========================
   SEARCH & DATES
========================= */
function applyFilters() {
    filters.search = salesSearch.value.trim();
    filters.from = salesFromDate.value;
    filters.to = salesToDate.value;
    // Each date can't go past the other, so the range is never backwards.
    salesToDate.min = salesFromDate.value;
    salesFromDate.max = salesToDate.value;
    salesClearFilters.hidden = !hasActiveFilters();
    loadSalesHistory(1);
}

function clearFilters() {
    document.getElementById('salesFilters').reset();
    applyFilters();
    salesSearch.focus();
}

/* =========================
   PAGE LOAD
========================= */
document.addEventListener('DOMContentLoaded', () => {
    salesSearch.addEventListener('input', UI.debounce(applyFilters, 350));
    [salesFromDate, salesToDate].forEach(control => control.addEventListener('change', applyFilters));
    document.getElementById('salesFilters').addEventListener('submit', event => {
        event.preventDefault();
        applyFilters();
    });
    salesClearFilters.addEventListener('click', clearFilters);

    loadSalesHistory(1);
    Live.on(['transactions', 'exchanges'], () => loadSalesHistory(currentPage, { quiet: true }));
});
