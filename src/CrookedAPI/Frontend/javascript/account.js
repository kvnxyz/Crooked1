// The Change Password form, shared by the admin pages and the POS. Load it after ui.js and
// after layout.js (admin pages) or PointOfSale.js (POS): both define the trapFocus,
// restoreFocus, showDialog and setProfileCardOpen helpers it uses.

/* =========================
   PASSWORD FORM
========================= */
// Opens a modal form for a new password. Focus moves into it and Tab stays inside it;
// Escape, Cancel and the close button ask before discarding typed values.
// options: {
//   title, description,
//   username     - shows a Username field (read-only when it is known) for the user's own password,
//   askCurrent   - asks for the current password as well,
//   submitText,
//   onSubmit(values) - returns a promise; a thrown Error's message is shown in the form.
// }
let passwordFormKeydownHandler = null;

function openPasswordForm(options) {
    document.getElementById('passwordFormModal')?.remove();
    document.removeEventListener('keydown', passwordFormKeydownHandler);
    const returnFocus = document.activeElement;

    const modal = UI.el('div', 'modal password-form-modal');
    modal.id = 'passwordFormModal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'passwordFormTitle');

    const content = UI.el('div', 'modal-content');
    const header = UI.el('div', 'modal-header');
    const heading = UI.el('div');
    const title = UI.el('h2', null, options.title);
    title.id = 'passwordFormTitle';
    heading.appendChild(title);
    if (options.description) {
        const description = UI.el('p', null, options.description);
        description.id = 'passwordFormDescription';
        modal.setAttribute('aria-describedby', description.id);
        heading.appendChild(description);
    }

    const closeButton = UI.el('button', 'btn btn-ghost btn-icon');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close');
    closeButton.appendChild(UI.icon('fa-xmark'));
    header.append(heading, closeButton);

    const form = UI.el('form', 'modal-form');
    form.noValidate = true;

    function addField(id, label, type, autocomplete) {
        const field = UI.el('div', 'form-field');
        const labelEl = UI.el('label', null, label);
        labelEl.htmlFor = id;
        const input = UI.el('input');
        input.id = id;
        input.type = type;
        input.autocomplete = autocomplete;
        input.spellcheck = false;
        if (type === 'password') input.maxLength = 64;
        input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
        field.append(labelEl, input);
        form.appendChild(field);
        return input;
    }

    let usernameInput = null;
    if (options.username !== undefined) {
        usernameInput = addField('passwordFormUsername', 'Username', 'text', 'username');
        usernameInput.value = options.username || '';
        usernameInput.readOnly = Boolean(options.username);
    }
    const currentInput = options.askCurrent
        ? addField('passwordFormCurrent', 'Current password', 'password', 'current-password')
        : null;
    const newInput = addField('passwordFormNew', 'New password', 'password', 'new-password');
    const confirmInput = addField('passwordFormConfirm', 'Confirm new password', 'password', 'new-password');

    const message = UI.el('p', 'password-form-error');
    message.setAttribute('role', 'alert');

    const actions = UI.el('div', 'modal-actions');
    const cancelButton = UI.el('button', 'btn btn-secondary', 'Cancel');
    cancelButton.type = 'button';
    const submitButton = UI.el('button', 'btn btn-primary', options.submitText || 'Change Password');
    submitButton.type = 'submit';
    actions.append(cancelButton, submitButton);
    form.append(message, actions);

    content.append(header, form);
    modal.appendChild(content);
    const pageModalOpen = document.body.classList.contains('modal-open');
    document.body.appendChild(modal);
    document.body.classList.add('modal-open');

    const typedFields = [usernameInput?.readOnly ? null : usernameInput, currentInput, newInput, confirmInput]
        .filter(Boolean);
    let saving = false;

    function close() {
        modal.remove();
        document.removeEventListener('keydown', passwordFormKeydownHandler);
        if (!pageModalOpen) document.body.classList.remove('modal-open');
        restoreFocus(returnFocus);
    }

    function requestClose() {
        if (saving) return;
        if (!typedFields.some(input => input.value)) {
            close();
            return;
        }
        showDialog(
            'Discard Changes?',
            'You have unsaved changes in this form. Close it and discard them?',
            close,
            null,
            { confirmText: 'Discard', danger: true }
        );
    }

    function fail(text, input) {
        message.textContent = text;
        if (input) {
            input.setAttribute('aria-invalid', 'true');
            input.focus();
        }
    }

    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (saving) return;
        message.textContent = '';

        const values = {
            username: usernameInput?.value.trim(),
            // Trimmed the same way the login form trims it.
            currentPassword: currentInput?.value.trim(),
            newPassword: newInput.value
        };

        if (usernameInput && !values.username) return fail('Enter your username.', usernameInput);
        if (currentInput && !values.currentPassword) return fail('Enter your current password.', currentInput);
        if (!UI.isValidPassword(values.newPassword)) return fail(UI.passwordRulesText, newInput);
        if (confirmInput.value !== values.newPassword) return fail('The new passwords do not match.', confirmInput);
        if (currentInput && values.newPassword === values.currentPassword) {
            return fail('The new password must be different from your current password.', newInput);
        }

        saving = true;
        const restore = UI.setLoading(submitButton, 'Saving...');
        try {
            const successMessage = await options.onSubmit(values);
            close();
            UI.toast(successMessage || 'Password changed.', { tone: 'success' });
        } catch (error) {
            console.error('Change Password Error:', error);
            restore();
            fail(error.message || 'The password could not be changed. Please try again.');
        } finally {
            saving = false;
        }
    });

    closeButton.addEventListener('click', requestClose);
    cancelButton.addEventListener('click', requestClose);
    modal.addEventListener('click', event => {
        if (event.target === modal) requestClose();
    });

    passwordFormKeydownHandler = event => {
        // A confirmation dialog on top of the form handles its own keys.
        if (document.getElementById('customDialog')) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            requestClose();
        } else if (event.key === 'Tab') {
            trapFocus(event, content);
        }
    };
    document.addEventListener('keydown', passwordFormKeydownHandler);

    (typedFields[0] || newInput).focus();
}

/* =========================
   OWN PASSWORD (profile menu)
========================= */
document.querySelector('[data-action="change-password"]')?.addEventListener('click', changeOwnPassword);

function changeOwnPassword() {
    setProfileCardOpen(false);
    document.querySelector('.profile-icon')?.focus();
    openOwnPasswordForm();
}

// Any signed-in user, owner or staff, for their own password only. Nobody can set another
// account's password; a forgotten one is reset with Forgot Password on the login page.
// index.js saves the username at login; sessions from before that was added type it in instead.
function openOwnPasswordForm() {
    openPasswordForm({
        title: 'Change Password',
        description: 'Enter your current password, then choose a new one.',
        username: localStorage.getItem('userUsername') || '',
        askCurrent: true,
        onSubmit: async values => {
            const result = await UI.fetchJson('/api/Auth/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(values)
            });
            localStorage.setItem('userUsername', values.username);
            return result?.message;
        }
    });
}
