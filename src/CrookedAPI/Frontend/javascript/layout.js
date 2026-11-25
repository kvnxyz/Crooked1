// Shared by every management page. Load it after theme.js and ui.js, and before the page's own script.
const apiBase = window.location.origin.startsWith('http')
    ? window.location.origin
    : 'http://127.0.0.1:5055';

const focusableSelector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
].join(', ');

// Keeps Tab and Shift+Tab inside an open dialog or modal.
function trapFocus(event, container) {
    const focusable = [...container.querySelectorAll(focusableSelector)]
        .filter(element => element.offsetParent !== null);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!container.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

// Returns focus to the element that opened a dialog, or to the page content
// when that element was re-rendered in the meantime.
function restoreFocus(element) {
    if (element?.isConnected && element !== document.body) {
        element.focus();
    } else {
        document.getElementById('main-content')?.focus();
    }
}

/* =========================
   CUSTOM DIALOG BOX
========================= */
// Without onConfirm it is a notice with a Close button; with onConfirm it asks for confirmation.
// options: { confirmText, cancelText, danger } - danger shows a red confirm button for destructive actions.
let dialogReturnFocus = null;
let dialogKeydownHandler = null;

function showDialog(title, message, onConfirm, onCancel, options = {}) {
    const existing = document.getElementById('customDialog');
    if (existing) {
        existing.remove();
        document.removeEventListener('keydown', dialogKeydownHandler, true);
    } else {
        dialogReturnFocus = document.activeElement;
    }

    const overlay = document.createElement('div');
    overlay.id = 'customDialog';
    overlay.className = 'dialog-overlay';

    const card = document.createElement('div');
    card.className = 'dialog-card';
    card.setAttribute('role', onConfirm ? 'alertdialog' : 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'customDialogTitle');
    card.setAttribute('aria-describedby', 'customDialogMessage');

    const titleEl = document.createElement('h2');
    titleEl.id = 'customDialogTitle';
    titleEl.className = 'dialog-title';
    titleEl.textContent = title;

    const msgEl = document.createElement('p');
    msgEl.id = 'customDialogMessage';
    msgEl.className = 'dialog-message';
    msgEl.textContent = message;

    const buttons = document.createElement('div');
    buttons.className = 'dialog-actions';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = `btn ${options.danger ? 'btn-danger' : 'btn-primary'}`;
    okBtn.textContent = onConfirm ? (options.confirmText || 'OK') : 'Close';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = options.cancelText || 'Cancel';

    function closeDialog(callback) {
        overlay.remove();
        document.removeEventListener('keydown', dialogKeydownHandler, true);
        restoreFocus(dialogReturnFocus);
        if (callback) callback();
    }

    dialogKeydownHandler = event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            closeDialog(onCancel);
        } else if (event.key === 'Tab') {
            trapFocus(event, card);
        }
    };

    okBtn.addEventListener('click', () => closeDialog(onConfirm));
    cancelBtn.addEventListener('click', () => closeDialog(onCancel));
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeDialog(onCancel);
    });
    document.addEventListener('keydown', dialogKeydownHandler, true);

    if (onConfirm) {
        buttons.append(cancelBtn, okBtn);
    } else {
        buttons.appendChild(okBtn);
    }

    card.append(titleEl, msgEl, buttons);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Destructive confirmations start on Cancel so pressing Enter cannot archive or delete by accident.
    (onConfirm && options.danger ? cancelBtn : okBtn).focus();
}

function showToast(message, isError) {
    UI.toast(message, { tone: isError ? 'error' : 'success' });
}

function limitAmountInput(input) {
    const parts = input.value.replace(/[^\d.]/g, '').split('.');
    const wholeAmount = parts.shift().slice(0, 5);
    const decimalAmount = parts.join('').slice(0, 2);
    input.value = parts.length || input.value.includes('.')
        ? `${wholeAmount}.${decimalAmount}`
        : wholeAmount;
}

/* =========================
   PAGE MODALS
========================= */
// Add/edit product and the exchange editor. Opening one moves focus into it and keeps
// Tab inside it; Escape calls onRequestClose (the modal's own close function, which can
// ask before discarding changes); closing returns focus to the button that opened it.
const openModals = [];

function openModalElement(modal, onRequestClose) {
    if (!modal) return;

    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    if (!openModals.some(entry => entry.modal === modal)) {
        openModals.push({ modal, onRequestClose, returnFocus: document.activeElement });
    }

    const firstField = modal.querySelector('input:not([type="hidden"]):not([type="file"]), select, textarea')
        || modal.querySelector(focusableSelector);
    firstField?.focus();
}

function closeModalElement(modal) {
    if (!modal) return;

    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    const index = openModals.findIndex(entry => entry.modal === modal);
    if (index === -1) return;

    const [{ returnFocus }] = openModals.splice(index, 1);
    if (!openModals.length) document.body.classList.remove('modal-open');
    restoreFocus(returnFocus);
}

document.addEventListener('keydown', (event) => {
    // A confirmation dialog on top of the modal handles its own keys.
    const top = openModals[openModals.length - 1];
    if (!top || document.getElementById('customDialog')) return;

    if (event.key === 'Escape') {
        event.preventDefault();
        top.onRequestClose?.();
    } else if (event.key === 'Tab') {
        trapFocus(event, top.modal.querySelector('.modal-content') || top.modal);
    }
});

/* =========================
   PAGE ACCESS
========================= */
// Pages marked data-owner-only (Products, Audit Trails, Exchanges, Discounts,
// Accounts, Forecasting) send everyone else back to the dashboard.
if (document.body.hasAttribute('data-owner-only')
    && localStorage.getItem('userRole')?.toLowerCase() !== 'owner') {
    window.location.replace('dashboard.html');
}

/* =========================
   PROFILE & LOGOUT
========================= */
function setProfileCardOpen(open) {
    const card = document.getElementById('profileCard');
    if (card) card.hidden = !open;
    document.querySelector('.profile-icon')?.setAttribute('aria-expanded', String(open));
}

function toggleProfileCard(event) {
    event.stopPropagation();
    const card = document.getElementById('profileCard');
    if (card) setProfileCardOpen(card.hidden);
}

document.addEventListener('click', (event) => {
    const profileSection = document.querySelector('.profile-section');
    if (profileSection && !profileSection.contains(event.target)) {
        setProfileCardOpen(false);
    }
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.getElementById('profileCard')?.hidden === false) {
        setProfileCardOpen(false);
        document.querySelector('.profile-icon')?.focus();
    }
});

function logout() {
    showDialog(
        'Log Out',
        'Are you sure you want to log out?',
        () => Session.signOut(),
        null,
        { confirmText: 'Log Out' }
    );
}

/* =========================
   NAVIGATION DRAWER
========================= */
// On tablets and phones dashboard.css moves the sidebar off screen. The menu button in the
// top bar slides it back in; Escape, the close button and a tap beside it put it away.
function initializeNavDrawer() {
    const sidebar = document.querySelector('.sidebar');
    const header = document.querySelector('.top-header');
    if (!sidebar || !header) return;

    sidebar.id = 'sidebarNav';

    const toggle = UI.el('button', 'nav-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Open navigation menu');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', sidebar.id);
    toggle.appendChild(UI.icon('fa-bars'));

    const close = UI.el('button', 'nav-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close navigation menu');
    close.appendChild(UI.icon('fa-xmark'));
    sidebar.prepend(close);

    const logo = UI.el('img', 'header-logo');
    logo.src = '../assets/logo.png';
    logo.alt = '';
    header.prepend(toggle, logo);

    const backdrop = UI.el('div', 'nav-backdrop');
    document.body.appendChild(backdrop);

    const isOpen = () => document.body.classList.contains('nav-open');

    function setOpen(open, { restore = true } = {}) {
        document.body.classList.toggle('nav-open', open);
        toggle.setAttribute('aria-expanded', String(open));
        if (open) close.focus();
        else if (restore) toggle.focus();
    }

    toggle.addEventListener('click', () => setOpen(true));
    close.addEventListener('click', () => setOpen(false));
    backdrop.addEventListener('click', () => setOpen(false));

    document.addEventListener('keydown', event => {
        if (!isOpen()) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
        } else if (event.key === 'Tab') {
            trapFocus(event, sidebar);
        }
    });

    // Turning a tablet can widen the screen past the drawer's breakpoint.
    window.matchMedia('(max-width: 1100px)').addEventListener('change', event => {
        if (!event.matches && isOpen()) setOpen(false, { restore: false });
    });
}

/* =========================
   FORECAST NOTIFICATIONS
========================= */
function renderForecastNotifications(notifications) {
    const list = document.getElementById('forecastNotificationList');
    if (!list) return;

    list.replaceChildren();
    if (!notifications.length) {
        const empty = document.createElement('p');
        empty.className = 'forecast-notification-empty';
        empty.textContent = 'No forecast notifications yet.';
        list.appendChild(empty);
        return;
    }

    notifications.forEach(notification => {
        const item = document.createElement('article');
        item.className = `forecast-notification-item${notification.isRead ? '' : ' unread'}`;

        const image = document.createElement('img');
        image.className = 'forecast-notification-image';
        image.alt = '';
        image.src = notification.imageUrl || '';
        image.addEventListener('error', () => {
            image.classList.add('is-broken');
        }, { once: true });

        const copy = document.createElement('div');
        copy.className = 'forecast-notification-copy';

        // Unread items get a "New" label as well as the highlight, so colour is not the only cue.
        if (!notification.isRead) {
            const badge = document.createElement('span');
            badge.className = 'forecast-notification-badge';
            badge.textContent = 'New';
            copy.appendChild(badge);
        }

        const name = document.createElement('strong');
        name.textContent = notification.productName;
        copy.appendChild(name);

        if (notification.oldThreshold !== notification.newThreshold) {
            const threshold = document.createElement('span');
            const direction = notification.newThreshold > notification.oldThreshold ? 'increased' : 'decreased';
            threshold.textContent = `Low-stock threshold ${direction}: ${notification.oldThreshold} to ${notification.newThreshold}`;
            copy.appendChild(threshold);
        }

        if (notification.oldVelocity !== notification.newVelocity) {
            const velocity = document.createElement('span');
            velocity.textContent = `Sales velocity: ${notification.oldVelocity} to ${notification.newVelocity}`;
            copy.appendChild(velocity);
        }

        const time = document.createElement('time');
        const createdAt = new Date(notification.createdAt);
        time.dateTime = createdAt.toISOString();
        time.textContent = createdAt.toLocaleString();
        copy.appendChild(time);
        item.append(image, copy);
        list.appendChild(item);
    });
}

function updateNotificationButtonLabel(unreadCount) {
    document.getElementById('forecastNotificationButton')?.setAttribute(
        'aria-label',
        unreadCount > 0 ? `Forecast notifications, ${unreadCount} unread` : 'Forecast notifications'
    );
}

async function loadForecastNotifications(markRead = false) {
    const response = await fetch(`${apiBase}/api/Forecasting/notifications`);
    if (!response.ok) throw new Error(`Notifications request failed (${response.status})`);

    const data = await response.json();
    renderForecastNotifications(data.notifications || []);
    const count = document.getElementById('forecastNotificationCount');
    if (count) {
        count.textContent = data.unreadCount > 99 ? '99+' : String(data.unreadCount || 0);
        count.hidden = !(data.unreadCount > 0);
    }
    updateNotificationButtonLabel(data.unreadCount || 0);

    if (markRead && data.unreadCount > 0) {
        const readResponse = await fetch(`${apiBase}/api/Forecasting/notifications/read`, { method: 'POST' });
        if (!readResponse.ok) throw new Error(`Marking notifications read failed (${readResponse.status})`);
        document.querySelectorAll('.forecast-notification-item.unread').forEach(item => {
            item.classList.remove('unread');
        });
        document.querySelectorAll('.forecast-notification-badge').forEach(badge => badge.remove());
        if (count) count.hidden = true;
        updateNotificationButtonLabel(0);
    }
}

function initializeForecastNotifications() {
    const container = document.getElementById('forecastNotifications');
    const button = document.getElementById('forecastNotificationButton');
    const panel = document.getElementById('forecastNotificationPanel');
    if (!container || !button || !panel || localStorage.getItem('userRole')?.toLowerCase() !== 'owner') return;

    container.hidden = false;
    loadForecastNotifications().catch(error => {
        console.error('Forecast Notifications Error:', error);
    });
    window.setInterval(() => {
        loadForecastNotifications().catch(error => {
            console.error('Forecast Notifications Error:', error);
        });
    }, 60000);
    Live.on(['notifications', 'forecast'], () => {
        loadForecastNotifications().catch(error => console.error('Forecast Notifications Error:', error));
    });

    function closePanel() {
        panel.hidden = true;
        button.setAttribute('aria-expanded', 'false');
    }

    button.addEventListener('click', async event => {
        event.stopPropagation();
        const willOpen = panel.hidden;
        panel.hidden = !willOpen;
        button.setAttribute('aria-expanded', String(willOpen));
        if (!willOpen) return;

        const list = document.getElementById('forecastNotificationList');
        if (list) list.textContent = 'Loading notifications...';
        try {
            await loadForecastNotifications(true);
        } catch (error) {
            console.error('Forecast Notifications Error:', error);
            if (list) list.textContent = 'Could not load forecast notifications. Please try again.';
        }
    });
    document.addEventListener('click', event => {
        if (!container.contains(event.target)) closePanel();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !panel.hidden) {
            closePanel();
            button.focus();
        }
    });
}

/* =========================
   PAGE LOAD
========================= */
document.addEventListener('DOMContentLoaded', () => {
    try {
        const role = localStorage.getItem('userRole');
        const name = localStorage.getItem('userName');
        const isOwner = role?.toLowerCase() === 'owner';

        const profileName = document.querySelector('.Owner');
        if (profileName && name) profileName.innerText = name;

        const profileCardName = document.querySelector('.profile-card-header span');
        if (profileCardName && name) profileCardName.innerText = name;

        // Role-based UI hiding
        if (role && !isOwner) {
            ['nav-products', 'nav-activity-logs', 'nav-exchange', 'nav-forecasting', 'nav-discounts',
                'nav-staff-management']
                .forEach(id => document.getElementById(id)?.remove());
        }
    } catch (error) {
        console.error('Layout Init Error:', error);
    }

    document.querySelector('.profile-icon')?.addEventListener('click', toggleProfileCard);
    document.querySelector('[data-action="logout"]')?.addEventListener('click', logout);

    initializeNavDrawer();
    initializeForecastNotifications();
});
