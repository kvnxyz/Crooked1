// Shared UI building blocks: skeleton loaders, table states, badges, pagination,
// toasts, loading buttons, file pickers, password checks and small helpers.
// Every page loads it (with components.css) before its own scripts and uses it
// through the UI namespace.
const UI = (() => {
    const pesoNumber = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const statusTones = { Completed: 'success', Exchanged: 'info', Pending: 'warning', Voided: 'danger' };
    const stockBadges = { out: ['Out of stock', 'danger'], low: ['Low stock', 'warning'], in: ['In stock', 'success'] };

    function formatPeso(amount) {
        return `₱${pesoNumber.format(Number(amount) || 0)}`;
    }

    function variantLabel(size, color) {
        return `${size?.trim() || 'One Size'} / ${color?.trim() || 'Default'}`;
    }

    // A product variant's full name, such as "CRKD Tee · M / Black".
    function variantName(name, size, color) {
        return size?.trim() || color?.trim() ? `${name} · ${variantLabel(size, color)}` : name;
    }

    const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', 'XXXL', '3XL', '4XL', '5XL'];

    // For sort(): clothing sizes from smallest to largest, then other sizes (such as waist
    // sizes) in numeric order.
    function compareSizes(a, b) {
        const rank = size => {
            const index = SIZE_ORDER.indexOf(size.trim().toUpperCase());
            return index === -1 ? SIZE_ORDER.length : index;
        };
        return rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true });
    }

    function debounce(callback, wait = 300) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => callback(...args), wait);
        };
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function icon(name) {
        const node = el('i', `fa-solid ${name}`);
        node.setAttribute('aria-hidden', 'true');
        return node;
    }

    // Parses a JSON response; a failed request throws an Error carrying the server's message.
    async function fetchJson(url, options) {
        const response = await fetch(url, options);
        const text = await response.text();
        let data = null;
        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                data = null;
            }
        }
        if (!response.ok) {
            const error = new Error(data?.message || data?.error || data?.title || `Request failed (${response.status})`);
            error.status = response.status;
            throw error;
        }
        return data;
    }

    /* =========================
       SKELETONS
    ========================= */
    function skeleton(className, width) {
        const node = el('span', `skeleton ${className || ''}`.trim());
        node.setAttribute('aria-hidden', 'true');
        if (width) node.style.setProperty('--skeleton-width', width);
        return node;
    }

    // Placeholder rows while a table's data loads.
    function tableSkeleton(tbody, columns, rows = 5) {
        const widths = ['72%', '55%', '86%', '44%', '64%'];
        tbody.closest('table')?.setAttribute('aria-busy', 'true');
        tbody.replaceChildren(...Array.from({ length: rows }, (_, rowIndex) => {
            const row = el('tr', 'skeleton-row');
            row.setAttribute('aria-hidden', 'true');
            for (let column = 0; column < columns; column++) {
                const cell = el('td');
                cell.appendChild(skeleton('skeleton-text', widths[(rowIndex + column) % widths.length]));
                row.appendChild(cell);
            }
            return row;
        }));
    }

    // Card-shaped placeholders for a product grid. tag 'li' wraps each card for list grids.
    function cardSkeletons(container, { count = 8, tag = 'div', cardClass = '', mediaHeight, lines = 3 } = {}) {
        container.setAttribute('aria-busy', 'true');
        container.replaceChildren(...Array.from({ length: count }, () => {
            const card = el('div', `${cardClass} skeleton-card`.trim());
            card.setAttribute('aria-hidden', 'true');
            if (mediaHeight) card.style.setProperty('--skeleton-media-height', mediaHeight);
            card.appendChild(skeleton('skeleton-media'));
            ['80%', '45%', '62%', '35%'].slice(0, lines).forEach(width => card.appendChild(skeleton('skeleton-text', width)));
            if (tag !== 'li') return card;

            const item = el('li');
            item.setAttribute('aria-hidden', 'true');
            item.appendChild(card);
            return item;
        }));
    }

    // Placeholder inside a text element, such as a stat value, until textContent replaces it.
    function textSkeleton(element, width = '60%') {
        element.replaceChildren(skeleton('skeleton-inline', width));
    }

    function doneLoading(element) {
        element.removeAttribute('aria-busy');
        element.closest('table')?.removeAttribute('aria-busy');
    }

    /* =========================
       TABLES
    ========================= */
    // Replaces a table's rows once data has loaded and fades them in. Pass { fade: false }
    // when re-rendering in place, such as filtering while typing.
    function fillTable(tbody, rows, { fade = true } = {}) {
        doneLoading(tbody);
        tbody.replaceChildren(...rows);
        labelCells(tbody);
        tbody.classList.remove('fade-in');
        if (!fade) return;
        void tbody.offsetWidth;
        tbody.classList.add('fade-in');
    }

    // Phones show each row as a stack of lines (dashboard.css), so every cell needs its
    // column's name. A column whose heading is hidden holds only a button and gets no label.
    function labelCells(tbody) {
        const headings = [...(tbody.closest('table')?.tHead?.rows[0]?.cells ?? [])];
        const labels = headings.map(heading =>
            heading.querySelector('.visually-hidden') ? '' : heading.textContent.trim());
        [...tbody.rows].forEach(row => [...row.cells].forEach((cell, index) => {
            if (labels[index]) cell.dataset.label = labels[index];
        }));
    }

    // One full-width row for an empty table, a search with no results, or a load error.
    // options: { icon, title, message, actionLabel, actionIcon, onAction, isError }
    function tableMessage(tbody, columns, options) {
        doneLoading(tbody);
        const row = el('tr', `table-state${options.isError ? ' is-error' : ''}`);
        const cell = el('td');
        cell.colSpan = columns;
        const content = el('div', 'table-state-content');
        content.appendChild(el('span', 'table-state-icon'))
            .appendChild(icon(options.icon || (options.isError ? 'fa-triangle-exclamation' : 'fa-inbox')));
        content.appendChild(el('p', 'table-state-title', options.title));
        if (options.message) content.appendChild(el('p', 'table-state-message', options.message));
        if (options.actionLabel && options.onAction) {
            const button = el('button', 'btn btn-secondary btn-sm');
            button.type = 'button';
            button.append(icon(options.actionIcon || 'fa-rotate-right'), options.actionLabel);
            button.addEventListener('click', options.onAction);
            content.appendChild(button);
        }
        cell.appendChild(content);
        row.appendChild(cell);
        tbody.replaceChildren(row);
    }

    function cell(content, className) {
        const node = el('td', className);
        if (content instanceof Node) node.appendChild(content);
        else node.textContent = content ?? '';
        return node;
    }

    // One label/value pair for a <dl class="detail-grid">.
    function detailPair(label, value) {
        const pair = el('div');
        const description = el('dd');
        if (value instanceof Node) description.appendChild(value);
        else description.textContent = value ?? '';
        pair.append(el('dt', null, label), description);
        return pair;
    }

    function badge(text, tone) {
        return el('span', `badge${tone ? ` badge-${tone}` : ''}`, text);
    }

    function statusBadge(status) {
        return badge(status, statusTones[status]);
    }

    // A size or color's stock_status from the API (StockStatus.Of on the server), so every page
    // labels low and out-of-stock items the same way.
    function stockBadge(stockStatus) {
        const [text, tone] = stockBadges[stockStatus] || stockBadges.in;
        return badge(text, tone);
    }

    /* =========================
       PAGINATION
    ========================= */
    // Page numbers to show: the first, the last and the ones around the current page.
    function pageWindow(page, totalPages) {
        if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);

        const pages = new Set([1, totalPages, page - 1, page, page + 1]);
        if (page <= 3) [2, 3, 4].forEach(number => pages.add(number));
        if (page >= totalPages - 2) [totalPages - 3, totalPages - 2, totalPages - 1].forEach(number => pages.add(number));
        const sorted = [...pages].filter(number => number >= 1 && number <= totalPages).sort((a, b) => a - b);

        const result = [];
        sorted.forEach((number, index) => {
            if (index > 0 && number - sorted[index - 1] > 1) result.push(null);
            result.push(number);
        });
        return result;
    }

    // Renders "Showing 1–10 of 57" and Previous / page numbers / Next into container (a <nav>).
    function pagination(container, { page, totalPages, totalItems, pageSize, itemLabel = 'items', onChange }) {
        container.replaceChildren();
        if (!totalItems) return;

        const first = (page - 1) * pageSize + 1;
        const last = Math.min(page * pageSize, totalItems);
        container.appendChild(el('p', 'pagination-summary',
            `Showing ${first}–${last} of ${totalItems.toLocaleString('en-PH')} ${itemLabel}`));
        if (totalPages <= 1) return;

        const list = el('ul', 'pagination-pages');
        const addButton = (content, target, { current = false, disabled = false, label } = {}) => {
            const item = el('li');
            const button = el('button', 'pagination-button');
            button.type = 'button';
            button.append(...content);
            if (label) button.setAttribute('aria-label', label);
            button.disabled = disabled;
            if (current) button.setAttribute('aria-current', 'page');
            else if (!disabled) button.addEventListener('click', () => onChange(target));
            item.appendChild(button);
            list.appendChild(item);
        };

        addButton([icon('fa-chevron-left'), 'Prev'], page - 1, { disabled: page <= 1, label: 'Previous page' });
        pageWindow(page, totalPages).forEach(number => {
            if (number === null) {
                const gap = el('li', 'pagination-ellipsis', '…');
                gap.setAttribute('aria-hidden', 'true');
                list.appendChild(gap);
            } else {
                addButton([String(number)], number, { current: number === page, label: `Page ${number}` });
            }
        });
        addButton(['Next', icon('fa-chevron-right')], page + 1, { disabled: page >= totalPages, label: 'Next page' });
        container.appendChild(list);
    }

    /* =========================
       TOASTS
    ========================= */
    let toastStack = null;

    // The live region exists before the first toast so screen readers announce it.
    function ensureToastStack() {
        if (toastStack) return;
        toastStack = el('div', 'toast-stack');
        toastStack.setAttribute('aria-live', 'polite');
        document.body.appendChild(toastStack);
    }

    // Short, non-blocking notice. Hovering or focusing it keeps it open; errors stay longer.
    // tone: 'success' | 'error' | 'info'
    function toast(message, { tone = 'info', duration = 4500 } = {}) {
        ensureToastStack();

        const item = el('div', `toast toast-${tone}`);
        if (tone === 'error') item.setAttribute('role', 'alert');
        const iconName = { success: 'fa-circle-check', error: 'fa-circle-exclamation' }[tone] || 'fa-circle-info';
        item.appendChild(el('span', 'toast-icon')).appendChild(icon(iconName));
        item.appendChild(el('p', 'toast-message', message));

        const close = el('button', 'toast-close');
        close.type = 'button';
        close.setAttribute('aria-label', 'Dismiss notification');
        close.appendChild(icon('fa-xmark'));
        item.appendChild(close);

        let timer;
        const dismiss = () => {
            clearTimeout(timer);
            if (item.classList.contains('is-leaving')) return;
            item.classList.add('is-leaving');
            setTimeout(() => item.remove(), reducedMotion.matches ? 0 : 180);
        };
        const startTimer = () => {
            clearTimeout(timer);
            timer = setTimeout(dismiss, tone === 'error' ? duration * 1.6 : duration);
        };
        close.addEventListener('click', dismiss);
        item.addEventListener('mouseenter', () => clearTimeout(timer));
        item.addEventListener('mouseleave', startTimer);
        item.addEventListener('focusin', () => clearTimeout(timer));
        item.addEventListener('focusout', startTimer);

        toastStack.appendChild(item);
        startTimer();
        return dismiss;
    }

    /* =========================
       BUTTONS & DOWNLOADS
    ========================= */
    // Disables a button and shows a spinner with a busy label; call the returned function to restore it.
    function setLoading(button, label) {
        const original = [...button.childNodes];
        const wasDisabled = button.disabled;
        const spinner = el('span', 'btn-spinner');
        spinner.setAttribute('aria-hidden', 'true');
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.replaceChildren(spinner, label);
        return () => {
            button.replaceChildren(...original);
            button.disabled = wasDisabled;
            button.removeAttribute('aria-busy');
        };
    }

    /* =========================
       FILE PICKERS
    ========================= */
    // Replaces the look of <input type="file" data-file-picker="Button label"> with a button and
    // the chosen file's name, so only the button opens the file chooser. The input stays in the
    // form (visually hidden), so form code keeps reading input.files as before.
    function enhanceFilePicker(input) {
        if (input.closest('.file-picker')) return;

        const picker = el('div', 'file-picker');
        const button = el('button', 'btn btn-secondary btn-sm file-picker-button');
        button.type = 'button';
        button.id = `${input.id}-file-button`;
        button.append(icon('fa-arrow-up-from-bracket'), input.dataset.filePicker || 'Choose file');
        const name = el('span', 'file-picker-name', 'No file chosen');
        name.id = `${input.id}-file-name`;
        button.setAttribute('aria-describedby', name.id);

        input.before(picker);
        input.classList.add('file-picker-input');
        input.tabIndex = -1;
        input.setAttribute('aria-hidden', 'true');
        picker.append(input, button, name);
        // The field's label now names (and clicks) the button instead of the hidden input.
        const label = document.querySelector(`label[for="${input.id}"]`);
        if (label) label.htmlFor = button.id;

        const showName = () => {
            const file = input.files?.[0];
            name.textContent = file ? file.name : 'No file chosen';
            name.classList.toggle('has-file', Boolean(file));
        };
        button.addEventListener('click', () => input.click());
        input.addEventListener('change', showName);
        input.form?.addEventListener('reset', () => setTimeout(showName));
    }

    function filePickerButton(input) {
        return document.getElementById(`${input.id}-file-button`) || input;
    }

    /* =========================
       PASSWORD RULES
    ========================= */
    // The same rules as PasswordPolicy on the server (api/Models/User.cs).
    const PASSWORD_RULES = [
        value => value.length >= 8 && value.length <= 64,
        value => /[A-Z]/.test(value),
        value => /[a-z]/.test(value),
        value => /\d/.test(value),
        value => /[^A-Za-z0-9\s]/.test(value),
        value => !/\s/.test(value)
    ];

    // Shown when a password breaks a rule; the forms don't list the rules otherwise.
    const passwordRulesText =
        'Password must be 8 to 64 characters, with an uppercase letter, a lowercase letter, a number and a symbol, and no spaces.';

    function isValidPassword(password) {
        return PASSWORD_RULES.every(test => test(password));
    }

    function onPageReady() {
        ensureToastStack();
        document.querySelectorAll('input[type="file"][data-file-picker]').forEach(enhanceFilePicker);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onPageReady);
    else onPageReady();

    // Downloads a file from the API under the name the server gives it.
    async function download(url, fallbackName) {
        const response = await fetch(url);
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || `Download failed (${response.status})`);
        }

        const blob = await response.blob();
        const disposition = response.headers.get('Content-Disposition') || '';
        const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(disposition);
        const name = match ? decodeURIComponent(match[1] || match[2]) : fallbackName;

        const link = el('a');
        link.href = URL.createObjectURL(blob);
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        return name;
    }

    return {
        formatPeso,
        variantLabel,
        variantName,
        compareSizes,
        debounce,
        el,
        icon,
        fetchJson,
        skeleton,
        tableSkeleton,
        labelCells,
        cardSkeletons,
        textSkeleton,
        doneLoading,
        fillTable,
        tableMessage,
        cell,
        detailPair,
        badge,
        statusBadge,
        stockBadge,
        pagination,
        toast,
        setLoading,
        filePickerButton,
        isValidPassword,
        passwordRulesText,
        download
    };
})();
