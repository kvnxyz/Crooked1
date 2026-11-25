/* =========================
   AUDIT TRAILS (owner only)
   Everything people do in the system, newest first: sales, exchanges, product, discount and
   account changes, imports, and logins. Search, filters and pages of 20. Entries are written
   by the server (ActivityLog), so this page only reads them.
========================= */
const ACTIVITY_PAGE_SIZE = 20;
const ACTIVITY_COLUMNS = 4;
const TYPE_TONES = { Sale: 'success', Exchange: 'info', Import: 'info', Discount: 'info', Product: 'warning', Account: 'warning' };

const activityFilters = { search: '', type: '', staff: '', from: '', to: '' };
let activityPage = 1;
let latestActivityRequest = 0;
let focusActivityPager = false;
const activityDrawn = UI.lastDrawn();

const activityBody = document.getElementById('activityTableBody');
const activitySummary = document.getElementById('activitySummary');
const activityPager = document.getElementById('activityPagination');
const activitySearch = document.getElementById('activitySearch');
const typeFilter = document.getElementById('typeFilter');
const staffFilter = document.getElementById('staffFilter');
const fromDate = document.getElementById('fromDate');
const toDate = document.getElementById('toDate');
const clearFiltersButton = document.getElementById('clearFilters');

const hasActivityFilters = () => Object.values(activityFilters).some(Boolean);

function activityParams(extra = {}) {
    const params = new URLSearchParams();
    Object.entries({ ...activityFilters, ...extra }).forEach(([key, value]) => {
        if (value !== '' && value !== null && value !== undefined) params.set(key, value);
    });
    return params;
}

/* =========================
   LIST
========================= */
function activityRow(entry) {
    const time = UI.el('time', null, entry.dateTime);
    time.dateTime = entry.dateIso;

    const row = document.createElement('tr');
    row.append(
        UI.cell(time, 'col-date col-muted'),
        UI.cell(entry.staffName, 'col-staff'),
        UI.cell(UI.badge(entry.type, TYPE_TONES[entry.type])),
        UI.cell(entry.action, 'col-wrap')
    );
    return row;
}

function renderActivity(entries, { fade = true } = {}) {
    if (entries.length) {
        UI.fillTable(activityBody, entries.map(activityRow), { fade });
        return;
    }

    UI.tableMessage(activityBody, ACTIVITY_COLUMNS, hasActivityFilters()
        ? {
            icon: 'fa-magnifying-glass',
            title: 'No matching activity',
            message: 'Try a different search, or clear the filters to see everything.',
            actionLabel: 'Clear filters',
            actionIcon: 'fa-xmark',
            onAction: clearActivityFilters
        }
        : {
            icon: 'fa-clock-rotate-left',
            title: 'No activity yet',
            message: 'Sales, logins, exchanges and changes to products, discounts and accounts will show up here.'
        });
}

// quiet: a live refresh keeps the current rows on screen until the new ones arrive.
async function loadActivity(page = activityPage, { quiet = false } = {}) {
    const request = ++latestActivityRequest;
    if (!quiet) {
        UI.tableSkeleton(activityBody, ACTIVITY_COLUMNS, 8);
        activitySummary.textContent = 'Loading activity...';
    }

    try {
        const data = await UI.fetchJson(`${apiBase}/api/Activity?${activityParams({ page, pageSize: ACTIVITY_PAGE_SIZE })}`);
        // A newer search or page request replaced this one while it was loading.
        if (request !== latestActivityRequest) return;

        // A refresh that found nothing new leaves the page as it is.
        if (!activityDrawn.changed(data) && quiet) return;

        activityPage = data.page;
        renderActivity(data.items, { fade: !quiet });
        const count = `${data.totalItems.toLocaleString('en-PH')} ${data.totalItems === 1 ? 'entry' : 'entries'}`;
        activitySummary.textContent = hasActivityFilters() ? `${count} match your search and filters.` : `${count} in total.`;
        UI.pagination(activityPager, {
            page: data.page,
            totalPages: data.totalPages,
            totalItems: data.totalItems,
            pageSize: data.pageSize,
            itemLabel: 'entries',
            onChange: goToActivityPage
        });

        if (focusActivityPager) {
            activityPager.querySelector('[aria-current="page"]')?.focus();
            focusActivityPager = false;
        }
    } catch (error) {
        if (request !== latestActivityRequest) return;
        activityDrawn.forget();
        console.error('Activity Error:', error);
        activityPager.replaceChildren();
        activitySummary.textContent = 'Activity could not be loaded.';
        UI.tableMessage(activityBody, ACTIVITY_COLUMNS, {
            isError: true,
            title: 'Unable to load the audit trails',
            message: error.message,
            actionLabel: 'Try again',
            onAction: () => loadActivity(activityPage)
        });
    }
}

function goToActivityPage(page) {
    focusActivityPager = true;
    loadActivity(page);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('view-activity').scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
}

// Everyone who has an entry, for the Staff filter. The current choice is kept.
async function loadStaffNames() {
    try {
        const names = await UI.fetchJson(`${apiBase}/api/Activity/staff`);
        // Same names: leave the list alone, so a refresh doesn't close it while it's open.
        const shown = [...staffFilter.options].slice(1).map(option => option.value);
        if (shown.length === names.length && shown.every((name, i) => name === names[i])) return;
        const chosen = staffFilter.value;
        staffFilter.replaceChildren(new Option('All staff', ''), ...names.map(name => new Option(name, name)));
        staffFilter.value = names.includes(chosen) ? chosen : '';
    } catch (error) {
        console.error('Activity Staff Error:', error);
    }
}

/* =========================
   SEARCH & FILTERS
========================= */
function applyActivityFilters() {
    activityFilters.search = activitySearch.value.trim();
    activityFilters.type = typeFilter.value;
    activityFilters.staff = staffFilter.value;
    activityFilters.from = fromDate.value;
    activityFilters.to = toDate.value;
    // Each date field can't go past the other, so the range is never backwards.
    toDate.min = fromDate.value;
    fromDate.max = toDate.value;
    clearFiltersButton.hidden = !hasActivityFilters();
    loadActivity(1);
}

function clearActivityFilters() {
    document.getElementById('activityFilters').reset();
    applyActivityFilters();
    activitySearch.focus();
}

/* =========================
   PAGE LOAD
========================= */
document.addEventListener('DOMContentLoaded', () => {
    activitySearch.addEventListener('input', UI.debounce(applyActivityFilters, 350));
    [typeFilter, staffFilter, fromDate, toDate].forEach(control => control.addEventListener('change', applyActivityFilters));
    document.getElementById('activityFilters').addEventListener('submit', event => {
        event.preventDefault();
        applyActivityFilters();
    });
    clearFiltersButton.addEventListener('click', clearActivityFilters);

    loadStaffNames();
    loadActivity(1);
    // New entries (a sale at the POS, a login on another device) appear without reloading the page,
    // through live updates or, when those are off, a check every 10 seconds.
    Live.on(['activity'], () => {
        loadStaffNames();
        loadActivity(activityPage, { quiet: true });
    }, { poll: true });
});
