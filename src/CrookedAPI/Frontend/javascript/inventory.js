/* =========================
   INVENTORY
========================= */
const INVENTORY_COLUMNS = 8;
let inventoryProducts = [];

// stock_status comes from the API (StockStatus.Of), so this page and the Products page agree on
// what counts as low: stock at or below the variant's forecast-based threshold.
const isOutOfStock = item => item.stock_status === 'out';

// "Low stock first": low items (fewest left first), then out-of-stock ones, then the rest.
// The default keeps the API's order and only moves out-of-stock items to the bottom.
const LOW_FIRST_RANK = { low: 0, out: 1, in: 2 };
const SORTS = {
    default: (a, b) => isOutOfStock(a) - isOutOfStock(b),
    'low-first': (a, b) =>
        (LOW_FIRST_RANK[a.stock_status] ?? 2) - (LOW_FIRST_RANK[b.stock_status] ?? 2)
        || (a.stock_status === 'low' ? a.stock_quantity - b.stock_quantity : 0)
};

async function loadInventory({ quiet = false } = {}) {
    const tableBody = document.getElementById('inventory-list-main');
    if (!tableBody) return;
    if (!quiet) UI.tableSkeleton(tableBody, INVENTORY_COLUMNS, 8);

    try {
        inventoryProducts = await UI.fetchJson(`${apiBase}/api/products/get-inventory`);
        renderInventoryTable({ fade: !quiet });
    } catch (error) {
        console.error('Inventory Error:', error);
        UI.tableMessage(tableBody, INVENTORY_COLUMNS, {
            isError: true,
            title: 'Unable to load inventory',
            message: error.message,
            actionLabel: 'Try again',
            onAction: () => loadInventory()
        });
    }
}

function renderInventoryTable({ fade = false } = {}) {
    const tableBody = document.getElementById('inventory-list-main');
    if (!tableBody) return;

    const query = document.getElementById('inventorySearch')?.value.trim().toLocaleLowerCase() || '';
    const sort = SORTS[document.getElementById('inventorySort')?.value] || SORTS.default;
    // sort() is stable, so items that compare equal keep the API's order.
    const products = inventoryProducts
        .filter(item =>
            [item.product_name, item.category, item.size, item.color]
                .some(value => String(value || '').toLocaleLowerCase().includes(query)))
        .sort(sort);

    if (!products.length) {
        UI.tableMessage(tableBody, INVENTORY_COLUMNS, query
            ? {
                icon: 'fa-magnifying-glass',
                title: 'No matching products',
                message: 'Try a different product name, category, size or color.'
            }
            : {
                icon: 'fa-boxes-stacked',
                title: 'No inventory yet',
                message: 'Products you add on the Products page will be listed here.'
            });
        return;
    }

    UI.fillTable(tableBody, products.map(item => {
        const status = UI.stockBadge(item.stock_status);

        const row = document.createElement('tr');
        row.append(
            UI.cell(item.product_name),
            UI.cell(item.category, 'col-muted'),
            UI.cell(item.size || '—'),
            UI.cell(item.color || '—'),
            UI.cell(UI.formatPeso(item.price)),
            UI.cell(String(item.stock_quantity)),
            UI.cell(String(item.low_stock_threshold), 'col-muted'),
            UI.cell(status)
        );
        return row;
    }), { fade });
}

document.getElementById('inventorySearch')?.addEventListener('input', UI.debounce(() => renderInventoryTable(), 200));
document.getElementById('inventorySort')?.addEventListener('change', () => renderInventoryTable({ fade: true }));

/* =========================
   PAGE LOAD
========================= */
document.addEventListener('DOMContentLoaded', () => {
    loadInventory();
    Live.on(['products', 'exchanges', 'forecast'], () => loadInventory({ quiet: true }));
});
