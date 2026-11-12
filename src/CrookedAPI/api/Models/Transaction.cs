using System.Text.Json.Serialization;

namespace Crooked.Models
{
    public class Transaction
    {
        public int Transaction_Id { get; set; }
        public string ReferenceId { get; set; }
        public DateTime Date_Time { get; set; }
        public decimal Total_Amount { get; set; }
        public string Status { get; set; }
        public string AssistedBy { get; set; } = "Unknown";

        [JsonPropertyName("payment_method")]
        public string? PaymentMethod { get; set; }

        // A coupon applied at the POS. The server checks it and works out the discount and the
        // total itself (DiscountStore), so for these sales Total_Amount from the browser is ignored.
        public string? DiscountCode { get; set; }

        // A manual discount instead of a coupon (ManualDiscount): a whole-number percentage. The
        // server checks it against the signed-in person's limit and works out the total itself,
        // as it does for coupons.
        public int? ManualDiscountPercent { get; set; }

        public List<TransactionItemInput> Items { get; set; } = new();
    }

    public sealed class TransactionItemInput
    {
        public int ProductId { get; set; }
        public int Quantity { get; set; }
    }

    // Why SaveTransaction refused a sale (409, sent as "reason"), so the POS knows what to fix.
    // Nothing is saved or taken out of stock in either case.
    public static class SaleConflicts
    {
        // A product is archived or has fewer units than the sale needs.
        public const string Stock = "stock";
        // The coupon or manual discount can no longer be used.
        public const string Discount = "discount";
    }

    // Search, filters and paging for the audit logs and the Excel export.
    public sealed class TransactionQuery
    {
        public string? Search { get; set; }
        public string? Status { get; set; }
        public string? Payment { get; set; }
        public DateOnly? From { get; set; }
        public DateOnly? To { get; set; }
        public int Page { get; set; } = 1;
        public int PageSize { get; set; } = 10;
    }
}
