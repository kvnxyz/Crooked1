using System.Text.Json.Serialization;

namespace Crooked.Models
{
    public sealed record TransactionSummary(
        int TransactionId,
        string ReferenceId,
        string DateTime,
        string DateIso,
        decimal TotalAmount,
        string Status,
        string PaymentMethod,
        string SoldBy,
        int ItemCount,
        string? DiscountCode,
        decimal DiscountAmount,
        // Set only for a manual discount (DiscountCode is then null).
        int? ManualDiscountPercent,
        // Set only for a voided sale (VoidPolicy): when (Philippine time), by whom and why.
        string? VoidedAt,
        string? VoidedBy,
        string? VoidReason,
        [property: JsonIgnore] string StoredStatus,
        [property: JsonIgnore] DateTime StoredDateTime,
        // When the server saved the sale; null for sales saved before that was recorded.
        [property: JsonIgnore] DateTime? StoredCreatedAt);

    public sealed record TransactionItemView(
        long TransactionItemId,
        int ProductId,
        string ProductName,
        string Category,
        string Size,
        string Color,
        int Quantity,
        decimal UnitPrice,
        string ExchangeReason);

    public sealed record ExchangeView(
        long ExchangeId,
        int TransactionId,
        string ReferenceId,
        string CreatedAt,
        string ProcessedBy,
        string Notes,
        List<ExchangeItemView> Items);

    public sealed record ExchangeItemView(
        string ProductName,
        string ReturnedSize,
        string ReturnedColor,
        string NewSize,
        string NewColor,
        int Quantity,
        string Reason);
}
