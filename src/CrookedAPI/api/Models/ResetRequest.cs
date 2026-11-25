namespace Crooked.Models
{
    // Forgot Password, step 1: the account's email, where the code is sent.
    public class ForgotPasswordRequest
    {
        public string Email { get; set; } = string.Empty;
    }

    // Forgot Password, step 2: the emailed code and the new password.
    public class ResetRequest
    {
        public string Email { get; set; } = string.Empty;
        public string Code { get; set; } = string.Empty;
        public string NewPassword { get; set; } = string.Empty;
    }
}
