namespace Crooked.Models
{
    public class User
    {
        public int Id { get; set; }
        public string Username { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
        public string Role { get; set; } = string.Empty;
        public string FullName { get; set; } = string.Empty;
    }

    public class LoginRequest
    {
        public string Username { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
    }

    // Rules for every new password: staff accounts and the owner's password reset.
    // Logging in does not check them, so older passwords keep working.
    // ui.js (passwordChecklist) shows the same rules while the password is typed.
    public static class PasswordPolicy
    {
        public const int MinLength = 8;
        public const int MaxLength = 64;

        public const string Description =
            "Password must be 8 to 64 characters, with an uppercase letter, a lowercase letter, a number and a symbol, and no spaces.";

        public static bool IsValid(string? password) =>
            password is { Length: >= MinLength and <= MaxLength }
            && password.Any(char.IsAsciiLetterUpper)
            && password.Any(char.IsAsciiLetterLower)
            && password.Any(char.IsAsciiDigit)
            && password.Any(c => !char.IsAsciiLetterOrDigit(c) && !char.IsWhiteSpace(c))
            && !password.Any(char.IsWhiteSpace);
    }
}