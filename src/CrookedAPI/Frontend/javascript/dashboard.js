/* =========================
   SALES ANALYTICS
========================= */
let salesChartInstance;

// Chart text and grid colours come from the theme tokens in dashboard.css.
function chartThemeColors() {
    const styles = getComputedStyle(document.documentElement);
    return {
        foreground: styles.getPropertyValue('--color-text-muted').trim(),
        grid: styles.getPropertyValue('--chart-grid').trim()
    };
}

// Darker lines on the light theme keep every series at 3:1 contrast or better.
function salesLineColor(index, alpha = 1) {
    const lightness = document.documentElement.dataset.theme === 'light' ? 32 : 62;
    return `hsla(${(index * 137.5) % 360}, 70%, ${lightness}%, ${alpha})`;
}

function updateSalesChartTheme() {
    if (!salesChartInstance) return;

    const { foreground, grid } = chartThemeColors();
    salesChartInstance.options.scales.x.ticks.color = foreground;
    salesChartInstance.options.scales.x.grid.color = grid;
    salesChartInstance.options.scales.y.ticks.color = foreground;
    salesChartInstance.options.scales.y.grid.color = grid;
    salesChartInstance.options.plugins.legend.labels.color = foreground;
    salesChartInstance.data.datasets.forEach((dataset, index) => {
        dataset.borderColor = salesLineColor(index);
        dataset.backgroundColor = salesLineColor(index, 0.12);
    });
    salesChartInstance.update('none');
}

window.addEventListener('themechange', updateSalesChartTheme);

// Says why a dashboard request failed. UI.fetchJson gives server errors a status; a request that
// never reached the server (offline, or the server is down or restarting) has none.
function loadErrorText(what, error) {
    if (error?.status === 403) return `Only the owner can see ${what}. Log out, then sign in again as the owner.`;
    if (error?.status) return `The server couldn't load ${what} (error ${error.status}). Try again in a moment.`;
    return `Can't reach the server to load ${what}. Check your internet connection, then try again.`;
}

// True once the chart shows data, so a failed live refresh can leave it on screen.
let salesAnalyticsShown = false;

// quiet: a live refresh keeps the current numbers and chart on screen until the new ones arrive,
// and keeps them if the refresh fails.
async function loadSalesAnalytics({ quiet = false } = {}) {
    const status = document.getElementById('salesAnalyticsStatus');
    const retry = document.getElementById('salesAnalyticsRetry');
    const totalProductsSold = document.getElementById('totalProductsSold');
    const chartSkeleton = quiet ? null : UI.skeleton('skeleton-block chart-skeleton');
    if (chartSkeleton) document.querySelector('.chart-canvas-wrap')?.appendChild(chartSkeleton);
    if (!quiet) {
        if (status) status.textContent = 'Loading the last 7 days of sales...';
        if (totalProductsSold) UI.textSkeleton(totalProductsSold, '3em');
    }

    try {
        const analytics = await UI.fetchJson(`${apiBase}/api/Forecasting/daily-sales`);
        const totalUnitsSold = analytics.products.reduce(
            (total, product) => total + product.dailySales.reduce((dailyTotal, units) => dailyTotal + units, 0),
            0
        );
        if (totalProductsSold) totalProductsSold.textContent = totalUnitsSold.toLocaleString('en-PH');
        if (retry) retry.hidden = true;

        // Chart.js comes from a CDN. Without it the total above still shows.
        if (typeof Chart === 'undefined') {
            if (status) status.textContent = "The chart couldn't be drawn because its library didn't load. Check your internet connection, then reload the page.";
            return;
        }

        // Products with no sales would only add flat lines at zero, so the chart leaves them out.
        const soldProducts = analytics.products.filter(product => product.dailySales.some(units => units > 0));
        renderSalesChart(analytics.dates, soldProducts, { animate: !quiet });
        salesAnalyticsShown = true;
        if (status) status.textContent = soldProducts.length
            ? `Units sold per day over the last 7 days, for the ${soldProducts.length} product${soldProducts.length === 1 ? '' : 's'} that sold. Click or tap a name below the chart to hide or show its line.`
            : 'No products were sold in the last 7 days.';
    } catch (error) {
        console.error('Sales Analytics Error:', error);
        // A failed live refresh leaves the chart and total on screen; the next change or a reload updates them.
        if (quiet && salesAnalyticsShown) return;
        if (status) status.textContent = loadErrorText('sales analytics', error);
        if (totalProductsSold) totalProductsSold.textContent = '—';
        if (retry) retry.hidden = false;
    } finally {
        chartSkeleton?.remove();
    }
}

function renderSalesChart(dates, products, { animate = true } = {}) {
    const canvas = document.getElementById('salesChart');
    if (!canvas) return;

    if (salesChartInstance) salesChartInstance.destroy();

    const { foreground: chartForeground, grid: chartGrid } = chartThemeColors();
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const labels = dates.map(date =>
        new Date(`${date}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }));
    salesChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: products.map((product, index) => ({
                label: UI.variantName(product.productName, product.size, product.color),
                data: product.dailySales,
                borderColor: salesLineColor(index),
                backgroundColor: salesLineColor(index, 0.12),
                borderWidth: 2,
                tension: 0.4,
                fill: false
            }))
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: prefersReducedMotion || !animate ? false : undefined,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { ticks: { color: chartForeground }, grid: { color: chartGrid } },
                y: {
                    beginAtZero: true,
                    ticks: { color: chartForeground, precision: 0 },
                    grid: { color: chartGrid }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { color: chartForeground }
                }
            }
        }
    });
}

/* =========================
   TODAY'S REVENUE
   The server works out "today" in Philippine time and sends the date back.
========================= */
let revenueRequest = 0;
// True once the card shows an amount, so a failed live refresh can keep it.
let revenueShown = false;

// "Nov 12, 2026"
function shopDateLabel(isoDate) {
    return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

// quiet: a live refresh keeps the current amount on screen until the new one arrives,
// and keeps it if the refresh fails.
async function loadRevenue({ quiet = false } = {}) {
    const value = document.getElementById('revenueValue');
    const note = document.getElementById('revenueNote');
    if (!value) return;

    // Only the newest request may fill the card, in case live refreshes overlap.
    const request = ++revenueRequest;
    if (!quiet) {
        UI.textSkeleton(value, '70%');
        if (note) UI.textSkeleton(note, '55%');
    }

    try {
        const data = await UI.fetchJson(`${apiBase}/api/POS/Transaction/today-revenue`);
        if (request !== revenueRequest) return;
        value.textContent = UI.formatPeso(data.revenue);
        if (note) note.textContent = shopDateLabel(data.date);
        revenueShown = true;
    } catch (error) {
        if (request !== revenueRequest) return;
        console.error('Revenue Error:', error);
        // A failed live refresh leaves the amount on screen; the next sale or a reload updates it.
        if (quiet && revenueShown) return;
        value.textContent = '—';
        if (note) note.textContent = loadErrorText("today's revenue", error);
    }
}

/* =========================
   STAFF DASHBOARD STATS
========================= */
async function fetchStaffStats({ quiet = false } = {}) {
    const remainingEl = document.getElementById('statRemainingStock');
    const outEl = document.getElementById('statOutOfStock');
    if (!quiet) [remainingEl, outEl].forEach(element => element && UI.textSkeleton(element, '2.5em'));

    try {
        const products = await UI.fetchJson(`${apiBase}/api/products/get-inventory`);
        const remaining = products.reduce((sum, p) => sum + p.stock_quantity, 0);
        const outOfStock = products.filter(p => p.stock_quantity === 0).length;

        if (remainingEl) remainingEl.textContent = remaining.toLocaleString('en-PH');
        if (outEl) outEl.textContent = outOfStock.toLocaleString('en-PH');
    } catch (error) {
        console.error('Staff Stats Error:', error);
        [remainingEl, outEl].forEach(element => {
            if (element) element.textContent = '—';
        });
    }
}

/* =========================
   PAGE LOAD
========================= */
document.addEventListener('DOMContentLoaded', () => {
    try {
        const role = localStorage.getItem('userRole');
        const isOwner = role?.toLowerCase() === 'owner';

        // Staff see stock cards instead of the sales chart and revenue card.
        // The activity logs have their own owner-only page (activity-logs.html).
        if (role && !isOwner) {
            const staffStats = document.getElementById('staff-stats-container');
            if (staffStats) {
                staffStats.hidden = false;
                fetchStaffStats();
                Live.on(['products', 'exchanges'], () => fetchStaffStats({ quiet: true }));
            }

            const statsContainer = document.querySelector('.dashboard-stats-container');
            if (statsContainer) statsContainer.hidden = true;
        }

        // The sales chart and revenue come from owner-only endpoints.
        if (isOwner) {
            loadSalesAnalytics();
            document.getElementById('salesAnalyticsRetry')?.addEventListener('click', async event => {
                const restore = UI.setLoading(event.currentTarget, 'Trying again...');
                await loadSalesAnalytics();
                restore();
            });
            loadRevenue();
            Live.on(['transactions', 'exchanges', 'products'], () => loadSalesAnalytics({ quiet: true }));
            Live.on(['transactions'], () => loadRevenue({ quiet: true }));
        }
    } catch (error) {
        console.error('Dashboard Init Error:', error);
    }
});
