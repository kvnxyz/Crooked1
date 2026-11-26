namespace Crooked.Models
{
    public class User
    {
        public int Id { get; set; }
        public string Username { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
        public string Role { get; set; } = string.Empty;
        public string FullName { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
    }

    public class LoginRequest
    {
        public string Username { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
    }

    // A signed-in user changing their own password (profile menu > Change Password).
    public class ChangePasswordRequest
    {
        public string Username { get; set; } = string.Empty;
        public string CurrentPassword { get; set; } = string.Empty;
        public string NewPassword { get; set; } = string.Empty;
    }

    // The owner making another account an owner or staff (Accounts page). Role is a UserRoles value.
    public class ChangeRoleRequest
    {
        public string Role { get; set; } = string.Empty;
    }

    // The owner setting an account's email (Accounts page).
    public class SetEmailRequest
    {
        public string Email { get; set; } = string.Empty;
    }

    // Rules for an account's email, where Forgot Password sends its codes.
    // staff-management.js checks the same rule (isValidEmail) before a form is sent.
    public static class EmailPolicy
    {
        public const int MaxLength = 254;
        public const string InvalidMessage = "Enter a valid email address, like name@example.com.";

        // The email trimmed and in lower case, or null when it isn't a valid address.
        public static string? Normalize(string? email)
        {
            var value = email?.Trim().ToLowerInvariant();
            if (string.IsNullOrEmpty(value) || value.Length > MaxLength) return null;

            var at = value.IndexOf('@');
            var valid = at > 0
                && at == value.LastIndexOf('@')
                && value.IndexOf('.', at) > at + 1
                && !value.EndsWith('.')
                && !value.Any(char.IsWhiteSpace)
                && System.Net.Mail.MailAddress.TryCreate(value, out var parsed)
                && parsed.Address == value;
            return valid ? value : null;
        }
    }

    // Rules for every new password: new staff accounts, password changes and Forgot Password resets.
    // Logging in does not check them, so older passwords keep working.
    // ui.js (isValidPassword) checks the same rules before a form is sent.
    public static class PasswordPolicy
    {
        public const int MinLength = 8;
        public const int MaxLength = 64;


        public static bool IsValid(string? password) =>
            password is { Length: >= MinLength and <= MaxLength }
            && password.Any(char.IsAsciiLetterUpper)
            && password.Any(char.IsAsciiLetterLower)
            && password.Any(char.IsAsciiDigit)
            && password.Any(c => !char.IsAsciiLetterOrDigit(c) && !char.IsWhiteSpace(c))
            && !password.Any(char.IsWhiteSpace);
    }
}