namespace Crooked.Models
{
    // A row of the Transactions sheet in the Excel export.
    public sealed record TransactionSheetRow(
        int TransactionId,
        string ReferenceId,
        DateTime DateTimeUtc,
        string PaymentMethod,
        string SoldBy,
        string Status,
        decimal TotalAmount);
}
