namespace Crooked.Models
{
    // Rows of the Transactions and Items sheets in the Excel export.
    public sealed record TransactionSheetRow(
        int TransactionId,
        string ReferenceId,
        DateTime DateTimeUtc,
        string PaymentMethod,
        string SoldBy,
        string Status,
        decimal TotalAmount);

    public sealed record TransactionItemSheetRow(
        string ReferenceId,
        string ProductName,
        string Category,
        string Size,
        string Color,
        int Quantity,
        decimal UnitPrice,
        string ExchangeReason);
}
