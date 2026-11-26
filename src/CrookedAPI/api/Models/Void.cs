using Crooked.Services;

namespace Crooked.Models
{
    // Why a sale is being voided: one of the reasons void-sale.js offers, or the cashier's own words.
    public sealed class VoidRequest
    {
        public string? Reason { get; set; }
    }

    // Shop policy for voiding a sale: undoing it right after it was made, when the customer changes
    // their mind. Later on, the 3-day exchange (ExchangePolicy) is the only option.
    // SaleVoids (api/Services) does the void itself.
    public static class VoidPolicy
    {
        // void-sale.js and the Sales Record say the same number of minutes.
        public const int WindowMinutes = 30;
        public const int MaxReasonLength = 200;

        // Until when the sale can be voided. Null for sales saved before the server recorded the time
        // it saved them (transactions.created_at); those can't be voided.
        public static DateTime? Until(DateTime? createdUtc) => createdUtc?.AddMinutes(WindowMinutes);

        public static bool IsOpen(DateTime? createdUtc, DateTime nowUtc) => Until(createdUtc) is { } until && nowUtc < until;

        // Why the reason can't be used, or null when it can.
        public static string? ReasonProblem(string? reason)
        {
            var value = reason?.Trim() ?? "";
            if (value.Length == 0) return "Choose why the sale is being voided.";
            if (value.Length > MaxReasonLength) return $"Keep the reason under {MaxReasonLength} characters.";
            return null;
        }

        // Why the sale can't be voided now, or null when it can.
        public static string? Problem(string status, bool hasExchange, DateTime? createdUtc, DateTime nowUtc)
        {
            if (status == TransactionStatuses.Voided) return "This sale has already been voided.";
            if (status != TransactionStatuses.Completed) return $"Only completed sales can be voided. This sale is {status}.";
            if (hasExchange) return "An item from this sale was exchanged, so the sale can't be voided.";
            if (!IsOpen(createdUtc, nowUtc))
            {
                return $"A sale can only be voided within {WindowMinutes} minutes of the sale, and that time has passed.";
            }
            return null;
        }

        // What the cashier gives back. The system records the void but doesn't move money itself.
        public static string RefundText(string paymentMethod, decimal amount) => paymentMethod switch
        {
            PaymentMethods.Cash => $"Give the customer back {Money.Peso(amount)} in cash.",
            PaymentMethods.GCash => $"Send {Money.Peso(amount)} back to the customer's GCash.",
            _ => $"Give the customer back {Money.Peso(amount)}."
        };
    }
}
