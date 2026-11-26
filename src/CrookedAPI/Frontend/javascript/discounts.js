/* =========================
   DISCOUNT COUPONS (owner only)
   The owner creates coupons here and sets the one percentage staff can give with a manual discount.
   Cashiers pick a coupon or type a manual discount at the Point of Sale; the server checks it there
   and works out the discount itself (DiscountsController, TransactionController).
========================= */
const discountForm = document.getElementById('discountForm');
const codeInput = document.getElementById('discountCode');
const descriptionInput = document.getElementById('discountDescription');
const typeSelect = document.getElementById('discountType');
const valueInput = document.getElementById('discountValue');
const valueLabel = document.getElementById('discountValueLabel');
const minPurchaseInput = document.getElementById('discountMinPurchase');
const maxUsesInput = document.getElementById('discountMaxUses');
const startsOnInput = document.getElementById('discountStartsOn');
const endsOnInput = document.getElementById('discountEndsOn');
const createButton = document.getElementById('createDiscountBtn');
const discountTableBody = document.getElementById('discountTableBody');
const discountSummary = document.getElementById('discountSummary');

const DISCOUNT_COLUMNS = 7;
const MAX_USAGE_LIMIT = 1000000;
// Same rule as DiscountsController.CodePattern on the server.
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,19}$/;
const STATUS_TONES = { Active: 'success', Scheduled: 'info', Expired: 'warning', 'Used up': 'warning', Disabled: 'danger' };

function connectionMessage(error) {
    return error.status ? error.message : 'Cannot connect to the server.';
}

/* =========================
   COUPON LIST
========================= */
function discountRow(discount) {
    const code = UI.el('div');
    code.appendChild(UI.el('span', 'discount-code', discount.code));
    if (discount.description) code.appendChild(UI.el('span', 'discount-description', discount.description));

    const timesUsed = discount.timesUsed.toLocaleString('en-PH');
    const used = discount.maxUses
        ? `${timesUsed} of ${discount.maxUses.toLocaleString('en-PH')}`
        : `${timesUsed} (no limit)`;

    const toggle = UI.el('button', 'btn btn-sm btn-secondary');
    toggle.type = 'button';
    toggle.append(discount.isActive ? 'Disable' : 'Enable', UI.el('span', 'visually-hidden', ` ${discount.code}`));
    toggle.addEventListener('click', () => setDiscountActive(discount, !discount.isActive));

    const remove = UI.el('button', 'btn btn-sm btn-danger-outline');
    remove.type = 'button';
    remove.append('Delete', UI.el('span', 'visually-hidden', ` ${discount.code}`));
    remove.addEventListener('click', () => deleteDiscount(discount));

    const actions = UI.el('div', 'discount-actions');
    actions.append(toggle, remove);

    const row = document.createElement('tr');
    row.append(
        UI.cell(code),
        UI.cell(discount.label),
        UI.cell(discount.minPurchase > 0 ? UI.formatPeso(discount.minPurchase) : 'None', 'col-muted'),
        UI.cell(discount.validity, 'col-muted'),
        UI.cell(used, 'col-muted'),
        UI.cell(UI.badge(discount.status, STATUS_TONES[discount.status])),
        UI.cell(actions, 'col-wrap')
    );
    return row;
}

async function loadDiscounts({ quiet = false } = {}) {
    if (!quiet) {
        UI.tableSkeleton(discountTableBody, DISCOUNT_COLUMNS, 4);
        discountSummary.textContent = 'Loading coupons...';
    }

    try {
        const discounts = await UI.fetchJson(`${apiBase}/api/Discounts`);
        if (discounts.length) {
            UI.fillTable(discountTableBody, discounts.map(discountRow), { fade: !quiet });
        } else {
            UI.tableMessage(discountTableBody, DISCOUNT_COLUMNS, {
                icon: 'fa-tags',
                title: 'No discount coupons yet',
                message: 'Create a coupon above, then cashiers can use its code at the Point of Sale.'
            });
        }

        const usable = discounts.filter(discount => discount.status === 'Active').length;
        discountSummary.textContent = discounts.length
            ? `${discounts.length} coupon${discounts.length === 1 ? '' : 's'} · ${usable} can be used today.`
            : 'No coupons yet.';
    } catch (error) {
        console.error('Discounts Error:', error);
        discountSummary.textContent = 'Coupons could not be loaded.';
        UI.tableMessage(discountTableBody, DISCOUNT_COLUMNS, {
            isError: true,
            title: 'Unable to load discount coupons',
            message: error.message,
            actionLabel: 'Try again',
            onAction: () => loadDiscounts()
        });
    }
}

/* =========================
   ENABLE, DISABLE & DELETE
========================= */
function setDiscountActive(discount, active) {
    showDialog(
        active ? 'Enable Coupon' : 'Disable Coupon',
        active
            ? `Let cashiers use "${discount.code}" again?`
            : `Turn off "${discount.code}"? Cashiers won't be able to use it until you enable it again.`,
        async () => {
            try {
                const result = await UI.fetchJson(`${apiBase}/api/Discounts/${discount.id}/toggle?active=${active}`, {
                    method: 'POST'
                });
                showToast(result?.message || 'Coupon updated.', false);
                loadDiscounts({ quiet: true });
            } catch (error) {
                console.error('Toggle Discount Error:', error);
                showToast(connectionMessage(error), true);
            }
        },
        null,
        { confirmText: active ? 'Enable' : 'Disable', danger: !active }
    );
}

function deleteDiscount(discount) {
    showDialog(
        'Delete Coupon',
        `Delete "${discount.code}"? Cashiers won't be able to use it. Sales that already used it keep their discount.`,
        async () => {
            try {
                const result = await UI.fetchJson(`${apiBase}/api/Discounts/${discount.id}`, { method: 'DELETE' });
                showToast(result?.message || 'Coupon deleted.', false);
                loadDiscounts({ quiet: true });
            } catch (error) {
                console.error('Delete Discount Error:', error);
                showToast(connectionMessage(error), true);
            }
        },
        null,
        { confirmText: 'Delete', danger: true }
    );
}

/* =========================
   CREATE COUPON
========================= */
const isPercent = () => typeSelect.value === 'percent';

// The value field asks for a percentage or a peso amount, depending on the discount type.
function updateValueField() {
    valueLabel.textContent = isPercent() ? 'Percent off (%)' : 'Amount off (₱)';
    valueInput.inputMode = isPercent() ? 'numeric' : 'decimal';
    valueInput.placeholder = isPercent() ? 'e.g. 10' : 'e.g. 50.00';
    valueInput.value = '';
    valueInput.removeAttribute('aria-invalid');
}

function markInvalid(input, message) {
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    showToast(message, true);
    return null;
}

// Returns the coupon to send, or null after pointing at the first field that needs fixing.
// The server checks the same rules again.
function readDiscountForm() {
    discountForm.querySelectorAll('[aria-invalid]').forEach(input => input.removeAttribute('aria-invalid'));

    const code = codeInput.value.trim().toUpperCase();
    if (!CODE_PATTERN.test(code)) {
        return markInvalid(codeInput, 'The code must be 3 to 20 letters, numbers, dashes or underscores.');
    }

    const value = Number(valueInput.value);
    if (!valueInput.value || !(value > 0)) {
        return markInvalid(valueInput, isPercent() ? 'Enter the percent off, from 1 to 100.' : 'Enter the amount off.');
    }
    if (isPercent() && (value > 100 || !Number.isInteger(value))) {
        return markInvalid(valueInput, 'A percentage discount must be a whole number from 1 to 100.');
    }

    const minPurchase = minPurchaseInput.value ? Number(minPurchaseInput.value) : 0;
    if (Number.isNaN(minPurchase)) {
        return markInvalid(minPurchaseInput, 'Enter the minimum purchase as an amount, or leave it blank.');
    }

    const maxUses = maxUsesInput.value ? Number(maxUsesInput.value) : null;
    if (maxUses !== null && !(maxUses >= 1 && maxUses <= MAX_USAGE_LIMIT)) {
        return markInvalid(maxUsesInput, `The usage limit must be from 1 to ${MAX_USAGE_LIMIT.toLocaleString('en-PH')}, or blank for no limit.`);
    }

    const startsOn = startsOnInput.value || null;
    const endsOn = endsOnInput.value || null;
    if (startsOn && endsOn && endsOn < startsOn) {
        return markInvalid(endsOnInput, 'The end date must be on or after the start date.');
    }

    return {
        code,
        description: descriptionInput.value.trim(),
        type: typeSelect.value,
        value,
        minPurchase,
        maxUses,
        startsOn,
        endsOn
    };
}

// "10% off on purchases of ₱500.00 or more, for up to 50 sales"
function describeDiscount(discount) {
    let text = discount.type === 'percent' ? `${discount.value}% off` : `${UI.formatPeso(discount.value)} off`;
    if (discount.minPurchase > 0) text += ` on purchases of ${UI.formatPeso(discount.minPurchase)} or more`;
    if (discount.maxUses) text += `, for up to ${discount.maxUses.toLocaleString('en-PH')} sale${discount.maxUses === 1 ? '' : 's'}`;
    return text;
}

function createDiscount(event) {
    event.preventDefault();
    const discount = readDiscountForm();
    if (!discount) return;

    showDialog(
        'Create Coupon',
        `Create the coupon "${discount.code}" for ${describeDiscount(discount)}?`,
        () => submitDiscount(discount),
        null,
        { confirmText: 'Create Coupon' }
    );
}

async function submitDiscount(discount) {
    const restore = UI.setLoading(createButton, 'Creating...');
    try {
        const result = await UI.fetchJson(`${apiBase}/api/Discounts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(discount)
        });
        restore();
        showToast(result?.message || 'Coupon created.', false);
        discountForm.reset();
        codeInput.focus();
        loadDiscounts({ quiet: true });
    } catch (error) {
        console.error('Create Discount Error:', error);
        restore();
        showToast(connectionMessage(error), true);
        // 409: another coupon already has this code.
        if (error.status === 409) {
            codeInput.setAttribute('aria-invalid', 'true');
            codeInput.focus();
        }
    }
}

/* =========================
   MANUAL DISCOUNTS
   The one percentage staff can take off at the POS without a coupon: if it is 5, staff give
   exactly 5%, never 2, 3 or 4 (0 turns it off for them). Owners can give any percentage. The server
   checks it again when the sale is saved (ManualDiscount).
========================= */
const manualForm = document.getElementById('manualDiscountForm');
const staffPercentInput = document.getElementById('staffPercent');
const saveManualButton = document.getElementById('saveManualDiscountBtn');
const manualError = document.getElementById('manualDiscountError');
let savedStaffPercent = null;

function setManualFormEnabled(enabled) {
    staffPercentInput.disabled = !enabled;
    saveManualButton.disabled = !enabled;
}

async function loadManualDiscount({ quiet = false } = {}) {
    if (!quiet) {
        setManualFormEnabled(false);
        staffPercentInput.value = '';
        staffPercentInput.placeholder = 'Loading...';
        manualError.hidden = true;
    }

    try {
        const settings = await UI.fetchJson(`${apiBase}/api/Discounts/manual`);
        savedStaffPercent = settings.staffPercent;
        // A live refresh doesn't replace a percentage the owner is still typing.
        if (!quiet || document.activeElement !== staffPercentInput) staffPercentInput.value = String(settings.staffPercent);
        staffPercentInput.placeholder = 'e.g. 5';
        manualError.hidden = true;
        setManualFormEnabled(true);
    } catch (error) {
        console.error('Manual Discount Error:', error);
        if (quiet) return;
        staffPercentInput.placeholder = '';
        document.getElementById('manualDiscountErrorText').textContent =
            `The staff manual discount could not be loaded. ${connectionMessage(error)}`;
        manualError.hidden = false;
    }
}

function saveManualDiscount(event) {
    event.preventDefault();
    staffPercentInput.removeAttribute('aria-invalid');

    const percent = Number(staffPercentInput.value);
    if (!staffPercentInput.value || !Number.isInteger(percent) || percent < 0 || percent > 100) {
        markInvalid(staffPercentInput, 'Enter the staff discount as a whole number from 0 to 100.');
        return;
    }
    if (percent === savedStaffPercent) {
        showToast(percent === 0 ? 'Manual discounts are already off for staff.' : `The staff manual discount is already ${percent}%.`, false);
        return;
    }

    showDialog(
        'Staff Manual Discount',
        percent === 0
            ? 'Turn off manual discounts for staff? Owners can still give them.'
            : `Set the staff manual discount to ${percent}%? Staff will only be able to give exactly ${percent}% off.`,
        () => submitManualDiscount(percent),
        null,
        { confirmText: percent === 0 ? 'Turn Off' : 'Save', danger: percent === 0 }
    );
}

async function submitManualDiscount(percent) {
    const restore = UI.setLoading(saveManualButton, 'Saving...');
    try {
        const result = await UI.fetchJson(`${apiBase}/api/Discounts/manual`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ staffPercent: percent })
        });
        savedStaffPercent = result.staffPercent;
        showToast(result?.message || 'The staff manual discount has been saved.', false);
    } catch (error) {
        console.error('Manual Discount Save Error:', error);
        showToast(connectionMessage(error), true);
    } finally {
        restore();
    }
}

/* =========================
   PAGE LOAD
========================= */
document.addEventListener('DOMContentLoaded', () => {
    discountForm.addEventListener('submit', createDiscount);
    // reset fires before the fields are cleared, so the value field is updated just after.
    discountForm.addEventListener('reset', () => setTimeout(() => {
        discountForm.querySelectorAll('[aria-invalid]').forEach(input => input.removeAttribute('aria-invalid'));
        updateValueField();
    }));
    discountForm.addEventListener('input', event => event.target.removeAttribute('aria-invalid'));

    typeSelect.addEventListener('change', updateValueField);
    // The code is shown in capitals (discounts.css) and saved in capitals; other characters are dropped.
    codeInput.addEventListener('input', () => {
        const cleaned = codeInput.value.replace(/[^A-Za-z0-9_-]/g, '');
        if (cleaned !== codeInput.value) codeInput.value = cleaned;
    });
    valueInput.addEventListener('input', () => {
        if (isPercent()) valueInput.value = valueInput.value.replace(/\D/g, '').slice(0, 3);
        else limitAmountInput(valueInput);
    });
    minPurchaseInput.addEventListener('input', () => limitAmountInput(minPurchaseInput));
    maxUsesInput.addEventListener('input', () => {
        maxUsesInput.value = maxUsesInput.value.replace(/\D/g, '').slice(0, 7);
    });
    startsOnInput.addEventListener('change', () => { endsOnInput.min = startsOnInput.value; });

    manualForm.addEventListener('submit', saveManualDiscount);
    staffPercentInput.addEventListener('input', () => {
        staffPercentInput.value = staffPercentInput.value.replace(/\D/g, '').slice(0, 3);
        staffPercentInput.removeAttribute('aria-invalid');
    });
    document.getElementById('retryManualDiscountBtn').addEventListener('click', () => loadManualDiscount());

    updateValueField();
    loadDiscounts();
    loadManualDiscount();
    Live.on(['discounts'], () => {
        loadDiscounts({ quiet: true });
        loadManualDiscount({ quiet: true });
    });
});
