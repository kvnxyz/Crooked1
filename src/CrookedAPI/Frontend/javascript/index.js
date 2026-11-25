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
const resetDescription = document.getElementById('resetDescription');
const forgotForm = document.getElementById('forgotForm');
const forgotMessage = document.getElementById('forgot-msg');
const emailField = document.getElementById('reset-email');
const resetForm = document.getElementById('resetForm');
const resetMessage = document.getElementById('reset-msg');
const codeField = document.getElementById('reset-code');
const newPasswordField = document.getElementById('new-password');
const confirmPasswordField = document.getElementById('confirm-password');
const resendButton = document.getElementById('resend-code');

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
            // The Change Password form (account.js) needs the login name, not the display name.
            localStorage.setItem("userUsername", username);

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
   FORGOT PASSWORD (owners and staff)
   Step 1 (forgotForm) emails a 5-letter code to the account's email; step 2 (resetForm) takes
   the code and a new password. Codes expire after 5 minutes (PasswordResetCodes on the server).
========================= */
// Opening moves focus into the form and keeps Tab inside it; Escape, Cancel and the
// close button ask before discarding typed values; closing returns focus to "Forgot password?".
const EMAIL_STEP_TEXT = "Enter the email on your account and we'll send you a 5-letter code.";
const CODE_LENGTH = 5;
let resetReturnFocus = null;
let resetEmail = '';
let resendTimer = null;
let resetPending = false;

function showEmailStep() {
    stopResendCooldown();
    resetForm.hidden = true;
    forgotForm.hidden = false;
    resetDescription.textContent = EMAIL_STEP_TEXT;
    setMessage(forgotMessage, '');
    emailField.focus();
}

function showCodeStep(message, resendSeconds) {
    resetForm.reset();
    [codeField, newPasswordField, confirmPasswordField].forEach(field => field.removeAttribute('aria-invalid'));
    setMessage(resetMessage, '');
    forgotForm.hidden = true;
    resetForm.hidden = false;
    resetDescription.textContent = message;
    startResendCooldown(resendSeconds);
    codeField.focus();
}

function openReset() {
    resetReturnFocus = document.activeElement;
    forgotForm.reset();
    emailField.removeAttribute('aria-invalid');
    resetModal.hidden = false;
    document.body.classList.add('modal-open');
    showEmailStep();
}

function closeReset() {
    stopResendCooldown();
    resetModal.hidden = true;
    document.body.classList.remove('modal-open');
    setMessage(forgotMessage, '');
    setMessage(resetMessage, '');
    restoreFocus(resetReturnFocus);
}

// Only the fields of the step on screen count as unsaved changes.
function requestCloseReset() {
    if (resetPending) return;
    const typed = resetForm.hidden ? [emailField] : [codeField, newPasswordField, confirmPasswordField];
    if (!typed.some(field => field.value)) {
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

// "Send a new code" waits as long as the server does before it sends another code to the same account.
function startResendCooldown(seconds) {
    stopResendCooldown();
    let left = seconds || 60;
    const tick = () => {
        resendButton.disabled = left > 0;
        resendButton.textContent = left > 0 ? `Send a new code (${left}s)` : 'Send a new code';
        if (left-- <= 0) stopResendCooldown();
    };
    tick();
    resendTimer = setInterval(tick, 1000);
}

function stopResendCooldown() {
    clearInterval(resendTimer);
    resendTimer = null;
}

async function requestCode(email) {
    const response = await fetch(`${API_BASE}/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || 'The code could not be sent. Please try again.');
    return result;
}

async function sendCode(event) {
    event.preventDefault();
    if (resetPending) return;

    if (!checkRequired([emailField])) {
        setMessage(forgotMessage, 'Please enter your email.', 'error');
        return;
    }
    if (!UI.isValidEmail(emailField.value)) {
        emailField.setAttribute('aria-invalid', 'true');
        emailField.focus();
        setMessage(forgotMessage, UI.emailRulesText, 'error');
        return;
    }

    resetPending = true;
    const restore = UI.setLoading(forgotForm.querySelector('[type="submit"]'), 'Sending...');
    setMessage(forgotMessage, '');
    try {
        const email = emailField.value.trim();
        const result = await requestCode(email);
        resetEmail = email;
        showCodeStep(result.message, result.resendSeconds);
    } catch (error) {
        setMessage(forgotMessage, error instanceof TypeError ? 'Server error. Please try again.' : error.message, 'error');
    } finally {
        restore();
        resetPending = false;
    }
}

async function resendCode() {
    if (resetPending) return;
    resetPending = true;
    setMessage(resetMessage, 'Sending a new code...');
    try {
        const result = await requestCode(resetEmail);
        resetDescription.textContent = result.message;
        setMessage(resetMessage, 'A new code is on its way. Use the newest one.', 'success');
        startResendCooldown(result.resendSeconds);
        codeField.value = '';
        codeField.focus();
    } catch (error) {
        setMessage(resetMessage, error instanceof TypeError ? 'Server error. Please try again.' : error.message, 'error');
    } finally {
        resetPending = false;
    }
}

function markInvalid(field, text) {
    field.setAttribute('aria-invalid', 'true');
    field.focus();
    setMessage(resetMessage, text, 'error');
}

async function submitReset(event) {
    event.preventDefault();
    if (resetPending) return;

    if (!checkRequired([codeField, newPasswordField, confirmPasswordField])) {
        setMessage(resetMessage, 'Please fill in all three fields.', 'error');
        return;
    }

    const code = codeField.value.trim().toUpperCase();
    if (!new RegExp(`^[A-Z]{${CODE_LENGTH}}$`).test(code)) {
        return markInvalid(codeField, `Enter the ${CODE_LENGTH}-letter code from the email.`);
    }
    // Not trimmed: spaces break the password rules, so they are reported instead of removed.
    const newPassword = newPasswordField.value;
    if (!UI.isValidPassword(newPassword)) return markInvalid(newPasswordField, UI.passwordRulesText);
    if (confirmPasswordField.value !== newPassword) {
        return markInvalid(confirmPasswordField, 'The new passwords do not match.');
    }

    resetPending = true;
    const restore = UI.setLoading(resetForm.querySelector('[type="submit"]'), 'Updating...');
    setMessage(resetMessage, '');

    try {
        const response = await fetch(`${API_BASE}/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: resetEmail, code, newPassword })
        });
        const result = await response.json().catch(() => ({}));

        if (response.ok) {
            restore();
            resetPending = false;
            closeReset();
            // Back on the login form: fill in the username and put the cursor in the password field.
            userField.value = result.username || '';
            passField.value = '';
            setMessage(loginMessage, result.message || 'Password updated. Please log in with your new password.', 'success');
            (userField.value ? passField : userField).focus();
            return;
        }

        restore();
        const message = result.message || 'The password could not be updated.';
        markInvalid(message === UI.passwordRulesText ? newPasswordField : codeField, message);
    } catch (err) {
        restore();
        setMessage(resetMessage, 'Server error. Please try again.', 'error');
    }
    resetPending = false;
}

// Keeps only letters, in capitals, so a pasted "abc de" becomes "ABCDE". The field's maxlength
// is longer than the code so a pasted code with spaces isn't cut short before this runs.
codeField.addEventListener('input', () => {
    const cleaned = codeField.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, CODE_LENGTH);
    if (cleaned !== codeField.value) codeField.value = cleaned;
});

document.getElementById('forgot-password-link').addEventListener('click', openReset);
forgotForm.addEventListener('submit', sendCode);
resetForm.addEventListener('submit', submitReset);
resendButton.addEventListener('click', resendCode);
document.getElementById('change-email').addEventListener('click', () => {
    if (!resetPending) showEmailStep();
});
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
