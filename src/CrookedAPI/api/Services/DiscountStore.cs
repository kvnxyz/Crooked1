using System.Security.Claims;
using Npgsql;
using Crooked.Models;

namespace Crooked.Services
{
    // Discount coupon and manual discount queries shared by the Discounts page and the POS sale
    // (TransactionController).
    public static class DiscountStore
    {
        private const string Columns = @"
            discount_id, code, description, discount_type, value, min_purchase, max_uses, times_used,
            starts_on, ends_on, is_active, created_by, created_at";

        public static async Task<List<StoredDiscount>> ListAsync(NpgsqlConnection connection)
        {
            await using var command = new NpgsqlCommand(
                $"SELECT {Columns} FROM discounts ORDER BY created_at DESC, discount_id DESC", connection);
            await using var reader = await command.ExecuteReaderAsync();
            var discounts = new List<StoredDiscount>();
            while (await reader.ReadAsync()) discounts.Add(Read(reader));
            return discounts;
        }

        // Codes match ignoring case. forUpdate locks the row until the transaction ends, so two
        // tills can't both take the last use of a limited code.
        public static async Task<StoredDiscount?> FindByCodeAsync(
            NpgsqlConnection connection, NpgsqlTransaction? transaction, string code, bool forUpdate = false)
        {
            await using var command = new NpgsqlCommand(
                $"SELECT {Columns} FROM discounts WHERE upper(code) = upper(@code){(forUpdate ? " FOR UPDATE" : "")}",
                connection, transaction);
            command.Parameters.AddWithValue("@code", code.Trim());
            await using var reader = await command.ExecuteReaderAsync();
            return await reader.ReadAsync() ? Read(reader) : null;
        }

        // The checkout's subtotal at the current product prices (the same prices transaction_items stores).
        public static async Task<decimal> SubtotalAsync(
            NpgsqlConnection connection, NpgsqlTransaction? transaction, IReadOnlyCollection<TransactionItemInput> items)
        {
            await using var command = new NpgsqlCommand(@"
                SELECT COALESCE(SUM(COALESCE(p.price, 0) * i.quantity), 0)
                FROM unnest(@product_ids, @quantities) AS i(product_id, quantity)
                JOIN products p ON p.id = i.product_id", connection, transaction);
            command.Parameters.AddWithValue("@product_ids", items.Select(item => item.ProductId).ToArray());
            command.Parameters.AddWithValue("@quantities", items.Select(item => item.Quantity).ToArray());
            return Convert.ToDecimal(await command.ExecuteScalarAsync());
        }

        public static async Task RecordUseAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, long discountId)
        {
            await using var command = new NpgsqlCommand(
                "UPDATE discounts SET times_used = times_used + 1 WHERE discount_id = @id", connection, transaction);
            command.Parameters.AddWithValue("@id", discountId);
            await command.ExecuteNonQueryAsync();
        }

        // Gives a coupon back the use a voided sale took (SaleVoids). Does nothing if it was deleted.
        public static async Task ReleaseUseAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, string code)
        {
            await using var command = new NpgsqlCommand(
                "UPDATE discounts SET times_used = times_used - 1 WHERE upper(code) = upper(@code) AND times_used > 0",
                connection, transaction);
            command.Parameters.AddWithValue("@code", code);
            await command.ExecuteNonQueryAsync();
        }

        // The one percentage staff can give with a manual discount; 0 means they can't give one.
        // (The column keeps its old name from when this was an upper limit.)
        public static async Task<int> StaffPercentAsync(NpgsqlConnection connection, NpgsqlTransaction? transaction)
        {
            await using var command = new NpgsqlCommand(
                "SELECT staff_max_percent FROM discount_settings WHERE id = 1", connection, transaction);
            return await command.ExecuteScalarAsync() is int percent ? percent : 0;
        }

        // The percentage the signed-in person must use for a manual discount, from their session's
        // role (never the browser's): null for owners, who can give any percentage, and the owner's
        // setting for staff (0 when they can't give one).
        public static async Task<int?> ManualFixedPercentAsync(
            NpgsqlConnection connection, NpgsqlTransaction? transaction, ClaimsPrincipal user) =>
            user.IsInRole(UserRoles.Owner) ? null : await StaffPercentAsync(connection, transaction);

        public static async Task SetStaffPercentAsync(
            NpgsqlConnection connection, NpgsqlTransaction transaction, int percent, string updatedBy)
        {
            await using var command = new NpgsqlCommand(@"
                INSERT INTO discount_settings (id, staff_max_percent, updated_by, updated_at)
                VALUES (1, @percent, @updated_by, NOW())
                ON CONFLICT (id) DO UPDATE
                SET staff_max_percent = EXCLUDED.staff_max_percent,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = EXCLUDED.updated_at", connection, transaction);
            command.Parameters.AddWithValue("@percent", percent);
            command.Parameters.AddWithValue("@updated_by", updatedBy);
            await command.ExecuteNonQueryAsync();
        }

        public static string NotFound(string code) => $"There is no discount code \"{code.Trim().ToUpperInvariant()}\".";

        private static StoredDiscount Read(NpgsqlDataReader reader) => new(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.GetDecimal(4),
            reader.GetDecimal(5),
            reader.IsDBNull(6) ? null : reader.GetInt32(6),
            reader.GetInt32(7),
            reader.IsDBNull(8) ? null : reader.GetFieldValue<DateOnly>(8),
            reader.IsDBNull(9) ? null : reader.GetFieldValue<DateOnly>(9),
            reader.GetBoolean(10),
            reader.GetString(11),
            reader.GetDateTime(12));
    }
}
