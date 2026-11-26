using Npgsql;
using Crooked.Models;

namespace Crooked.Services
{
    // Consecutive failed logins per account (users.failed_login_attempts) and the lock they lead to
    // (users.locked_until), following LoginLockout. The times come from the database clock (NOW()).
    public static class LoginAttempts
    {
        // Counts a wrong password for an account that isn't locked. Returns how many tries are left,
        // or Locked = true when this try locked the account (the count then starts again at 0, so the
        // account gets a fresh set of tries once the lock ends). Two wrong tries at the same moment
        // can't undo each other's lock: an account that is already locked isn't changed.
        public static async Task<(bool Locked, int TriesLeft)> RecordFailureAsync(
            NpgsqlConnection connection, int userId, NpgsqlTransaction? transaction = null)
        {
            await using var command = new NpgsqlCommand(@"
                UPDATE users
                SET failed_login_attempts = CASE WHEN failed_login_attempts + 1 >= @max THEN 0
                                                 ELSE failed_login_attempts + 1 END,
                    locked_until = CASE WHEN failed_login_attempts + 1 >= @max THEN NOW() + @minutes * INTERVAL '1 minute'
                                        ELSE NULL END
                WHERE id = @id AND (locked_until IS NULL OR locked_until <= NOW())
                RETURNING failed_login_attempts, locked_until IS NOT NULL", connection, transaction);
            command.Parameters.AddWithValue("@max", LoginLockout.MaxFailedAttempts);
            command.Parameters.AddWithValue("@minutes", LoginLockout.LockMinutes);
            command.Parameters.AddWithValue("@id", userId);
            await using var reader = await command.ExecuteReaderAsync();

            // No row: another try locked the account a moment ago.
            if (!await reader.ReadAsync()) return (true, 0);
            var locked = reader.GetBoolean(1);
            return (locked, locked ? 0 : LoginLockout.MaxFailedAttempts - reader.GetInt32(0));
        }

        // A successful login, an owner's unlock or a Forgot Password reset: the count starts again and
        // any lock ends.
        public static async Task ClearAsync(NpgsqlConnection connection, int userId, NpgsqlTransaction? transaction = null)
        {
            await using var command = new NpgsqlCommand(@"
                UPDATE users SET failed_login_attempts = 0, locked_until = NULL
                WHERE id = @id AND (failed_login_attempts <> 0 OR locked_until IS NOT NULL)", connection, transaction);
            command.Parameters.AddWithValue("@id", userId);
            await command.ExecuteNonQueryAsync();
        }
    }
}
