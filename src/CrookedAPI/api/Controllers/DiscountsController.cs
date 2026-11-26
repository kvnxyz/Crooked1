using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using Crooked.Models;
using Crooked.Services;

namespace Crooked.Controllers
{
    // Discount coupons and manual discounts. The owner creates and manages coupons, and sets the one
    // percentage staff can give with a manual discount, on the Discounts page; any signed-in cashier can
    // check a code (apply) or a manual discount (apply-manual) at the POS. The sale itself is saved by
    // TransactionController, which checks the discount again and records it.
    [Route("api/[controller]")]
    [ApiController]
    public partial class DiscountsController : ControllerBase
    {
        private const int MaxDescriptionLength = 100;
        private const int MaxUsageLimit = 1_000_000;
        private readonly string _connectionString = DatabaseConfig.ConnectionString;

        // 3 to 20 letters, numbers, dashes or underscores, starting with a letter or number.
        [GeneratedRegex("^[A-Z0-9][A-Z0-9_-]{2,19}$")]
        private static partial Regex CodePattern();

        [Authorize(Roles = UserRoles.Owner)]
        [HttpGet]
        public async Task<IActionResult> GetDiscounts()
        {
            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync();
            var today = ShopClock.Today;
            var discounts = await DiscountStore.ListAsync(connection);
            return Ok(discounts.Select(discount => new
            {
                id = discount.Id,
                code = discount.Code,
                description = discount.Description,
                type = discount.Type,
                value = discount.Value,
                label = discount.Label,
                minPurchase = discount.MinPurchase,
                maxUses = discount.MaxUses,
                timesUsed = discount.TimesUsed,
                validity = discount.Validity,
                status = discount.Status(today),
                isActive = discount.IsActive,
                createdBy = discount.CreatedBy,
                createdAt = ShopClock.Display(discount.CreatedAt)
            }));
        }

        [Authorize(Roles = UserRoles.Owner)]
        [HttpPost]
        [LiveUpdate(LiveTopics.Discounts, LiveTopics.Activity)]
        public async Task<IActionResult> CreateDiscount([FromBody] DiscountInput input)
        {
            var code = (input.Code ?? "").Trim().ToUpperInvariant();
            var description = (input.Description ?? "").Trim();
            var type = DiscountTypes.Normalize(input.Type);
            var minPurchase = input.MinPurchase ?? 0;

            if (!CodePattern().IsMatch(code))
                return BadRequest(new { message = "The code must be 3 to 20 letters, numbers, dashes or underscores." });
            if (description.Length > MaxDescriptionLength)
                return BadRequest(new { message = $"The description can be at most {MaxDescriptionLength} characters." });
            if (type == null)
                return BadRequest(new { message = "Choose a percentage or a fixed amount." });
            if (type == DiscountTypes.Percent && (input.Value < 1 || input.Value > 100 || input.Value != decimal.Truncate(input.Value)))
                return BadRequest(new { message = "A percentage discount must be a whole number from 1 to 100." });
            if (type == DiscountTypes.Fixed && !IsAmount(input.Value, allowZero: false))
                return BadRequest(new { message = $"A fixed discount must be more than ₱0.00 and at most {Money.Peso(StoredDiscount.MaxAmount)}." });
            if (!IsAmount(minPurchase, allowZero: true))
                return BadRequest(new { message = $"The minimum purchase must be from ₱0.00 to {Money.Peso(StoredDiscount.MaxAmount)}." });
            if (input.MaxUses is int maxUses && (maxUses < 1 || maxUses > MaxUsageLimit))
                return BadRequest(new { message = $"The usage limit must be from 1 to {MaxUsageLimit:N0}, or blank for no limit." });
            if (input.StartsOn is DateOnly startsOn && input.EndsOn is DateOnly endsOn && endsOn < startsOn)
                return BadRequest(new { message = "The end date must be on or after the start date." });
            if (input.EndsOn is DateOnly lastDay && lastDay < ShopClock.Today)
                return BadRequest(new { message = "The end date has already passed." });

            try
            {
                await using var connection = new NpgsqlConnection(_connectionString);
                await connection.OpenAsync();
                await using var dbTransaction = await connection.BeginTransactionAsync();

                await using (var command = new NpgsqlCommand(@"
                    INSERT INTO discounts (code, description, discount_type, value, min_purchase, max_uses, starts_on, ends_on, created_by)
                    VALUES (@code, @description, @type, @value, @min_purchase, @max_uses, @starts_on, @ends_on, @created_by)",
                    connection, dbTransaction))
                {
                    command.Parameters.AddWithValue("@code", code);
                    command.Parameters.AddWithValue("@description", description);
                    command.Parameters.AddWithValue("@type", type);
                    command.Parameters.AddWithValue("@value", input.Value);
                    command.Parameters.AddWithValue("@min_purchase", minPurchase);
                    command.Parameters.AddWithValue("@max_uses", (object?)input.MaxUses ?? DBNull.Value);
                    command.Parameters.AddWithValue("@starts_on", (object?)input.StartsOn ?? DBNull.Value);
                    command.Parameters.AddWithValue("@ends_on", (object?)input.EndsOn ?? DBNull.Value);
                    command.Parameters.AddWithValue("@created_by", SessionClaims.FullNameOf(User));
                    await command.ExecuteNonQueryAsync();
                }

                await ActivityLog.WriteAsync(connection, dbTransaction, SessionClaims.FullNameOf(User), ActivityTypes.Discount,
                    $"Created discount coupon: {code} ({StoredDiscount.LabelFor(type, input.Value)})");
                await dbTransaction.CommitAsync();
                return Ok(new { message = $"The coupon {code} has been created." });
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
            {
                return Conflict(new { message = $"Another coupon already uses the code {code}." });
            }
        }

        // Turns a coupon off (it stays in the list and can be turned back on) or on.
        [Authorize(Roles = UserRoles.Owner)]
        [HttpPost("{id:long}/toggle")]
        [LiveUpdate(LiveTopics.Discounts, LiveTopics.Activity)]
        public async Task<IActionResult> ToggleDiscount(long id, [FromQuery] bool active)
        {
            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync();
            await using var dbTransaction = await connection.BeginTransactionAsync();

            string? code;
            await using (var command = new NpgsqlCommand(
                "UPDATE discounts SET is_active = @active WHERE discount_id = @id RETURNING code", connection, dbTransaction))
            {
                command.Parameters.AddWithValue("@active", active);
                command.Parameters.AddWithValue("@id", id);
                code = await command.ExecuteScalarAsync() as string;
            }
            if (code == null) return NotFound(new { message = "The coupon was not found." });

            await ActivityLog.WriteAsync(connection, dbTransaction, SessionClaims.FullNameOf(User), ActivityTypes.Discount,
                $"{(active ? "Enabled" : "Disabled")} discount coupon: {code}");
            await dbTransaction.CommitAsync();
            return Ok(new { message = active ? $"The coupon {code} can be used again." : $"The coupon {code} has been turned off." });
        }

        // Sales that used the coupon keep its code and discount, so deleting it doesn't change them.
        [Authorize(Roles = UserRoles.Owner)]
        [HttpDelete("{id:long}")]
        [LiveUpdate(LiveTopics.Discounts, LiveTopics.Activity)]
        public async Task<IActionResult> DeleteDiscount(long id)
        {
            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync();
            await using var dbTransaction = await connection.BeginTransactionAsync();

            string? code;
            await using (var command = new NpgsqlCommand(
                "DELETE FROM discounts WHERE discount_id = @id RETURNING code", connection, dbTransaction))
            {
                command.Parameters.AddWithValue("@id", id);
                code = await command.ExecuteScalarAsync() as string;
            }
            if (code == null) return NotFound(new { message = "The coupon was not found." });

            await ActivityLog.WriteAsync(connection, dbTransaction, SessionClaims.FullNameOf(User), ActivityTypes.Discount,
                $"Deleted discount coupon: {code}");
            await dbTransaction.CommitAsync();
            return Ok(new { message = $"The coupon {code} has been deleted." });
        }

        // Coupons that can be used today, for the POS's discount dropdown. Any signed-in cashier.
        [HttpGet("available")]
        public async Task<IActionResult> GetAvailableDiscounts()
        {
            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync();
            var today = ShopClock.Today;
            var discounts = await DiscountStore.ListAsync(connection);
            return Ok(discounts
                .Where(discount => discount.Status(today) == DiscountStatuses.Active)
                .OrderBy(discount => discount.Code, StringComparer.Ordinal)
                .Select(discount => new
                {
                    code = discount.Code,
                    label = discount.Label,
                    description = discount.Description,
                    minPurchase = discount.MinPurchase
                }));
        }

        // The POS checking a code for the items in its checkout. Changes nothing: the use is
        // recorded when the sale is saved.
        [HttpPost("apply")]
        public async Task<IActionResult> ApplyDiscount([FromBody] DiscountApplyRequest request)
        {
            var code = (request.Code ?? "").Trim();
            if (code.Length == 0) return BadRequest(new { message = "Enter a discount code." });
            if (request.Items.Count == 0 || request.Items.Any(item => item.ProductId <= 0 || item.Quantity <= 0))
                return BadRequest(new { message = "Add products to the checkout before applying a discount code." });

            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync();

            var discount = await DiscountStore.FindByCodeAsync(connection, null, code);
            if (discount == null) return NotFound(new { message = DiscountStore.NotFound(code) });

            var subtotal = await DiscountStore.SubtotalAsync(connection, null, request.Items);
            var problem = discount.Problem(subtotal, ShopClock.Today);
            if (problem != null) return Conflict(new { message = problem });

            var amountOff = discount.AmountOff(subtotal);
            return Ok(new
            {
                code = discount.Code,
                description = discount.Description,
                type = discount.Type,
                value = discount.Value,
                label = discount.Label,
                minPurchase = discount.MinPurchase,
                subtotal,
                discountAmount = amountOff,
                total = subtotal - amountOff
            });
        }

        // Manual discount settings: fixedPercent is the percentage the signed-in person must use (null for
        // owners, who can give any; the staff percentage for staff, 0 when they can't give one), and
        // staffPercent the owner's setting for staff. Any signed-in cashier.
        [HttpGet("manual")]
        public async Task<IActionResult> GetManualDiscount()
        {
            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync();
            var staffPercent = await DiscountStore.StaffPercentAsync(connection, null);
            return Ok(new
            {
                fixedPercent = User.IsInRole(UserRoles.Owner) ? (int?)null : staffPercent,
                staffPercent
            });
        }

        // Sets the one percentage staff can give with a manual discount (0 turns it off for staff).
        [Authorize(Roles = UserRoles.Owner)]
        [HttpPost("manual")]
        [LiveUpdate(LiveTopics.Discounts, LiveTopics.Activity)]
        public async Task<IActionResult> SetManualDiscount([FromBody] ManualDiscountSettingsInput input)
        {
            var percent = input.StaffPercent;
            if (percent < 0 || percent > ManualDiscount.MaxPercent)
                return BadRequest(new { message = "The staff discount must be a whole number from 0 to 100." });

            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync();
            await using var dbTransaction = await connection.BeginTransactionAsync();

            var changedBy = SessionClaims.FullNameOf(User);
            await DiscountStore.SetStaffPercentAsync(connection, dbTransaction, percent, changedBy);
            await ActivityLog.WriteAsync(connection, dbTransaction, changedBy, ActivityTypes.Discount, percent == 0
                ? "Turned off manual discounts for staff"
                : $"Set the staff manual discount to {percent}%");
            await dbTransaction.CommitAsync();
            return Ok(new
            {
                message = percent == 0
                    ? "Staff can no longer give manual discounts."
                    : $"Staff can now only give a {percent}% manual discount.",
                staffPercent = percent
            });
        }

        // The POS checking a manual discount for the items in its checkout. Changes nothing.
        [HttpPost("apply-manual")]
        public async Task<IActionResult> ApplyManualDiscount([FromBody] ManualDiscountRequest request)
        {
            if (request.Items.Count == 0 || request.Items.Any(item => item.ProductId <= 0 || item.Quantity <= 0))
                return BadRequest(new { message = "Add products to the checkout before applying a discount." });

            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync();

            var fixedPercent = await DiscountStore.ManualFixedPercentAsync(connection, null, User);
            var problem = ManualDiscount.Problem(request.Percent, fixedPercent);
            if (problem != null) return Conflict(new { message = problem, fixedPercent });

            var percent = request.Percent!.Value;
            var subtotal = await DiscountStore.SubtotalAsync(connection, null, request.Items);
            var amountOff = ManualDiscount.AmountOff(subtotal, percent);
            return Ok(new
            {
                percent,
                label = ManualDiscount.Label(percent),
                fixedPercent,
                subtotal,
                discountAmount = amountOff,
                total = subtotal - amountOff
            });
        }

        private static bool IsAmount(decimal amount, bool allowZero) =>
            (allowZero ? amount >= 0 : amount > 0)
            && amount <= StoredDiscount.MaxAmount
            && decimal.Round(amount, 2) == amount;
    }
}
