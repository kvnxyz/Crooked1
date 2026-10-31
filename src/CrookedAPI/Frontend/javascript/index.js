const API_BASE = "/api/Auth";

const focusableSelector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
].join(', ');

const loginForm = document.getElementById('loginForm');
const userField = document.getElementById('user');
const passField = document.getElementById('pass');
const loginMessage = document.getElementById('message');
const resetModal = document.getElementById('reset-modal');
const resetForm = document.getElementById('resetForm');
const resetMessage = document.getElementById('reset-msg');
const resetFields = ['reset-username', 'recovery-key', 'new-password'].map(id => document.getElementById(id));

// Keeps Tab and Shift+Tab inside an open dialog or modal (same as layout.js).
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

// Returns focus to the element that opened a dialog, or to the username field.
function restoreFocus(element) {
    if (element?.isConnected && element !== document.body) {
        element.focus();
    } else {
        userField.focus();
    }
}

/* =========================
   CONFIRMATION DIALOG (same behaviour as showDialog in layout.js)
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

    // Destructive confirmations start on Cancel so pressing Enter cannot discard anything by accident.
    (onConfirm && options.danger ? cancelBtn : okBtn).focus();
}

/* =========================
   FORM HELPERS
========================= */
// state: 'error', 'success' or nothing for a neutral progress message.
function setMessage(element, text, state) {
    element.textContent = text;
    element.classList.toggle('is-error', state === 'error');
    element.classList.toggle('is-success', state === 'success');
}

// Marks empty fields as invalid and moves focus to the first one. Returns true when all are filled.
function checkRequired(fields) {
    const empty = fields.filter(field => !field.value.trim());
    fields.forEach(field => {
        if (empty.includes(field)) field.setAttribute('aria-invalid', 'true');
        else field.removeAttribute('aria-invalid');
    });
    empty[0]?.focus();
    return !empty.length;
}

document.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', () => {
        if (input.value.trim()) input.removeAttribute('aria-invalid');
    });
});

/* =========================
   LOGIN
========================= */
let loginPending = false;

async function login(event) {
    event.preventDefault();
    if (loginPending) return;

    if (!checkRequired([userField, passField])) {
        setMessage(loginMessage, 'Please enter both your username and password.', 'error');
        return;
    }

    const username = userField.value.trim();
    const password = passField.value.trim();

    loginPending = true;
    setMessage(loginMessage, 'Logging in...');

    try {
        const response = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ Username: username, Password: password })
        });

        if (response.ok) {
            const result = await response.json();
            localStorage.setItem("userRole", result.role);
            localStorage.setItem("userName", result.fullName || result.username || "User");

            setMessage(loginMessage, 'Access granted. Opening dashboard...', 'success');
            // loginPending stays true so the form cannot be sent again while the page changes.
            setTimeout(() => { window.location.href = "dashboard.html"; }, 1000);
            return;
        }

        const errorData = await response.json().catch(() => ({}));
        setMessage(loginMessage, errorData.message || 'Invalid username or password.', 'error');
    } catch (err) {
        setMessage(loginMessage, 'Connection failed. Check if the API is running.', 'error');
    }

    loginPending = false;
}

loginForm.addEventListener('submit', login);

/* =========================
   OWNER RECOVERY
========================= */
// Opening moves focus into the form and keeps Tab inside it; Escape, Cancel and the
// close button ask before discarding typed values; closing returns focus to "Forgot password?".
let resetReturnFocus = null;

function openReset() {
    resetReturnFocus = document.activeElement;
    resetForm.reset();
    resetFields.forEach(field => field.removeAttribute('aria-invalid'));
    setMessage(resetMessage, '');
    resetModal.hidden = false;
    document.body.classList.add('modal-open');
    resetFields[0].focus();
}

function closeReset() {
    resetModal.hidden = true;
    document.body.classList.remove('modal-open');
    setMessage(resetMessage, '');
    restoreFocus(resetReturnFocus);
}

function requestCloseReset() {
    if (!resetFields.some(field => field.value)) {
        closeReset();
        return;
    }

    showDialog(
        'Discard Changes?',
        'You have unsaved changes in this form. Close it and discard them?',
        closeReset,
        null,
        { confirmText: 'Discard', danger: true }
    );
}

function submitReset(event) {
    event.preventDefault();

    if (!checkRequired(resetFields)) {
        setMessage(resetMessage, 'Please fill in all three fields.', 'error');
        return;
    }

    const newPassword = resetFields[2];
    if (!UI.isValidPassword(newPassword.value)) {
        newPassword.setAttribute('aria-invalid', 'true');
        newPassword.focus();
        setMessage(resetMessage, 'The new password does not meet all the rules listed under it.', 'error');
        return;
    }

    showDialog(
        'Update Password',
        `Set a new password for "${resetFields[0].value.trim()}"?`,
        sendReset,
        null,
        { confirmText: 'Update Password' }
    );
}

async function sendReset() {
    const data = {
        username: resetFields[0].value,
        recoveryKey: resetFields[1].value,
        newPassword: resetFields[2].value
    };

    setMessage(resetMessage, 'Updating password...');

    try {
        const response = await fetch(`${API_BASE}/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json().catch(() => ({}));

        if (response.ok) {
            closeReset();
            // Back on the login form: fill in the username and put the cursor in the password field.
            userField.value = data.username.trim();
            passField.value = '';
            setMessage(loginMessage, 'Password updated. Please log in with your new password.', 'success');
            passField.focus();
        } else {
            setMessage(resetMessage, result.message || 'The password could not be updated.', 'error');
        }
    } catch (err) {
        setMessage(resetMessage, 'Server error. Please try again.', 'error');
    }
}

UI.passwordChecklist(resetFields[2], document.getElementById('new-password-rules'));
document.getElementById('forgot-password-link').addEventListener('click', openReset);
resetForm.addEventListener('submit', submitReset);
resetModal.querySelectorAll('[data-close-reset]').forEach(button => {
    button.addEventListener('click', requestCloseReset);
});
resetModal.addEventListener('click', (event) => {
    if (event.target === resetModal) requestCloseReset();
});

document.addEventListener('keydown', (event) => {
    // A confirmation dialog on top of the modal handles its own keys.
    if (resetModal.hidden || document.getElementById('customDialog')) return;

    if (event.key === 'Escape') {
        event.preventDefault();
        requestCloseReset();
    } else if (event.key === 'Tab') {
        trapFocus(event, resetModal.querySelector('.modal-content'));
    }
});
