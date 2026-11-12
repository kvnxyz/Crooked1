namespace Crooked.Models
{
    public static class PaymentMethods
    {
        public const string Cash = "Cash";
        public const string GCash = "GCash";
        public const string Unknown = "Unknown";

        // Returns null for anything that is not a known payment method.
        public static string? Normalize(string? value) => value?.Trim().ToLowerInvariant() switch
        {
            "cash" => Cash,
            "gcash" or "g-cash" => GCash,
            "unknown" => Unknown,
            _ => null
        };
    }

    // "Exchanged" is not stored in transactions.status: an exchanged sale stays "Completed"
    // (so it still counts toward revenue) and has has_exchange = TRUE.
    public static class TransactionStatuses
    {
        public const string Completed = "Completed";
        public const string Exchanged = "Exchanged";
        public const string Pending = "Pending";
        public const string Voided = "Voided";

        public static string? Normalize(string? value) => value?.Trim().ToLowerInvariant() switch
        {
            "completed" => Completed,
            "exchanged" => Exchanged,
            "pending" => Pending,
            "voided" => Voided,
            _ => null
        };

        public static string Display(string status, bool hasExchange) => hasExchange ? Exchanged : status;
    }
}
