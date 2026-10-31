/* =========================
   STAFF
========================= */
function staffRow(member) {
    const button = UI.el('button', `btn btn-sm ${member.isActive ? 'btn-danger-outline' : 'btn-secondary'}`);
    button.type = 'button';
    button.append(member.isActive ? 'Archive' : 'Unarchive', UI.el('span', 'visually-hidden', ` ${member.fullName}`));
    button.addEventListener('click', () => member.isActive
        ? archiveStaff(member.id, member.fullName)
        : unarchiveStaff(member.id, member.fullName));

    const row = document.createElement('tr');
    row.append(UI.cell(member.fullName), UI.cell(member.username, 'col-muted'), UI.cell(button));
    return row;
}

async function fetchStaff({ quiet = false } = {}) {
    const staffBody = document.getElementById('staffTableBody');
    const archiveBody = document.getElementById('archiveTableBody');
    if (!staffBody || !archiveBody) return;
    if (!quiet) {
        UI.tableSkeleton(staffBody, 3, 4);
        UI.tableSkeleton(archiveBody, 3, 2);
    }

    try {
        const staff = await UI.fetchJson(`${apiBase}/api/Auth/get-staff`);
        const active = staff.filter(member => member.isActive);
        const archived = staff.filter(member => !member.isActive);

        if (active.length) UI.fillTable(staffBody, active.map(staffRow), { fade: !quiet });
        else UI.tableMessage(staffBody, 3, {
            icon: 'fa-user-plus',
            title: 'No active staff accounts',
            message: 'Create an account above to give a staff member access.'
        });

        if (archived.length) UI.fillTable(archiveBody, archived.map(staffRow), { fade: !quiet });
        else UI.tableMessage(archiveBody, 3, { icon: 'fa-box-archive', title: 'No archived accounts' });
    } catch (error) {
        console.error('Staff Error:', error);
        UI.tableMessage(staffBody, 3, {
            isError: true,
            title: 'Unable to load staff accounts',
            message: error.message,
            actionLabel: 'Try again',
            onAction: () => fetchStaff()
        });
        UI.tableMessage(archiveBody, 3, { isError: true, title: 'Unable to load archived accounts' });
    }
}

/* =========================
   ARCHIVE STAFF
========================= */
async function archiveStaff(id, staffName) {
    showDialog(
        'Archive Staff Member',
        `Are you sure you want to archive "${staffName}"?`,
        async () => {
            try {
                const response = await fetch(`${apiBase}/api/Auth/toggle-archive/${id}?archive=true`, {
                    method: 'POST'
                });

                if (response.ok) {
                    showDialog('Staff Archived', `"${staffName}" has been archived.`);
                    fetchStaff();
                } else {
                    const errorData = await response.json().catch(() => ({}));
                    showDialog('Archive Failed', errorData.message || 'Failed to archive staff member.');
                }
            } catch (error) {
                console.error('Archive Staff Error:', error);
                showDialog('Connection Error', 'Cannot connect to the server.');
            }
        },
        null,
        { confirmText: 'Archive', danger: true }
    );
}

async function unarchiveStaff(id, staffName) {
    showDialog(
        'Unarchive Staff Member',
        `Are you sure you want to unarchive "${staffName}"?`,
        async () => {
            try {
                const response = await fetch(`${apiBase}/api/Auth/toggle-archive/${id}?archive=false`, {
                    method: 'POST'
                });

                if (response.ok) {
                    showDialog('Staff Restored', `"${staffName}" has been unarchived.`);
                    fetchStaff();
                } else {
                    const errorData = await response.json().catch(() => ({}));
                    showDialog('Restore Failed', errorData.message || 'Failed to unarchive staff member.');
                }
            } catch (error) {
                console.error('Unarchive Staff Error:', error);
                showDialog('Connection Error', 'Cannot connect to the server.');
            }
        },
        null,
        { confirmText: 'Unarchive' }
    );
}

/* =========================
   ADD STAFF
========================= */
async function addStaff(event) {
    event?.preventDefault();
    const passwordInput = document.getElementById('staffPass');
    const fullName = document.getElementById('staffName').value.trim();
    const username = document.getElementById('staffUser').value.trim();
    // Not trimmed: spaces break the password rules, so they are shown instead of removed.
    const password = passwordInput.value;

    if (!fullName || !username || !password) {
        showToast('Please fill in all fields.', true);
        return;
    }

    if (!UI.isValidPassword(password)) {
        passwordInput.setAttribute('aria-invalid', 'true');
        passwordInput.focus();
        showDialog('Password Too Weak', 'The password does not meet all the rules listed under the form.');
        return;
    }
    passwordInput.removeAttribute('aria-invalid');

    showDialog(
        'Create Staff Account',
        `Create a staff account for "${fullName}" with the username "${username}"?`,
        () => submitStaffAccount(fullName, username, password),
        null,
        { confirmText: 'Create Account' }
    );
}

async function submitStaffAccount(fullName, username, password) {
    try {
        const response = await fetch(`${apiBase}/api/Auth/register-staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, username, password })
        });

        if (response.ok) {
            showToast('Staff account created successfully.', false);
            // reset() also clears the ticks on the password rules.
            document.getElementById('staffPass').form.reset();
            fetchStaff();
        } else {
            const err = await response.json().catch(() => ({}));
            showToast('Error: ' + (err.message || `Account could not be created (${response.status}).`), true);
        }
    } catch (error) {
        console.error('Create Staff Error:', error);
        showToast('Cannot connect to the server.', true);
    }
}

/* =========================
   PAGE LOAD
========================= */
document.addEventListener('DOMContentLoaded', () => {
    UI.passwordChecklist(document.getElementById('staffPass'), document.getElementById('staffPassRules'));
    fetchStaff();
    Live.on(['staff'], () => fetchStaff({ quiet: true }));
});
