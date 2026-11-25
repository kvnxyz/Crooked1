using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using Crooked.Models;
using Crooked.Services;
using System.Collections.Generic;
using System.Security.Claims;
using System;

namespace Crooked.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class AuthController : ControllerBase
    {
        // Tinatawag nya yung connection string mula sa DatabaseConfig.cs
        private readonly string _connectionString = DatabaseConfig.ConnectionString;

        private readonly EmailSender _email;

        public AuthController(EmailSender email)
        {
            _email = email;
        }

        // Same text as UI.passwordRulesText in ui.js, which the forms show before sending.
        private const string WeakPasswordMessage =
            "Password must be 8 to 64 characters, with an uppercase letter, a lowercase letter, a number and a symbol, and no spaces.";

        private const string FullNameClaim = SessionClaims.FullName;

        // An account on the Accounts page. Role is in lower case, like the session's role claim;
        // Email is empty when the account has none yet.
        private sealed record Account(int Id, string Username, string FullName, string Role, string Email);

        private const string AccountColumns =
            "id, username, COALESCE(full_name, username), COALESCE(lower(role), ''), COALESCE(email, '')";

        private static Account ReadAccount(NpgsqlDataReader reader) =>
            new(Convert.ToInt32(reader.GetValue(0)), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4));

        private static Account? FindAccount(NpgsqlConnection connection, int id)
        {
            using var command = new NpgsqlCommand($"SELECT {AccountColumns} FROM users WHERE id = @id", connection);
            command.Parameters.AddWithValue("@id", id);
            using var reader = command.ExecuteReader();
            return reader.Read() ? ReadAccount(reader) : null;
        }

        // The active account that uses this email (already normalised by EmailPolicy), if any.
        private static async Task<Account?> FindActiveAccountByEmailAsync(NpgsqlConnection connection, string email)
        {
            await using var command = new NpgsqlCommand(
                $"SELECT {AccountColumns} FROM users WHERE lower(email) = @email AND is_active = TRUE LIMIT 1", connection);
            command.Parameters.AddWithValue("@email", email);
            await using var reader = await command.ExecuteReaderAsync();
            return await reader.ReadAsync() ? ReadAccount(reader) : null;
        }

        // Whether an account other than exceptId already uses this email, archived accounts included.
        private static bool EmailTaken(NpgsqlConnection connection, string email, int? exceptId = null)
        {
            using var command = new NpgsqlCommand(
                "SELECT EXISTS (SELECT 1 FROM users WHERE lower(email) = @email AND id <> @except)", connection);
            command.Parameters.AddWithValue("@email", email);
            command.Parameters.AddWithValue("@except", exceptId ?? -1);
            return command.ExecuteScalar() is true;
        }

        private bool IsSignedInAs(Account account) => account.Username == User.Identity?.Name;

        // An Accounts-page change, logged under the signed-in owner's name.
        private void LogAccountChange(NpgsqlConnection connection, string action) =>
            ActivityLog.Write(connection, SessionClaims.FullNameOf(User), ActivityTypes.Account, action);

        [AllowAnonymous]
        [HttpPost("login")]
        [LiveUpdate(LiveTopics.Activity)]
        public async Task<IActionResult> Login([FromBody] User loginRequest)
        {
            try
            {
                using (var connection = new NpgsqlConnection(_connectionString))
                {
                    connection.Open();

                    string sql = "SELECT username, role, full_name FROM users WHERE username = @user AND password = @pass AND is_active = true";
                    using (var cmd = new NpgsqlCommand(sql, connection))
                    {
                        cmd.Parameters.AddWithValue("@user", loginRequest.Username);
                        cmd.Parameters.AddWithValue("@pass", loginRequest.Password);

                        using (var reader = cmd.ExecuteReader())
                        {
                            if (reader.Read())
                            {
                                string username = reader["username"].ToString() ?? string.Empty;
                                string role = (reader["role"].ToString() ?? string.Empty).ToLowerInvariant();
                                string fullName = reader["full_name"].ToString() ?? string.Empty;
                                reader.Close();

                                ActivityLog.Write(connection, fullName, ActivityTypes.Login, "Logged into the system");

                                // The session cookie is what the API checks from now on; the role the
                                // browser keeps in localStorage only decides which buttons it shows.
                                var identity = new ClaimsIdentity(new[]
                                {
                                    new Claim(ClaimTypes.Name, username),
                                    new Claim(ClaimTypes.Role, role),
                                    new Claim(FullNameClaim, fullName)
                                }, CookieAuthenticationDefaults.AuthenticationScheme);
                                await HttpContext.SignInAsync(
                                    CookieAuthenticationDefaults.AuthenticationScheme,
                                    new ClaimsPrincipal(identity),
                                    new AuthenticationProperties { IsPersistent = false });

                                return Ok(new { role, fullName });
                            }
                        }
                    }
                }
                return Unauthorized(new { message = "Account archived or invalid credentials." });
            }
            catch (Exception ex)
            {
                Console.WriteLine("Database Error: " + ex.Message);
                return StatusCode(500, new { message = "Database Error: " + ex.Message });
            }
        }

        // Ends the session by deleting the cookie. Anonymous so an expired session can still clear it;
        // only a signed-in user's logout is written to the activity log.
        [AllowAnonymous]
        [HttpPost("logout")]
        [LiveUpdate(LiveTopics.Activity)]
        public async Task<IActionResult> Logout()
        {
            if (User.Identity?.IsAuthenticated == true)
            {
                try
                {
                    using var connection = new NpgsqlConnection(_connectionString);
                    connection.Open();
                    ActivityLog.Write(connection, SessionClaims.FullNameOf(User), ActivityTypes.Login, "Logged out of the system");
                }
                catch (Exception ex)
                {
                    // Logging out must still work when the log can't be written.
                    Console.WriteLine($"Logout Log Error: {ex.Message}");
                }
            }

            await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return NoContent();
        }

        // Who is signed in. session.js calls it when the browser shows a page again from Back/Forward.
        [HttpGet("session")]
        public IActionResult CurrentSession() => Ok(new
        {
            username = User.Identity?.Name,
            role = User.FindFirstValue(ClaimTypes.Role),
            fullName = User.FindFirstValue(FullNameClaim)
        });

        [Authorize(Roles = UserRoles.Owner)]
        [HttpGet("dashboard-stats")]
        public IActionResult GetStats()
        {
            try
            {
                using (var connection = new NpgsqlConnection(_connectionString))
                {
                    connection.Open();
                    var sql = "SELECT COUNT(*) FROM users WHERE is_active = true";
                    using (var cmd = new NpgsqlCommand(sql, connection))
                    {
                        var count = Convert.ToInt32(cmd.ExecuteScalar());
                        return Ok(new { totalUsers = count });
                    }
                }
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = ex.Message });
            }
        }

        // Archives or restores any account except the signed-in one, so there is always an active owner.
        // An archived account's open sessions end at once (AccountSessions).
        [Authorize(Roles = UserRoles.Owner)]
        [HttpPost("toggle-archive/{id}")]
        [LiveUpdate(LiveTopics.Staff, LiveTopics.Activity)]
        public IActionResult ToggleArchive(int id, [FromQuery] bool archive)
        {
            try
            {
                using (var connection = new NpgsqlConnection(_connectionString))
                {
                    connection.Open();

                    var account = FindAccount(connection, id);
                    if (account == null)
                    {
                        return NotFound(new { message = "Account not found." });
                    }
                    if (IsSignedInAs(account))
                    {
                        return BadRequest(new { message = "You can't archive the account you are signed in with." });
                    }

                    const string updateSql = "UPDATE users SET is_active = @status WHERE id = @id";
                    using (var cmd = new NpgsqlCommand(updateSql, connection))
                    {
                        cmd.Parameters.AddWithValue("@status", !archive);
                        cmd.Parameters.AddWithValue("@id", id);
                        cmd.ExecuteNonQuery();
                    }
                    AccountSessions.Forget(account.Username);

                    LogAccountChange(connection, archive ? $"Archived: {account.FullName}" : $"Unarchived: {account.FullName}");
                }

                return Ok(new { message = archive ? "Account archived." : "Account restored." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = ex.Message });
            }
        }

        // Every account for the Accounts page: owners first, then by name. isSelf marks the signed-in
        // account, whose role and archive buttons the page doesn't show.
        [Authorize(Roles = UserRoles.Owner)]
        [HttpGet("get-staff")]
        public IActionResult GetStaff()
        {
            var staffList = new List<object>();
            using (var connection = new NpgsqlConnection(_connectionString))
            {
                connection.Open();
                var sql = @"SELECT id, full_name, username, COALESCE(email, '') AS email, lower(role) AS role, is_active FROM users
                            ORDER BY lower(role) = 'owner' DESC, lower(full_name), id";
                using (var cmd = new NpgsqlCommand(sql, connection))
                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        staffList.Add(new {
                            id = reader["id"],
                            fullName = reader["full_name"],
                            username = reader["username"],
                            email = reader["email"],
                            role = reader["role"],
                            isActive = Convert.ToBoolean(reader["is_active"]),
                            isSelf = reader["username"] as string == User.Identity?.Name
                        });
                    }
                }
            }
            return Ok(staffList);
        }

        // Makes an account an owner or staff. The signed-in owner can't change their own role, so
        // there is always at least one owner. The account's open sessions end at once (AccountSessions),
        // and it gets the new role's pages when it logs in again.
        [Authorize(Roles = UserRoles.Owner)]
        [HttpPost("role/{id}")]
        [LiveUpdate(LiveTopics.Staff, LiveTopics.Activity)]
        public IActionResult ChangeRole(int id, [FromBody] ChangeRoleRequest request)
        {
            var role = UserRoles.Normalize(request.Role);
            if (role == null)
            {
                return BadRequest(new { message = "Choose Owner or Staff." });
            }

            try
            {
                using (var connection = new NpgsqlConnection(_connectionString))
                {
                    connection.Open();

                    var account = FindAccount(connection, id);
                    if (account == null)
                    {
                        return NotFound(new { message = "Account not found." });
                    }
                    if (IsSignedInAs(account))
                    {
                        return BadRequest(new { message = "You can't change the role of the account you are signed in with." });
                    }
                    if (account.Role == role)
                    {
                        return Ok(new { message = $"\"{account.FullName}\" is already {UserRoles.Display(role)}." });
                    }

                    using (var cmd = new NpgsqlCommand("UPDATE users SET role = @role WHERE id = @id", connection))
                    {
                        cmd.Parameters.AddWithValue("@role", role);
                        cmd.Parameters.AddWithValue("@id", id);
                        cmd.ExecuteNonQuery();
                    }
                    AccountSessions.Forget(account.Username);

                    LogAccountChange(connection, $"Changed role: {account.FullName} to {UserRoles.Display(role)}");
                    return Ok(new { message = $"\"{account.FullName}\" is now {UserRoles.Display(role)}." });
                }
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = ex.Message });
            }
        }

        // A new staff account. The email is required, because Forgot Password sends its codes there,
        // and no other account may use it.
        [Authorize(Roles = UserRoles.Owner)]
        [HttpPost("register-staff")]
        [LiveUpdate(LiveTopics.Staff, LiveTopics.Activity)]
        public IActionResult RegisterStaff([FromBody] User request)
        {
            var fullName = request.FullName?.Trim() ?? string.Empty;
            var username = request.Username?.Trim() ?? string.Empty;
            if (fullName.Length == 0 || username.Length == 0 || string.IsNullOrWhiteSpace(request.Email))
            {
                return BadRequest(new { message = "Fill in the full name, username, email and password." });
            }

            var email = EmailPolicy.Normalize(request.Email);
            if (email == null)
            {
                return BadRequest(new { message = EmailPolicy.InvalidMessage });
            }

            if (!PasswordPolicy.IsValid(request.Password))
            {
                return BadRequest(new { message = WeakPasswordMessage });
            }

            try
            {
                using (var connection = new NpgsqlConnection(_connectionString))
                {
                    connection.Open();

                    using (var check = new NpgsqlCommand("SELECT EXISTS (SELECT 1 FROM users WHERE username = @user)", connection))
                    {
                        check.Parameters.AddWithValue("@user", username);
                        if (check.ExecuteScalar() is true)
                        {
                            return BadRequest(new { message = $"The username \"{username}\" is already taken." });
                        }
                    }
                    if (EmailTaken(connection, email))
                    {
                        return BadRequest(new { message = $"Another account already uses {email}." });
                    }

                    var sql = "INSERT INTO users (username, password, role, full_name, email, is_active) VALUES (@user, @pass, 'staff', @name, @email, true)";
                    using (var cmd = new NpgsqlCommand(sql, connection))
                    {
                        cmd.Parameters.AddWithValue("@user", username);
                        cmd.Parameters.AddWithValue("@pass", request.Password);
                        cmd.Parameters.AddWithValue("@name", fullName);
                        cmd.Parameters.AddWithValue("@email", email);
                        cmd.ExecuteNonQuery();
                    }
                    LogAccountChange(connection, $"Created staff account: {fullName} ({username})");
                }
                return Ok(new { message = "Staff account created successfully." });
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
            {
                // Another owner created the same username or email a moment ago.
                return BadRequest(new { message = "That username or email is already used by another account." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = ex.Message });
            }
        }

        // Sets or changes an account's email, where Forgot Password sends its codes. A code sent
        // to the old email stops working.
        [Authorize(Roles = UserRoles.Owner)]
        [HttpPost("email/{id}")]
        [LiveUpdate(LiveTopics.Staff, LiveTopics.Activity)]
        public IActionResult SetEmail(int id, [FromBody] SetEmailRequest request)
        {
            var email = EmailPolicy.Normalize(request.Email);
            if (email == null)
            {
                return BadRequest(new { message = EmailPolicy.InvalidMessage });
            }

            try
            {
                using (var connection = new NpgsqlConnection(_connectionString))
                {
                    connection.Open();

                    var account = FindAccount(connection, id);
                    if (account == null)
                    {
                        return NotFound(new { message = "Account not found." });
                    }
                    if (string.Equals(account.Email, email, StringComparison.OrdinalIgnoreCase))
                    {
                        return Ok(new { message = $"\"{account.FullName}\" already uses {email}." });
                    }
                    if (EmailTaken(connection, email, id))
                    {
                        return BadRequest(new { message = $"Another account already uses {email}." });
                    }

                    using (var cmd = new NpgsqlCommand("UPDATE users SET email = @email WHERE id = @id", connection))
                    {
                        cmd.Parameters.AddWithValue("@email", email);
                        cmd.Parameters.AddWithValue("@id", id);
                        cmd.ExecuteNonQuery();
                    }
                    PasswordResetCodes.Delete(connection, id);

                    LogAccountChange(connection, account.Email.Length == 0
                        ? $"Added email: {account.FullName}"
                        : $"Changed email: {account.FullName}");
                    return Ok(new { message = $"The email for \"{account.FullName}\" is now {email}." });
                }
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
            {
                return BadRequest(new { message = $"Another account already uses {email}." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = ex.Message });
            }
        }

        // Any signed-in user (owner or staff) changing their own password; the current one must match.
        [HttpPost("change-password")]
        [LiveUpdate(LiveTopics.Activity)]
        public IActionResult ChangePassword([FromBody] ChangePasswordRequest request)
        {
            // Always the signed-in account; the username sent in the form is not trusted.
            var username = User.Identity?.Name ?? string.Empty;

            if (string.IsNullOrEmpty(request.CurrentPassword))
            {
                return BadRequest(new { message = "Enter your current password." });
            }

            if (!PasswordPolicy.IsValid(request.NewPassword))
            {
                return BadRequest(new { message = WeakPasswordMessage });
            }

            if (request.NewPassword == request.CurrentPassword)
            {
                return BadRequest(new { message = "The new password must be different from your current password." });
            }

            try
            {
                using (var connection = new NpgsqlConnection(_connectionString))
                {
                    connection.Open();
                    string? fullName;

                    const string updateSql = @"UPDATE users SET password = @newPass
                        WHERE username = @user AND password = @currentPass AND is_active = true
                        RETURNING full_name";
                    using (var cmd = new NpgsqlCommand(updateSql, connection))
                    {
                        cmd.Parameters.AddWithValue("@newPass", request.NewPassword);
                        cmd.Parameters.AddWithValue("@user", username);
                        cmd.Parameters.AddWithValue("@currentPass", request.CurrentPassword);
                        fullName = cmd.ExecuteScalar()?.ToString();
                    }

                    if (fullName == null)
                    {
                        return BadRequest(new { message = "Your current password is incorrect." });
                    }

                    ActivityLog.Write(connection, fullName, ActivityTypes.Account, "Changed their password");
                }

                return Ok(new { message = "Your password has been changed." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = ex.Message });
            }
        }

        // The owner setting another account's password from the Accounts page, without its current
        // password. The signed-in account changes its own password with change-password instead.
        [Authorize(Roles = UserRoles.Owner)]
        [HttpPost("staff-password/{id}")]
        [LiveUpdate(LiveTopics.Activity)]
        public IActionResult SetStaffPassword(int id, [FromBody] SetPasswordRequest request)
        {
            if (!PasswordPolicy.IsValid(request.NewPassword))
            {
                return BadRequest(new { message = WeakPasswordMessage });
            }

            try
            {
                using (var connection = new NpgsqlConnection(_connectionString))
                {
                    connection.Open();

                    var account = FindAccount(connection, id);
                    if (account == null)
                    {
                        return NotFound(new { message = "Account not found." });
                    }
                    if (IsSignedInAs(account))
                    {
                        return BadRequest(new { message = "Change your own password with your current password instead." });
                    }

                    using (var cmd = new NpgsqlCommand("UPDATE users SET password = @newPass WHERE id = @id", connection))
                    {
                        cmd.Parameters.AddWithValue("@newPass", request.NewPassword);
                        cmd.Parameters.AddWithValue("@id", id);
                        cmd.ExecuteNonQuery();
                    }

                    LogAccountChange(connection, $"Changed password: {account.FullName}");
                    return Ok(new { message = $"The password for \"{account.FullName}\" has been changed." });
                }
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = ex.Message });
            }
        }

        /* =========================
           FORGOT PASSWORD (login page, so no session is needed)
           Step 1 emails a 5-letter code to the account; step 2 checks it and sets the new password.
           Owners and staff both use it. Codes expire after 5 minutes (PasswordResetCodes).
        ========================= */

        // Step 1. The answer is the same whether or not an active account uses the email, so the
        // form can't be used to find out which emails have accounts.
        [AllowAnonymous]
        [HttpPost("forgot-password")]
        public async Task<IActionResult> ForgotPassword([FromBody] ForgotPasswordRequest request)
        {
            var email = EmailPolicy.Normalize(request.Email);
            if (email == null)
            {
                return BadRequest(new { message = EmailPolicy.InvalidMessage });
            }
            if (!_email.Enabled)
            {
                return StatusCode(503, new { message = "Password reset emails aren't set up on the server yet. Ask the owner to reset your password." });
            }

            var sent = new
            {
                message = $"If an active account uses {email}, a 5-letter code is on its way. It expires in {PasswordResetCodes.ValidMinutes} minutes.",
                resendSeconds = PasswordResetCodes.ResendSeconds
            };

            try
            {
                await using var connection = new NpgsqlConnection(_connectionString);
                await connection.OpenAsync();

                var account = await FindActiveAccountByEmailAsync(connection, email);
                if (account == null)
                {
                    return Ok(sent);
                }

                // Null when a code was sent less than a minute ago; that code still works.
                var code = PasswordResetCodes.Create(connection, account.Id);
                if (code == null)
                {
                    return Ok(sent);
                }

                var (subject, text, html) = PasswordResetCodes.Email(account.FullName, account.Username, code);
                try
                {
                    await _email.SendAsync(email, subject, text, html);
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Forgot Password Email Error: {ex.Message}");
                    // So the person can ask again straight away.
                    PasswordResetCodes.Delete(connection, account.Id);
                    return StatusCode(502, new { message = "The code couldn't be emailed. Please try again in a few minutes." });
                }

                return Ok(sent);
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = ex.Message });
            }
        }

        // Step 2. Wrong tries are counted even though the password isn't changed; after 5 the code
        // stops working.
        [AllowAnonymous]
        [HttpPost("reset-password")]
        [LiveUpdate(LiveTopics.Activity)]
        public async Task<IActionResult> ResetPassword([FromBody] ResetRequest request)
        {
            var email = EmailPolicy.Normalize(request.Email);
            if (email == null)
            {
                return BadRequest(new { message = EmailPolicy.InvalidMessage });
            }

            var code = PasswordResetCodes.Normalize(request.Code);
            if (code == null)
            {
                return BadRequest(new { message = $"Enter the {PasswordResetCodes.Length}-letter code from the email." });
            }

            if (!PasswordPolicy.IsValid(request.NewPassword))
            {
                return BadRequest(new { message = WeakPasswordMessage });
            }

            try
            {
                await using var connection = new NpgsqlConnection(_connectionString);
                await connection.OpenAsync();
                await using var transaction = await connection.BeginTransactionAsync();

                var account = await FindActiveAccountByEmailAsync(connection, email);
                var (result, triesLeft) = account == null
                    ? (PasswordResetCodes.Result.Missing, 0)
                    : await PasswordResetCodes.UseAsync(connection, transaction, account.Id, code);

                if (account == null || result != PasswordResetCodes.Result.Valid)
                {
                    // Keeps the counted try, or the deleted expired code.
                    await transaction.CommitAsync();
                    return BadRequest(new
                    {
                        message = result switch
                        {
                            PasswordResetCodes.Result.Expired => "That code has expired. Send a new code and try again.",
                            PasswordResetCodes.Result.TooManyTries => "Too many incorrect tries. Send a new code and try again.",
                            PasswordResetCodes.Result.Wrong =>
                                $"That code is incorrect. {triesLeft} {(triesLeft == 1 ? "try" : "tries")} left.",
                            _ => "That code is incorrect or has expired. Send a new code and try again."
                        }
                    });
                }

                await using (var update = new NpgsqlCommand(
                    "UPDATE users SET password = @newPass WHERE id = @id", connection, transaction))
                {
                    update.Parameters.AddWithValue("@newPass", request.NewPassword);
                    update.Parameters.AddWithValue("@id", account.Id);
                    await update.ExecuteNonQueryAsync();
                }

                await ActivityLog.WriteAsync(connection, transaction, account.FullName, ActivityTypes.Account,
                    "Reset their password with an email code");
                await transaction.CommitAsync();

                // The login form fills in the username, which the person may have forgotten too.
                return Ok(new { message = "Password updated. Please log in with your new password.", username = account.Username });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = ex.Message });
            }
        }
    }
}