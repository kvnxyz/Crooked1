using System.Net;
using System.Security.Cryptography;
using System.Text;
using Npgsql;

namespace Crooked.Services
{
    // Forgot Password codes (table password_reset_codes): 5 capital letters, emailed to the account,
    // valid for 5 minutes and 5 tries. An account has at most one code; a new one replaces it.
    // Only a hash of each code is stored.
    public static class PasswordResetCodes
    {
        public const int Length = 5;
        public const int ValidMinutes = 5;
        public const int MaxAttempts = 5;
        // How long before the same account can be sent another code. index.js waits as long
        // before it shows "Send a new code" again.
        public const int ResendSeconds = 60;

        public enum Result { Valid, Missing, Expired, Wrong, TooManyTries }

        // The code in capitals, or null when it isn't 5 letters.
        public static string? Normalize(string? code)
        {
            var value = code?.Trim().ToUpperInvariant();
            return value is { Length: Length } && value.All(char.IsAsciiLetterUpper) ? value : null;
        }

        // Makes a new code for the account and returns it. Returns null, and keeps the current
        // code, when one was sent less than ResendSeconds ago.
        public static string? Create(NpgsqlConnection connection, int userId)
        {
            var code = string.Create(Length, 0, (letters, _) =>
            {
                for (var i = 0; i < letters.Length; i++)
                {
                    letters[i] = (char)('A' + RandomNumberGenerator.GetInt32(26));
                }
            });

            const string sql = @"
                INSERT INTO password_reset_codes (user_id, code_hash, expires_at, attempts, created_at)
                VALUES (@user, @hash, NOW() + @minutes * INTERVAL '1 minute', 0, NOW())
                ON CONFLICT (user_id) DO UPDATE
                SET code_hash = EXCLUDED.code_hash,
                    expires_at = EXCLUDED.expires_at,
                    attempts = 0,
                    created_at = NOW()
                WHERE password_reset_codes.created_at <= NOW() - @resend * INTERVAL '1 second'";
            using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue("@user", userId);
            command.Parameters.AddWithValue("@hash", Hash(userId, code));
            command.Parameters.AddWithValue("@minutes", ValidMinutes);
            command.Parameters.AddWithValue("@resend", ResendSeconds);
            return command.ExecuteNonQuery() == 1 ? code : null;
        }

        // Checks a code inside the caller's transaction, which must be committed whatever the
        // result, so wrong tries are counted. A valid code is used up; an expired code or one with
        // too many wrong tries is deleted, so a new one can be sent straight away.
        public static async Task<(Result Result, int TriesLeft)> UseAsync(
            NpgsqlConnection connection, NpgsqlTransaction transaction, int userId, string code)
        {
            string storedHash;
            bool expired;
            int attempts;

            await using (var select = new NpgsqlCommand(@"
                SELECT code_hash, expires_at <= NOW(), attempts
                FROM password_reset_codes
                WHERE user_id = @user
                FOR UPDATE", connection, transaction))
            {
                select.Parameters.AddWithValue("@user", userId);
                await using var reader = await select.ExecuteReaderAsync();
                if (!await reader.ReadAsync()) return (Result.Missing, 0);
                storedHash = reader.GetString(0);
                expired = reader.GetBoolean(1);
                attempts = reader.GetInt32(2);
            }

            if (expired)
            {
                await DeleteAsync(connection, transaction, userId);
                return (Result.Expired, 0);
            }

            var matches = CryptographicOperations.FixedTimeEquals(
                Encoding.ASCII.GetBytes(Hash(userId, code)), Encoding.ASCII.GetBytes(storedHash));
            if (matches)
            {
                await DeleteAsync(connection, transaction, userId);
                return (Result.Valid, 0);
            }

            attempts++;
            if (attempts >= MaxAttempts)
            {
                await DeleteAsync(connection, transaction, userId);
                return (Result.TooManyTries, 0);
            }

            await using (var update = new NpgsqlCommand(
                "UPDATE password_reset_codes SET attempts = @attempts WHERE user_id = @user", connection, transaction))
            {
                update.Parameters.AddWithValue("@attempts", attempts);
                update.Parameters.AddWithValue("@user", userId);
                await update.ExecuteNonQueryAsync();
            }
            return (Result.Wrong, MaxAttempts - attempts);
        }

        // Removes the account's code: after its email changes, or when the email couldn't be sent.
        public static void Delete(NpgsqlConnection connection, int userId)
        {
            using var command = new NpgsqlCommand("DELETE FROM password_reset_codes WHERE user_id = @user", connection);
            command.Parameters.AddWithValue("@user", userId);
            command.ExecuteNonQuery();
        }

        // The email that carries a code, as plain text and HTML.
        public static (string Subject, string Text, string Html) Email(string fullName, string username, string code)
        {
            const string subject = "Your CRKD password reset code";
            var text =
                $"Hi {fullName},\n\n" +
                $"Your code to reset the password for the CRKD account \"{username}\" is: {code}\n\n" +
                $"It expires in {ValidMinutes} minutes. If you didn't ask to reset your password, you can ignore this email.\n\n" +
                "CRKD Clothing Shop";
            var html =
                "<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#171717\">" +
                $"<p>Hi {WebUtility.HtmlEncode(fullName)},</p>" +
                $"<p>Your code to reset the password for the CRKD account <strong>{WebUtility.HtmlEncode(username)}</strong> is:</p>" +
                $"<p style=\"font-size:28px;font-weight:700;letter-spacing:6px\">{code}</p>" +
                $"<p>It expires in {ValidMinutes} minutes. If you didn't ask to reset your password, you can ignore this email.</p>" +
                "<p>CRKD Clothing Shop</p>" +
                "</div>";
            return (subject, text, html);
        }

        private static async Task DeleteAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, int userId)
        {
            await using var command = new NpgsqlCommand("DELETE FROM password_reset_codes WHERE user_id = @user", connection, transaction);
            command.Parameters.AddWithValue("@user", userId);
            await command.ExecuteNonQueryAsync();
        }

        // Salted with the account's id, so equal codes for two accounts have different hashes.
        private static string Hash(int userId, string code) =>
            Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{userId}:{code}")));
    }
}
