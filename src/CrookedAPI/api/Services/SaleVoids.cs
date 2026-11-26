using Npgsql;
using Crooked.Models;

namespace Crooked.Services
{
    public enum VoidOutcome { Voided, NotFound, Refused }

    // Message is what the cashier sees: the refund to give back, or why the sale can't be voided.
    public sealed record VoidResult(VoidOutcome Outcome, string Message, string ReferenceId = "", decimal Refund = 0, string PaymentMethod = "");

    // Voids a sale (VoidPolicy): undoes everything SaveTransaction did, inside the caller's database
    // transaction, which the caller commits only when the outcome is Voided.
    //   - gives the coupon back its use;
    //   - puts every item back into stock (archived products too);
    //   - takes the units off that day's sales, so the forecast doesn't learn from a sale that didn't happen;
    //   - marks the sale Voided with who voided it, when and why (the rows are kept, never deleted);
    //   - writes a Void activity log entry.
    // Revenue only counts Completed sales, so a voided sale drops out of it by itself, and the
    // Exchanges page only accepts Completed sales.
    public static class SaleVoids
    {
        public static async Task<VoidResult> VoidAsync(
            NpgsqlConnection connection, NpgsqlTransaction transaction, int transactionId, string voidedBy, string reason)
        {
            string referenceId, status, paymentMethod;
            string? discountCode;
            bool hasExchange;
            DateTime? createdAt;
            decimal total;

            // Locked until the caller commits, so a void and an exchange of the same sale can't overlap.
            await using (var select = new NpgsqlCommand(@"
                SELECT reference_id, status, has_exchange, created_at, total_amount, payment_method, discount_code
                FROM transactions
                WHERE transaction_id = @id
                FOR UPDATE", connection, transaction))
            {
                select.Parameters.AddWithValue("@id", transactionId);
                await using var reader = await select.ExecuteReaderAsync();
                if (!await reader.ReadAsync()) return new VoidResult(VoidOutcome.NotFound, "The sale was not found.");

                referenceId = reader.IsDBNull(0) || string.IsNullOrWhiteSpace(reader.GetString(0))
                    ? $"#{transactionId}"
                    : reader.GetString(0).Trim();
                status = reader.IsDBNull(1) ? "" : reader.GetString(1);
                hasExchange = !reader.IsDBNull(2) && reader.GetBoolean(2);
                createdAt = reader.IsDBNull(3) ? null : reader.GetDateTime(3);
                total = reader.GetDecimal(4);
                paymentMethod = reader.IsDBNull(5) ? PaymentMethods.Unknown : reader.GetString(5);
                discountCode = reader.IsDBNull(6) ? null : reader.GetString(6);
            }

            var problem = VoidPolicy.Problem(status, hasExchange, createdAt, DateTime.UtcNow);
            if (problem != null) return new VoidResult(VoidOutcome.Refused, problem, referenceId);

            // The coupon row is locked before the products, the same order SaveTransaction uses, so a
            // void and a sale with the same coupon and products can't deadlock.
            if (!string.IsNullOrWhiteSpace(discountCode))
            {
                await DiscountStore.ReleaseUseAsync(connection, transaction, discountCode);
            }

            var returned = new List<(int ProductId, int Quantity)>();
            await using (var items = new NpgsqlCommand(@"
                SELECT product_id, SUM(quantity)::int
                FROM transaction_items
                WHERE transaction_id = @id
                GROUP BY product_id
                ORDER BY product_id", connection, transaction))
            {
                items.Parameters.AddWithValue("@id", transactionId);
                await using var reader = await items.ExecuteReaderAsync();
                while (await reader.ReadAsync()) returned.Add((reader.GetInt32(0), reader.GetInt32(1)));
            }

            // SaveTransaction counted the units on the Philippine date it saved the sale.
            var saleDate = ShopClock.ShopDate(createdAt!.Value);
            foreach (var (productId, quantity) in returned)
            {
                await using (var restock = new NpgsqlCommand(
                    "UPDATE products SET stock_quantity = stock_quantity + @quantity WHERE id = @id",
                    connection, transaction))
                {
                    restock.Parameters.AddWithValue("@quantity", quantity);
                    restock.Parameters.AddWithValue("@id", productId);
                    await restock.ExecuteNonQueryAsync();
                }

                await using var unsell = new NpgsqlCommand(@"
                    UPDATE product_daily_sales
                    SET quantity_sold = GREATEST(quantity_sold - @quantity, 0)
                    WHERE product_id = @id AND sale_date = @date", connection, transaction);
                unsell.Parameters.AddWithValue("@quantity", quantity);
                unsell.Parameters.AddWithValue("@id", productId);
                unsell.Parameters.AddWithValue("@date", saleDate);
                await unsell.ExecuteNonQueryAsync();
            }

            await using (var update = new NpgsqlCommand(@"
                UPDATE transactions
                SET status = @voided, voided_at = NOW(), voided_by = @by, void_reason = @reason
                WHERE transaction_id = @id", connection, transaction))
            {
                update.Parameters.AddWithValue("@voided", TransactionStatuses.Voided);
                update.Parameters.AddWithValue("@by", string.IsNullOrWhiteSpace(voidedBy) ? "Unknown" : voidedBy.Trim());
                update.Parameters.AddWithValue("@reason", reason);
                update.Parameters.AddWithValue("@id", transactionId);
                await update.ExecuteNonQueryAsync();
            }

            // "Kevin · Voided sale REF-... (₱810.00, 2 items, Cash): Customer changed their mind"
            var units = returned.Sum(item => item.Quantity);
            await ActivityLog.WriteAsync(connection, transaction, voidedBy, ActivityTypes.Void,
                $"Voided sale {referenceId} ({Money.Peso(total)}, {units} item{(units == 1 ? "" : "s")}, {paymentMethod}): {reason}");

            return new VoidResult(
                VoidOutcome.Voided,
                $"Sale {referenceId} was voided and its items are back in stock. {VoidPolicy.RefundText(paymentMethod, total)}",
                referenceId,
                total,
                paymentMethod);
        }
    }
}
