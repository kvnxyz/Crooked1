// The Void Sale form, opened from a sale's details in the Sales Record. Load it after ui.js and
// layout.js, which define the trapFocus, restoreFocus and showDialog helpers it uses.
// A void undoes a sale within 30 minutes, when the customer changes their mind: its items go back into
// stock and it stops counting as revenue (VoidPolicy and SaleVoids on the server). The system doesn't
// move money, so the form tells the cashier how much to give back and how.

// The same number of minutes as VoidPolicy.WindowMinutes on the server.
const VOID_WINDOW_MINUTES = 30;
const VOID_REASONS = ['Customer changed their mind', 'Wrong item or quantity', 'Wrong payment method'];
const VOID_OTHER = 'other';
const VOID_OTHER_MAX_LENGTH = 150;

// The same wording as VoidPolicy.RefundText on the server.
function voidRefundText(sale) {
    const amount = UI.formatPeso(sale.totalAmount);
    if (sale.paymentMethod === 'Cash') return `Give the customer back ${amount} in cash.`;
    if (sale.paymentMethod === 'GCash') return `Send ${amount} back to the customer's GCash.`;
    return `Give the customer back ${amount}.`;
}

let voidFormKeydownHandler = null;

// sale: { transactionId, referenceId, totalAmount, paymentMethod }.
// onVoided(result) runs once the void is saved, before the "Sale Voided" notice; it may return a promise.
// Focus moves into the form and Tab stays inside it; Escape, Cancel and the close button close it.
function openVoidForm(sale, { onVoided } = {}) {
    document.getElementById('voidFormModal')?.remove();
    document.removeEventListener('keydown', voidFormKeydownHandler, true);
    const returnFocus = document.activeElement;
    const reference = sale.referenceId || `#${sale.transactionId}`;

    const modal = UI.el('div', 'modal void-form-modal');
    modal.id = 'voidFormModal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'voidFormTitle');
    modal.setAttribute('aria-describedby', 'voidFormDescription');

    const content = UI.el('div', 'modal-content');
    const header = UI.el('div', 'modal-header');
    const heading = UI.el('div');
    const title = UI.el('h2', null, 'Void Sale');
    title.id = 'voidFormTitle';
    const description = UI.el('p', null,
        `Void sale ${reference}? Its items go back into stock and it won't count as revenue. This can't be undone.`);
    description.id = 'voidFormDescription';
    heading.append(title, description);

    const closeButton = UI.el('button', 'btn btn-ghost btn-icon');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close');
    closeButton.appendChild(UI.icon('fa-xmark'));
    header.append(heading, closeButton);

    const form = UI.el('form', 'modal-form');
    form.noValidate = true;

    const refund = UI.el('p', 'void-refund');
    refund.append(UI.icon('fa-money-bill-wave'), UI.el('span', null, voidRefundText(sale)));

    const reasonField = UI.el('div', 'form-field');
    const reasonLabel = UI.el('label', null, 'Reason');
    reasonLabel.htmlFor = 'voidReason';
    const reasonSelect = UI.el('select');
    reasonSelect.id = 'voidReason';
    reasonSelect.required = true;
    reasonSelect.add(new Option('Choose a reason', ''));
    VOID_REASONS.forEach(reason => reasonSelect.add(new Option(reason, reason)));
    reasonSelect.add(new Option('Other', VOID_OTHER));
    reasonField.append(reasonLabel, reasonSelect);

    const otherField = UI.el('div', 'form-field');
    otherField.hidden = true;
    const otherLabel = UI.el('label', null, 'Other reason');
    otherLabel.htmlFor = 'voidOtherReason';
    const otherInput = UI.el('input');
    otherInput.id = 'voidOtherReason';
    otherInput.type = 'text';
    otherInput.autocomplete = 'off';
    otherInput.maxLength = VOID_OTHER_MAX_LENGTH;
    otherField.append(otherLabel, otherInput);

    const message = UI.el('p', 'form-error');
    message.setAttribute('role', 'alert');

    const actions = UI.el('div', 'modal-actions');
    const cancelButton = UI.el('button', 'btn btn-secondary', 'Cancel');
    cancelButton.type = 'button';
    const submitButton = UI.el('button', 'btn btn-danger', 'Void Sale');
    submitButton.type = 'submit';
    actions.append(cancelButton, submitButton);

    form.append(refund, reasonField, otherField, message, actions);
    content.append(header, form);
    modal.appendChild(content);
    const pageModalOpen = document.body.classList.contains('modal-open');
    document.body.appendChild(modal);
    document.body.classList.add('modal-open');

    let saving = false;

    function close() {
        modal.remove();
        document.removeEventListener('keydown', voidFormKeydownHandler, true);
        if (!pageModalOpen) document.body.classList.remove('modal-open');
        restoreFocus(returnFocus);
    }

    function requestClose() {
        if (!saving) close();
    }

    function fail(text, field) {
        message.textContent = text;
        if (field) {
            field.setAttribute('aria-invalid', 'true');
            field.focus();
        }
    }

    reasonSelect.addEventListener('change', () => {
        reasonSelect.removeAttribute('aria-invalid');
        otherField.hidden = reasonSelect.value !== VOID_OTHER;
    });
    otherInput.addEventListener('input', () => otherInput.removeAttribute('aria-invalid'));

    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (saving) return;
        message.textContent = '';

        let reason = reasonSelect.value;
        if (!reason) return fail('Choose why the sale is being voided.', reasonSelect);
        if (reason === VOID_OTHER) {
            reason = otherInput.value.trim();
            if (!reason) return fail('Type the reason.', otherInput);
        }

        saving = true;
        const restore = UI.setLoading(submitButton, 'Voiding...');
        let result;
        try {
            result = await UI.fetchJson(`/api/POS/Transaction/${encodeURIComponent(sale.transactionId)}/void`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason })
            });
        } catch (error) {
            console.error('Void Sale Error:', error);
            restore();
            saving = false;
            fail(error.status ? error.message : 'Cannot connect to the server. The sale was not voided.');
            return;
        }

        saving = false;
        close();
        try {
            await onVoided?.(result);
        } catch (error) {
            console.error('After Void Error:', error);
        }
        showDialog('Sale Voided', result?.message || `Sale ${reference} was voided. ${voidRefundText(sale)}`);
    });

    closeButton.addEventListener('click', requestClose);
    cancelButton.addEventListener('click', requestClose);
    modal.addEventListener('click', event => {
        if (event.target === modal) requestClose();
    });

    // Capture phase, so the sale's details window underneath doesn't also close on Escape or move
    // focus on Tab.
    voidFormKeydownHandler = event => {
        // A confirmation dialog on top of the form handles its own keys.
        if (document.getElementById('customDialog')) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            requestClose();
        } else if (event.key === 'Tab') {
            event.stopImmediatePropagation();
            trapFocus(event, content);
        }
    };
    document.addEventListener('keydown', voidFormKeydownHandler, true);

    reasonSelect.focus();
}
