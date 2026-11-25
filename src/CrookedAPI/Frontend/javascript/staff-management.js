/* =========================
   ACCOUNTS
   Active accounts: Name, User, Email, Role, Password, Archive. Archived accounts: Name, User, Role, Archive.
   The signed-in owner's own row has no role dropdown or archive button, so there is always an owner.
   Forgot Password (login page) sends its codes to the account's email.
========================= */
const ROLE_NAMES = { owner: 'Owner', staff: 'Staff' };

function roleName(role) {
    return ROLE_NAMES[role] || 'Staff';
}

function nameCell(member) {
    if (!member.isSelf) return UI.cell(member.fullName);
    const name = UI.el('div', 'account-name');
    name.append(UI.el('span', null, member.fullName), UI.badge('You', 'info'));
    return UI.cell(name);
}

function roleCell(member) {
    if (!member.isActive || member.isSelf) return UI.cell(roleName(member.role), 'col-muted');

    const select = UI.el('select', 'role-select');
    select.id = `role-${member.id}`;
    select.setAttribute('aria-label', `Role for ${member.fullName}`);
    Object.entries(ROLE_NAMES).forEach(([value, label]) => select.add(new Option(label, value)));
    select.value = member.role in ROLE_NAMES ? member.role : 'staff';
    select.addEventListener('change', () => changeRole(member, select));
    return UI.cell(select);
}

// Accounts made before emails were required show "No email" until the owner adds one.
function emailCell(member) {
    const content = UI.el('div', 'account-email');
    content.appendChild(member.email
        ? UI.el('span', 'account-email-address', member.email)
        : UI.badge('No email', 'warning'));

    const button = UI.el('button', 'btn btn-sm btn-secondary');
    button.type = 'button';
    button.id = `email-${member.id}`;
    button.append(member.email ? 'Change' : 'Add Email', UI.el('span', 'visually-hidden', ` email for ${member.fullName}`));
    button.addEventListener('click', () => openEmailForm(member));
    content.appendChild(button);
    return UI.cell(content, 'col-wrap');
}

function passwordCell(member) {
    const button = UI.el('button', 'btn btn-sm btn-secondary');
    button.type = 'button';
    button.append('Change Password', UI.el('span', 'visually-hidden', ` for ${member.fullName}`));
    // The owner's own password needs the current one, like the profile menu (account.js).
    button.addEventListener('click', () => member.isSelf ? openOwnPasswordForm() : changeAccountPassword(member));
    return UI.cell(button);
}

function archiveCell(member) {
    if (member.isSelf) {
        const dash = UI.el('span', null, '—');
        dash.setAttribute('aria-hidden', 'true');
        const note = UI.el('span', 'col-muted');
        note.append(dash, UI.el('span', 'visually-hidden', "You can't archive your own account"));
        return UI.cell(note);
    }

    const button = UI.el('button', `btn btn-sm ${member.isActive ? 'btn-danger-outline' : 'btn-secondary'}`);
    button.type = 'button';
    button.append(member.isActive ? 'Archive' : 'Unarchive', UI.el('span', 'visually-hidden', ` ${member.fullName}`));
    button.addEventListener('click', () => setArchived(member, member.isActive));
    return UI.cell(button);
}

function activeRow(member) {
    const row = document.createElement('tr');
    row.append(
        nameCell(member), UI.cell(member.username, 'col-muted'), emailCell(member),
        roleCell(member), passwordCell(member), archiveCell(member)
    );
    return row;
}

// An archived account can't log in until it is unarchived, so it has no password or role controls.
function archivedRow(member) {
    const row = document.createElement('tr');
    row.append(nameCell(member), UI.cell(member.username, 'col-muted'), roleCell(member), archiveCell(member));
    return row;
}

async function fetchStaff({ quiet = false } = {}) {
    const staffBody = document.getElementById('staffTableBody');
    const archiveBody = document.getElementById('archiveTableBody');
    if (!staffBody || !archiveBody) return;
    if (!quiet) {
        UI.tableSkeleton(staffBody, 6, 4);
        UI.tableSkeleton(archiveBody, 4, 2);
    }

    try {
        const staff = await UI.fetchJson(`${apiBase}/api/Auth/get-staff`);
        const active = staff.filter(member => member.isActive);
        const archived = staff.filter(member => !member.isActive);

        if (active.length) UI.fillTable(staffBody, active.map(activeRow), { fade: !quiet });
        else UI.tableMessage(staffBody, 6, {
            icon: 'fa-user-plus',
            title: 'No active accounts',
            message: 'Create an account above to give a staff member access.'
        });

        if (archived.length) UI.fillTable(archiveBody, archived.map(archivedRow), { fade: !quiet });
        else UI.tableMessage(archiveBody, 4, { icon: 'fa-box-archive', title: 'No archived accounts' });
    } catch (error) {
        console.error('Staff Error:', error);
        UI.tableMessage(staffBody, 6, {
            isError: true,
            title: 'Unable to load accounts',
            message: error.message,
            actionLabel: 'Try again',
            onAction: () => fetchStaff()
        });
        UI.tableMessage(archiveBody, 4, { isError: true, title: 'Unable to load archived accounts' });
    }
}

/* =========================
   ROLE
========================= */
function changeRole(member, select) {
    const role = select.value;
    const toOwner = role === 'owner';
    showDialog(
        'Change Role',
        toOwner
            ? `Make "${member.fullName}" an owner? Owners can open every page, including Accounts, Discounts and Products. If they are signed in, they will need to log in again.`
            : `Change "${member.fullName}" to staff? They will lose access to the owner pages. If they are signed in, they will need to log in again.`,
        () => submitRole(member, select, role),
        () => { select.value = member.role; },
        { confirmText: toOwner ? 'Make Owner' : 'Change to Staff', danger: !toOwner }
    );
}

async function submitRole(member, select, role) {
    select.disabled = true;
    try {
        const result = await UI.fetchJson(`${apiBase}/api/Auth/role/${member.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role })
        });
        showToast(result?.message || 'The role has been changed.', false);
    } catch (error) {
        console.error('Change Role Error:', error);
        showToast(error.status ? error.message : 'Cannot connect to the server.', true);
    }
    // The rows are rebuilt either way, so focus goes back to this account's new dropdown.
    await fetchStaff({ quiet: true });
    document.getElementById(select.id)?.focus();
}

/* =========================
   ARCHIVE
========================= */
// An archived account can't log in, and its open sessions end straight away.
function setArchived(member, archive) {
    const action = archive ? 'Archive' : 'Unarchive';
    showDialog(
        `${action} Account`,
        archive
            ? `Are you sure you want to archive "${member.fullName}"? They won't be able to log in, and they will be signed out if they are signed in.`
            : `Are you sure you want to unarchive "${member.fullName}"?`,
        async () => {
            try {
                await UI.fetchJson(`${apiBase}/api/Auth/toggle-archive/${member.id}?archive=${archive}`, { method: 'POST' });
                showDialog(
                    archive ? 'Account Archived' : 'Account Restored',
                    `"${member.fullName}" has been ${archive ? 'archived' : 'unarchived'}.`
                );
                fetchStaff();
            } catch (error) {
                console.error(`${action} Account Error:`, error);
                showDialog(
                    error.status ? `${action} Failed` : 'Connection Error',
                    error.status ? error.message : 'Cannot connect to the server.'
                );
            }
        },
        null,
        { confirmText: action, danger: archive }
    );
}

/* =========================
   CHANGE PASSWORD
========================= */
// The owner sets another account's password without needing the old one (account.js builds the form).
function changeAccountPassword(member) {
    openPasswordForm({
        title: 'Change Password',
        description: `Choose a new password for ${member.fullName} (${member.username}).`,
        onSubmit: async ({ newPassword }) => {
            const result = await UI.fetchJson(`${apiBase}/api/Auth/staff-password/${member.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newPassword })
            });
            return result?.message;
        }
    });
}

/* =========================
   EMAIL
========================= */
// Where Forgot Password sends the account's codes. Saving it stops any code sent to the old email.
const emailModal = document.getElementById('emailModal');
const emailForm = document.getElementById('emailForm');
const emailInput = document.getElementById('accountEmail');
const emailError = document.getElementById('emailFormError');
let emailMember = null;
let emailSaving = false;

function openEmailForm(member) {
    emailMember = member;
    document.getElementById('emailModalTitle').textContent = member.email ? 'Change Email' : 'Add Email';
    document.getElementById('emailModalNote').textContent =
        `Forgot Password sends ${member.fullName}'s reset codes (${member.username}) to this email.`;
    emailInput.value = member.email || '';
    emailInput.removeAttribute('aria-invalid');
    emailError.textContent = '';
    openModalElement(emailModal, requestCloseEmailForm);
}

function closeEmailForm() {
    closeModalElement(emailModal);
    emailMember = null;
}

function requestCloseEmailForm() {
    if (emailSaving) return;
    if (emailInput.value.trim() === (emailMember?.email || '')) {
        closeEmailForm();
        return;
    }
    showDialog(
        'Discard Changes?',
        'You have unsaved changes in this form. Close it and discard them?',
        closeEmailForm,
        null,
        { confirmText: 'Discard', danger: true }
    );
}

async function saveEmail(event) {
    event.preventDefault();
    if (emailSaving || !emailMember) return;

    const email = emailInput.value.trim();
    if (!UI.isValidEmail(email)) {
        emailInput.setAttribute('aria-invalid', 'true');
        emailInput.focus();
        emailError.textContent = UI.emailRulesText;
        return;
    }
    if (email.toLowerCase() === (emailMember.email || '').toLowerCase()) {
        closeEmailForm();
        return;
    }

    const member = emailMember;
    emailSaving = true;
    emailError.textContent = '';
    const restore = UI.setLoading(emailForm.querySelector('[type="submit"]'), 'Saving...');
    try {
        const result = await UI.fetchJson(`${apiBase}/api/Auth/email/${member.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        restore();
        emailSaving = false;
        closeEmailForm();
        showToast(result?.message || 'The email has been saved.', false);
        await fetchStaff({ quiet: true });
        // The rows are rebuilt, so focus goes to this account's new email button.
        document.getElementById(`email-${member.id}`)?.focus();
    } catch (error) {
        console.error('Save Email Error:', error);
        restore();
        emailSaving = false;
        emailError.textContent = error.status ? error.message : 'Cannot connect to the server.';
        emailInput.focus();
    }
}

/* =========================
   ADD STAFF
========================= */
async function addStaff(event) {
    event?.preventDefault();
    const passwordInput = document.getElementById('staffPass');
    const emailField = document.getElementById('staffEmail');
    const fullName = document.getElementById('staffName').value.trim();
    const username = document.getElementById('staffUser').value.trim();
    const email = emailField.value.trim();
    // Not trimmed: spaces break the password rules, so they are reported instead of removed.
    const password = passwordInput.value;

    if (!fullName || !username || !email || !password) {
        showToast('Please fill in all fields.', true);
        return;
    }

    if (!UI.isValidEmail(email)) {
        emailField.setAttribute('aria-invalid', 'true');
        emailField.focus();
        showDialog('Invalid Email', UI.emailRulesText);
        return;
    }
    emailField.removeAttribute('aria-invalid');

    if (!UI.isValidPassword(password)) {
        passwordInput.setAttribute('aria-invalid', 'true');
        passwordInput.focus();
        showDialog('Password Too Weak', UI.passwordRulesText);
        return;
    }
    passwordInput.removeAttribute('aria-invalid');

    showDialog(
        'Create Staff Account',
        `Create a staff account for "${fullName}" with the username "${username}" and the email ${email}?`,
        () => submitStaffAccount(fullName, username, email, password),
        null,
        { confirmText: 'Create Account' }
    );
}

async function submitStaffAccount(fullName, username, email, password) {
    try {
        const result = await UI.fetchJson(`${apiBase}/api/Auth/register-staff`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fullName, username, email, password })
        });
        showToast(result?.message || 'Staff account created successfully.', false);
        document.getElementById('staffForm').reset();
        fetchStaff();
    } catch (error) {
        console.error('Create Staff Error:', error);
        showToast(error.status ? `Error: ${error.message}` : 'Cannot connect to the server.', true);
    }
}

/* =========================
   PAGE LOAD
========================= */
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('staffForm')?.addEventListener('submit', addStaff);
    emailForm.addEventListener('submit', saveEmail);
    emailInput.addEventListener('input', () => emailInput.removeAttribute('aria-invalid'));
    emailModal.querySelectorAll('[data-close-modal]').forEach(button => {
        button.addEventListener('click', requestCloseEmailForm);
    });
    emailModal.addEventListener('click', event => {
        if (event.target === emailModal) requestCloseEmailForm();
    });
    fetchStaff();
    Live.on(['staff'], () => fetchStaff({ quiet: true }));
});
