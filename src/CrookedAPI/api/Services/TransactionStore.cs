using Npgsql;
using NpgsqlTypes;
using Crooked.Models;

namespace Crooked.Services
{
    // Read queries shared by the audit logs and the exchange module.
    public static class TransactionStore
    {
        // Select list for ReadSummary; the query must alias transactions as t.
        public const string SummaryColumns = @"
            t.transaction_id, t.reference_id, t.date_time, t.total_amount, t.status, t.has_exchange,
            t.assisted_by, t.payment_method, t.discount_code, t.discount_amount,
            t.manual_discount_percent, t.created_at, t.voided_at, t.voided_by, t.void_reason,
            (SELECT COALESCE(SUM(ti.quantity), 0) FROM transaction_items ti WHERE ti.transaction_id = t.transaction_id) AS item_count";

        public static TransactionSummary ReadSummary(NpgsqlDataReader reader)
        {
            var storedStatus = reader["status"] as string ?? TransactionStatuses.Completed;
            var hasExchange = reader["has_exchange"] is bool flag && flag;
            var dateTime = reader.GetDateTime(reader.GetOrdinal("date_time"));
            return new TransactionSummary(
                Convert.ToInt32(reader["transaction_id"]),
                reader["reference_id"] as string ?? "",
                ShopClock.Display(dateTime),
                ShopClock.Iso(dateTime),
                Convert.ToDecimal(reader["total_amount"]),
                TransactionStatuses.Display(storedStatus, hasExchange),
                reader["payment_method"] as string ?? PaymentMethods.Unknown,
                reader["assisted_by"] as string ?? "Unknown",
                Convert.ToInt32(reader["item_count"]),
                reader["discount_code"] as string,
                Convert.ToDecimal(reader["discount_amount"]),
                reader["manual_discount_percent"] is int manualPercent ? manualPercent : null,
                reader["voided_at"] is DateTime voidedAt ? ShopClock.Display(voidedAt) : null,
                reader["voided_by"] as string,
                reader["void_reason"] as string,
                storedStatus,
                dateTime,
                reader["created_at"] is DateTime createdAt ? createdAt : null);
        }

        public static async Task<TransactionSummary?> FindSummaryAsync(NpgsqlConnection connection, int transactionId)
        {
            await using var command = new NpgsqlCommand(
                $"SELECT {SummaryColumns} FROM transactions t WHERE t.transaction_id = @transaction_id", connection);
            command.Parameters.AddWithValue("@transaction_id", transactionId);
            await using var reader = await command.ExecuteReaderAsync();
            return await reader.ReadAsync() ? ReadSummary(reader) : null;
        }

        public static async Task<List<TransactionItemView>> ReadItemsAsync(NpgsqlConnection connection, int transactionId)
        {
            const string sql = @"
                SELECT transaction_item_id, product_id, product_name, category, size, color, quantity, unit_price, exchange_reason
                FROM transaction_items
                WHERE transaction_id = @transaction_id
                ORDER BY transaction_item_id";
            await using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue("@transaction_id", transactionId);
            await using var reader = await command.ExecuteReaderAsync();

            var items = new List<TransactionItemView>();
            while (await reader.ReadAsync())
            {
                items.Add(new TransactionItemView(
                    reader.GetInt64(0),
                    reader.GetInt32(1),
                    reader.GetString(2),
                    reader.GetString(3),
                    reader.GetString(4),
                    reader.GetString(5),
                    reader.GetInt32(6),
                    reader.GetDecimal(7),
                    reader.GetString(8)));
            }
            return items;
        }

        // Exchanges for one sale (transactionId) or the most recent ones across all sales.
        public static async Task<List<ExchangeView>> ReadExchangesAsync(NpgsqlConnection connection, int? transactionId, int limit)
        {
            const string exchangesSql = @"
                SELECT e.exchange_id, e.created_at, e.processed_by, e.notes, t.transaction_id, t.reference_id
                FROM exchanges e
                JOIN transactions t ON t.transaction_id = e.transaction_id
                WHERE @transaction_id IS NULL OR e.transaction_id = @transaction_id
                ORDER BY e.created_at DESC, e.exchange_id DESC
                LIMIT @limit";
            var exchanges = new List<ExchangeView>();
            await using (var command = new NpgsqlCommand(exchangesSql, connection))
            {
                command.Parameters.Add(new NpgsqlParameter("transaction_id", NpgsqlDbType.Integer)
                {
                    Value = (object?)transactionId ?? DBNull.Value
                });
                command.Parameters.AddWithValue("@limit", limit);
                await using var reader = await command.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    exchanges.Add(new ExchangeView(
                        reader.GetInt64(0),
                        reader.GetInt32(4),
                        reader.IsDBNull(5) ? "" : reader.GetString(5),
                        ShopClock.Display(reader.GetDateTime(1)),
                        reader.GetString(2),
                        reader.GetString(3),
                        new List<ExchangeItemView>()));
                }
            }

            if (exchanges.Count == 0) return exchanges;

            const string itemsSql = @"
                SELECT exchange_id, returned_product_name, returned_size, returned_color, new_size, new_color, quantity, reason
                FROM exchange_items
                WHERE exchange_id = ANY(@exchange_ids)
                ORDER BY exchange_item_id";
            var byId = exchanges.ToDictionary(exchange => exchange.ExchangeId);
            await using (var command = new NpgsqlCommand(itemsSql, connection))
            {
                command.Parameters.AddWithValue("@exchange_ids", byId.Keys.ToArray());
                await using var reader = await command.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    byId[reader.GetInt64(0)].Items.Add(new ExchangeItemView(
                        reader.GetString(1),
                        reader.GetString(2),
                        reader.GetString(3),
                        reader.GetString(4),
                        reader.GetString(5),
                        reader.GetInt32(6),
                        reader.GetString(7)));
                }
            }
            return exchanges;
        }
    }
}
