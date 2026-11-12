using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using Crooked.Models;
using Crooked.Services;

namespace Crooked.Controllers
{
    [Route("api/POS/[controller]")]
    [ApiController]
    public class TransactionController : ControllerBase
    {
        private const int MaxExportRows = 50000;
        private readonly string _connectionString = DatabaseConfig.ConnectionString;

        // Today's revenue (Philippine time) from completed sales, exchanged ones included.
        [Authorize(Roles = UserRoles.Owner)]
        [HttpGet("today-revenue")]
        public IActionResult GetTodayRevenue()
        {
            var today = ShopClock.Today;
            try
            {
                using (var connection = new NpgsqlConnection(_connectionString))
                {
                    connection.Open();
                    const string sql = @"
                        SELECT COALESCE(SUM(total_amount), 0)
                        FROM transactions
                        WHERE status = 'Completed'
                          AND date_time >= @from
                          AND date_time < @to";

                    using (var command = new NpgsqlCommand(sql, connection))
                    {
                        command.Parameters.AddWithValue("@from", ShopClock.StartOfDayUtc(today));
                        command.Parameters.AddWithValue("@to", ShopClock.StartOfDayUtc(today.AddDays(1)));
                        var revenue = Convert.ToDecimal(command.ExecuteScalar());
                        return Ok(new { revenue, date = today });
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Today's Revenue Error: {ex.Message}");
                return StatusCode(500, new { error = "Unable to load today's revenue." });
            }
        }

        // Records a POS sale: takes its items out of stock, adds them to the day's sales for forecasting,
        // counts the coupon, saves the sale and its items, and writes the activity log, all in one database
        // transaction. A 409 (reason: SaleConflicts) or an error leaves everything as it was, so a failed
        // sale never takes stock and trying again can't take it twice.
        [HttpPost]
        [LiveUpdate(LiveTopics.Transactions, LiveTopics.Products, LiveTopics.Discounts, LiveTopics.Activity)]
        public async Task<IActionResult> SaveTransaction([FromBody] Transaction tx)
        {
            try
            {
                if (tx == null)
                {
                    Console.WriteLine("ERROR: Transaction object is null");
                    return BadRequest(new { error = "Transaction is null" });
                }

                if (tx.Items == null || tx.Items.Count == 0 || tx.Items.Any(item => item.ProductId <= 0 || item.Quantity <= 0))
                {
                    return BadRequest(new { error = "A sale needs at least one item, each with a valid product and quantity." });
                }

                if (!string.IsNullOrWhiteSpace(tx.DiscountCode) && tx.ManualDiscountPercent != null)
                {
                    return BadRequest(new { message = "A sale can use a coupon or a manual discount, not both." });
                }

                var paymentMethod = PaymentMethods.Normalize(tx.PaymentMethod) ?? PaymentMethods.Unknown;
                Console.WriteLine($"Received: RefId={tx.ReferenceId}, Date={tx.Date_Time}, Total={tx.Total_Amount}, Status={tx.Status}, Payment={paymentMethod}");

                await using (var conn = new NpgsqlConnection(_connectionString))
                {
                    await conn.OpenAsync();
                    await using var dbTransaction = await conn.BeginTransactionAsync();
                    try
                    {
                        var total = tx.Total_Amount;
                        string? discountCode = null;
                        int? manualPercent = null;
                        decimal discountAmount = 0;

                        // The coupon row stays locked until the sale is saved, so a usage limit can't be overrun.
                        if (!string.IsNullOrWhiteSpace(tx.DiscountCode))
                        {
                            var discount = await DiscountStore.FindByCodeAsync(conn, dbTransaction, tx.DiscountCode, forUpdate: true);
                            var subtotal = await DiscountStore.SubtotalAsync(conn, dbTransaction, tx.Items);
                            var problem = discount == null
                                ? DiscountStore.NotFound(tx.DiscountCode)
                                : discount.Problem(subtotal, ShopClock.Today);
                            if (problem != null)
                            {
                                await dbTransaction.RollbackAsync();
                                return Conflict(new { message = problem, reason = SaleConflicts.Discount });
                            }

                            discountCode = discount!.Code;
                            discountAmount = discount.AmountOff(subtotal);
                            total = subtotal - discountAmount;
                            await DiscountStore.RecordUseAsync(conn, dbTransaction, discount.Id);
                        }
                        // A manual discount is checked against the signed-in person's limit (the role in
                        // their session, never one the browser sends).
                        else if (tx.ManualDiscountPercent != null)
                        {
                            var maxPercent = await DiscountStore.ManualMaxPercentAsync(conn, dbTransaction, User);
                            var problem = ManualDiscount.Problem(tx.ManualDiscountPercent, maxPercent);
                            if (problem != null)
                            {
                                await dbTransaction.RollbackAsync();
                                return Conflict(new { message = problem, reason = SaleConflicts.Discount });
                            }

                            var subtotal = await DiscountStore.SubtotalAsync(conn, dbTransaction, tx.Items);
                            manualPercent = tx.ManualDiscountPercent.Value;
                            discountAmount = ManualDiscount.AmountOff(subtotal, manualPercent.Value);
                            total = subtotal - discountAmount;
                        }

                        if (!await TakeStockAsync(conn, dbTransaction, tx.Items))
                        {
                            await dbTransaction.RollbackAsync();
                            return Conflict(new
                            {
                                message = "A product is no longer sold or doesn't have enough stock left for this sale.",
                                reason = SaleConflicts.Stock
                            });
                        }

                        const string sql = @"INSERT INTO Transactions
                                           (reference_id, date_time, total_amount, status, assisted_by, payment_method,
                                            discount_code, discount_amount, manual_discount_percent)
                                           VALUES (@referenceId, @dateTime, @total, @status, @assistedBy, @paymentMethod,
                                            @discountCode, @discountAmount, @manualPercent)
                                           RETURNING transaction_id";

                        int transactionId;
                        await using (var cmd = new NpgsqlCommand(sql, conn, dbTransaction))
                        {
                            cmd.Parameters.AddWithValue("@referenceId", tx.ReferenceId ?? (object)DBNull.Value);
                            cmd.Parameters.AddWithValue("@dateTime", tx.Date_Time);
                            cmd.Parameters.AddWithValue("@total", total);
                            cmd.Parameters.AddWithValue("@status", tx.Status ?? "Completed");
                            cmd.Parameters.AddWithValue("@assistedBy",
                                string.IsNullOrWhiteSpace(tx.AssistedBy) ? "Unknown" : tx.AssistedBy.Trim());
                            cmd.Parameters.AddWithValue("@paymentMethod", paymentMethod);
                            cmd.Parameters.AddWithValue("@discountCode", (object?)discountCode ?? DBNull.Value);
                            cmd.Parameters.AddWithValue("@discountAmount", discountAmount);
                            cmd.Parameters.Add(new NpgsqlParameter("@manualPercent", NpgsqlTypes.NpgsqlDbType.Integer)
                            {
                                Value = (object?)manualPercent ?? DBNull.Value
                            });
                            transactionId = Convert.ToInt32(await cmd.ExecuteScalarAsync());
                        }

                        foreach (var item in tx.Items)
                        {
                            const string itemSql = @"
                                INSERT INTO transaction_items
                                    (transaction_id, product_id, product_name, category, size, color, quantity, unit_price)
                                SELECT @transaction_id, id, product_name, COALESCE(category, ''),
                                       COALESCE(size, ''), COALESCE(color, ''), @quantity, price
                                FROM products
                                WHERE id = @product_id";
                            await using var itemCommand = new NpgsqlCommand(itemSql, conn, dbTransaction);
                            itemCommand.Parameters.AddWithValue("@transaction_id", transactionId);
                            itemCommand.Parameters.AddWithValue("@product_id", item.ProductId);
                            itemCommand.Parameters.AddWithValue("@quantity", item.Quantity);
                            if (await itemCommand.ExecuteNonQueryAsync() == 0)
                            {
                                throw new InvalidOperationException($"Product {item.ProductId} does not exist.");
                            }
                        }

                        // "Kevin · Processed sale REF-... (₱810.00, 2 items, Cash, discount SALE10)" on the
                        // Activity Logs page, or "..., manual discount 15% (₱150.00))".
                        var units = tx.Items.Sum(item => item.Quantity);
                        var details = new List<string> { Money.Peso(total), $"{units} item{(units == 1 ? "" : "s")}", paymentMethod };
                        if (discountCode != null) details.Add($"discount {discountCode}");
                        if (manualPercent != null)
                            details.Add($"manual discount {manualPercent}% ({Money.Peso(discountAmount)})");
                        var reference = string.IsNullOrWhiteSpace(tx.ReferenceId) ? $"#{transactionId}" : tx.ReferenceId.Trim();
                        await ActivityLog.WriteAsync(conn, dbTransaction, SessionClaims.FullNameOf(User), ActivityTypes.Sale,
                            $"Processed sale {reference} ({string.Join(", ", details)})");

                        await dbTransaction.CommitAsync();
                        return Ok(new { message = "Transaction saved successfully", tx, totalAmount = total, discountAmount });
                    }
                    catch
                    {
                        await dbTransaction.RollbackAsync();
                        throw;
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"ERROR TYPE: {ex.GetType().Name}");
                Console.WriteLine($"ERROR MESSAGE: {ex.Message}");
                Console.WriteLine($"STACK TRACE: {ex.StackTrace}");
                return StatusCode(500, new { error = ex.Message, type = ex.GetType().Name });
            }
        }

        // Takes a sale's units out of stock and adds them to today's sales (Philippine date), which the
        // forecast learns from. Returns false when a product is archived or has fewer units than the sale
        // needs; the caller then rolls back, so nothing is taken. Each product is updated once, in id
        // order, so two sales of the same products lock them in the same order and can't deadlock.
        private static async Task<bool> TakeStockAsync(
            NpgsqlConnection connection, NpgsqlTransaction transaction, IEnumerable<TransactionItemInput> items)
        {
            var sold = items
                .GroupBy(item => item.ProductId)
                .Select(group => (ProductId: group.Key, Quantity: group.Sum(item => item.Quantity)))
                .OrderBy(item => item.ProductId);

            foreach (var (productId, quantity) in sold)
            {
                await using (var updateStock = new NpgsqlCommand(
                    @"UPDATE products
                      SET stock_quantity = stock_quantity - @quantity
                      WHERE id = @id AND is_active = TRUE AND stock_quantity >= @quantity",
                    connection, transaction))
                {
                    updateStock.Parameters.AddWithValue("@quantity", quantity);
                    updateStock.Parameters.AddWithValue("@id", productId);
                    if (await updateStock.ExecuteNonQueryAsync() == 0) return false;
                }

                await using var recordSales = new NpgsqlCommand(
                    @"INSERT INTO product_daily_sales (product_id, sale_date, quantity_sold)
                      VALUES (@id, (NOW() AT TIME ZONE 'Asia/Manila')::date, @quantity)
                      ON CONFLICT (product_id, sale_date)
                      DO UPDATE SET quantity_sold = product_daily_sales.quantity_sold + EXCLUDED.quantity_sold",
                    connection, transaction);
                recordSales.Parameters.AddWithValue("@id", productId);
                recordSales.Parameters.AddWithValue("@quantity", quantity);
                await recordSales.ExecuteNonQueryAsync();
            }

            return true;
        }

        // One page of sales for the Audit Logs and Sales History, with search and filters applied.
        [HttpGet("search")]
        public async Task<IActionResult> SearchTransactions([FromQuery] TransactionQuery query)
        {
            var pageSize = Math.Clamp(query.PageSize, 1, 50);
            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync();

            int totalItems;
            await using (var countCommand = new NpgsqlCommand { Connection = connection })
            {
                countCommand.CommandText = $"SELECT COUNT(*) FROM transactions t {BuildFilter(query, countCommand)}";
                totalItems = Convert.ToInt32(await countCommand.ExecuteScalarAsync());
            }

            var totalPages = Math.Max(1, (int)Math.Ceiling(totalItems / (double)pageSize));
            var page = Math.Clamp(query.Page, 1, totalPages);
            var items = new List<TransactionSummary>();
            await using (var command = new NpgsqlCommand { Connection = connection })
            {
                command.CommandText = $@"
                    SELECT {TransactionStore.SummaryColumns}
                    FROM transactions t
                    {BuildFilter(query, command)}
                    ORDER BY t.date_time DESC, t.transaction_id DESC
                    LIMIT @limit OFFSET @offset";
                command.Parameters.AddWithValue("@limit", pageSize);
                command.Parameters.AddWithValue("@offset", (page - 1) * pageSize);
                await using var reader = await command.ExecuteReaderAsync();
                while (await reader.ReadAsync()) items.Add(TransactionStore.ReadSummary(reader));
            }

            return Ok(new { items, page, pageSize, totalItems, totalPages });
        }

        // Read-only view of one sale: what was bought and any exchanges made on it.
        [HttpGet("{transactionId:int}/details")]
        public async Task<IActionResult> GetTransactionDetails(int transactionId)
        {
            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync();

            var transaction = await TransactionStore.FindSummaryAsync(connection, transactionId);
            if (transaction == null) return NotFound(new { message = "Transaction was not found." });

            var items = await TransactionStore.ReadItemsAsync(connection, transactionId);
            var exchanges = await TransactionStore.ReadExchangesAsync(connection, transactionId, 50);
            var canExchange = transaction.StoredStatus == TransactionStatuses.Completed
                && ExchangePolicy.IsOpen(transaction.StoredDateTime)
                && items.Any(item => item.Quantity == ExchangePolicy.ItemQuantity);
            return Ok(new
            {
                transaction,
                items,
                exchanges,
                canExchange,
                exchangeUntil = ShopClock.DisplayDate(ExchangePolicy.LastDay(transaction.StoredDateTime))
            });
        }

        // Excel workbook of every sale that matches the current search and filters.
        [Authorize(Roles = UserRoles.Owner)]
        [HttpGet("export")]
        public async Task<IActionResult> ExportTransactions([FromQuery] TransactionQuery query)
        {
            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync();

            var transactions = new List<TransactionSheetRow>();
            await using (var command = new NpgsqlCommand { Connection = connection })
            {
                command.CommandText = $@"
                    SELECT t.transaction_id, t.reference_id, t.date_time, t.total_amount, t.status, t.has_exchange,
                           t.assisted_by, t.payment_method
                    FROM transactions t
                    {BuildFilter(query, command)}
                    ORDER BY t.date_time DESC, t.transaction_id DESC
                    LIMIT {MaxExportRows}";
                await using var reader = await command.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    transactions.Add(new TransactionSheetRow(
                        reader.GetInt32(0),
                        reader.IsDBNull(1) ? "" : reader.GetString(1),
                        reader.GetDateTime(2),
                        reader.IsDBNull(7) ? PaymentMethods.Unknown : reader.GetString(7),
                        reader.IsDBNull(6) ? "Unknown" : reader.GetString(6),
                        TransactionStatuses.Display(reader.IsDBNull(4) ? TransactionStatuses.Completed : reader.GetString(4), reader.GetBoolean(5)),
                        reader.GetDecimal(3)));
                }
            }

            var items = new List<TransactionItemSheetRow>();
            await using (var command = new NpgsqlCommand { Connection = connection })
            {
                command.CommandText = $@"
                    SELECT t.reference_id, ti.product_name, ti.category, ti.size, ti.color, ti.quantity, ti.unit_price, ti.exchange_reason
                    FROM transaction_items ti
                    JOIN (
                        SELECT t.transaction_id, t.reference_id, t.date_time
                        FROM transactions t
                        {BuildFilter(query, command)}
                        ORDER BY t.date_time DESC, t.transaction_id DESC
                        LIMIT {MaxExportRows}
                    ) t ON t.transaction_id = ti.transaction_id
                    ORDER BY t.date_time DESC, t.transaction_id DESC, ti.transaction_item_id";
                await using var reader = await command.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    items.Add(new TransactionItemSheetRow(
                        reader.IsDBNull(0) ? "" : reader.GetString(0),
                        reader.GetString(1),
                        reader.GetString(2),
                        reader.GetString(3),
                        reader.GetString(4),
                        reader.GetInt32(5),
                        reader.GetDecimal(6),
                        reader.GetString(7)));
                }
            }

            var fileName = $"crkd-transactions-{ShopClock.ToShopTime(DateTime.UtcNow):yyyyMMdd-HHmm}.xlsx";
            return File(TransactionExcel.Build(transactions, items), TransactionExcel.ContentType, fileName);
        }

        // WHERE clause for the search, status, payment and date filters; adds its parameters to command.
        private static string BuildFilter(TransactionQuery query, NpgsqlCommand command)
        {
            var conditions = new List<string>();

            var search = query.Search?.Trim();
            if (!string.IsNullOrEmpty(search))
            {
                var pattern = "%" + search.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";
                command.Parameters.AddWithValue("@search", pattern);
                command.Parameters.AddWithValue("@search_exact", search.TrimStart('#'));
                conditions.Add(@"(t.reference_id ILIKE @search
                    OR t.assisted_by ILIKE @search
                    OR CAST(t.transaction_id AS TEXT) = @search_exact
                    OR EXISTS (SELECT 1 FROM transaction_items ti
                               WHERE ti.transaction_id = t.transaction_id AND ti.product_name ILIKE @search))");
            }

            switch (TransactionStatuses.Normalize(query.Status))
            {
                case TransactionStatuses.Exchanged:
                    conditions.Add("t.has_exchange");
                    break;
                case string status:
                    command.Parameters.AddWithValue("@status", status);
                    conditions.Add("t.status = @status AND NOT t.has_exchange");
                    break;
            }

            switch (PaymentMethods.Normalize(query.Payment))
            {
                case PaymentMethods.Unknown:
                    conditions.Add("(t.payment_method IS NULL OR t.payment_method = 'Unknown')");
                    break;
                case string method:
                    command.Parameters.AddWithValue("@payment", method);
                    conditions.Add("t.payment_method = @payment");
                    break;
            }

            if (query.From is DateOnly from)
            {
                command.Parameters.AddWithValue("@from", ShopClock.StartOfDayUtc(from));
                conditions.Add("t.date_time >= @from");
            }

            if (query.To is DateOnly to)
            {
                command.Parameters.AddWithValue("@to", ShopClock.StartOfDayUtc(to.AddDays(1)));
                conditions.Add("t.date_time < @to");
            }

            return conditions.Count == 0 ? "" : "WHERE " + string.Join(" AND ", conditions);
        }
    }
}
