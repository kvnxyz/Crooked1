namespace Crooked.Models
{
    // Values of activity_logs.activity_type: what kind of action an entry records.
    public static class ActivityTypes
    {
        public const string Sale = "Sale";
        public const string Exchange = "Exchange";
        public const string Product = "Product";
        public const string Discount = "Discount";
        public const string Account = "Account";
        public const string Login = "Login";
        // Excel imports of sales. The import was removed; kept so older entries can still be filtered.
        public const string Import = "Import";
        // Entries from before activity_type existed whose wording schema.sql doesn't recognise.
        public const string Other = "Other";

        public static readonly string[] All = { Sale, Exchange, Product, Discount, Account, Login, Import, Other };

        public static string? Normalize(string? value) =>
            All.FirstOrDefault(type => string.Equals(type, value?.Trim(), StringComparison.OrdinalIgnoreCase));
    }

    // Search, filters and paging for the Activity Logs page.
    public sealed class ActivityQuery
    {
        public string? Search { get; set; }
        public string? Type { get; set; }
        public string? Staff { get; set; }
        public DateOnly? From { get; set; }
        public DateOnly? To { get; set; }
        public int Page { get; set; } = 1;
        public int PageSize { get; set; } = 20;
    }

    // One activity log entry. DateTime is in Philippine time for display; DateIso is for <time datetime>.
    public sealed record ActivityView(string DateTime, string DateIso, string StaffName, string Type, string Action);
}
