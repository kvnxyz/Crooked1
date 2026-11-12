using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Crooked.Models;
using Crooked.Services;

namespace Crooked.Controllers;

[Route("api/[controller]")]
[ApiController]
public class ProductsController : ControllerBase
{
    private readonly string _connectionString = DatabaseConfig.ConnectionString;

    // "M / Black", or "" when it has no size or color.
    private static string VariantText(string? size, string? color) =>
        string.Join(" / ", new[] { size, color }.Where(part => !string.IsNullOrWhiteSpace(part)).Select(part => part!.Trim()));

    // "CRKD Tee (M / Black)", or just the name when it has no size or color.
    private static string ProductLabel(string? name, string? size, string? color)
    {
        var variant = VariantText(size, color);
        return variant.Length > 0 ? $"{name?.Trim()} ({variant})" : name?.Trim() ?? "";
    }

    // "M / Black", or "One Size" when it has no size or color.
    private static string VariantLabel(string? size, string? color)
    {
        var variant = VariantText(size, color);
        return variant.Length > 0 ? variant : "One Size";
    }

    private static string VariantCount(int count) => count == 1 ? "1 size or color" : $"{count} sizes and colors";

    private Task LogProductAsync(NpgsqlConnection connection, string action, NpgsqlTransaction? transaction = null) =>
        ActivityLog.WriteAsync(connection, transaction, SessionClaims.FullNameOf(User), ActivityTypes.Product, action);

    // Saves an uploaded product photo in wwwroot/images/products and returns its URL.
    private static async Task<string> SaveImageAsync(IFormFile file)
    {
        var folder = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot/images/products");
        Directory.CreateDirectory(folder);
        var fileName = Guid.NewGuid() + "_" + Path.GetFileName(file.FileName);
        await using var stream = new FileStream(Path.Combine(folder, fileName), FileMode.Create);
        await file.CopyToAsync(stream);
        return "/images/products/" + fileName;
    }

    private sealed record GroupRow(int Id, string Name, string Category, decimal Price);

    // The active rows of the product that row {id} belongs to: every size and color with the same
    // name and category (the grouping the Products page and the POS use). Locked until the
    // transaction ends. Empty when row {id} is missing or archived.
    private static async Task<List<GroupRow>> LockGroupAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, int id)
    {
        const string sql = @"
            SELECT p.id, COALESCE(p.product_name, ''), COALESCE(p.category, ''), COALESCE(p.price, 0)
            FROM products p
            JOIN products target ON target.id = @id AND target.is_active
            WHERE p.is_active
              AND COALESCE(p.product_name, '') = COALESCE(target.product_name, '')
              AND COALESCE(p.category, '') = COALESCE(target.category, '')
            ORDER BY p.id
            FOR UPDATE OF p";
        var rows = new List<GroupRow>();
        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("@id", id);
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new GroupRow(reader.GetInt32(0), reader.GetString(1), reader.GetString(2), reader.GetDecimal(3)));
        }
        return rows;
    }

    // Archives or restores a product and logs it. Returns the product's label, or null when no product changed.
    private async Task<string?> SetProductActiveAsync(int id, bool active)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();

        string? label = null;
        await using (var cmd = new NpgsqlCommand(
            "UPDATE products SET is_active = @active WHERE id = @id AND is_active = NOT @active RETURNING product_name, size, color",
            connection))
        {
            cmd.Parameters.AddWithValue("@active", active);
            cmd.Parameters.AddWithValue("@id", id);
            await using var reader = await cmd.ExecuteReaderAsync();
            if (await reader.ReadAsync())
            {
                label = ProductLabel(reader["product_name"] as string, reader["size"] as string, reader["color"] as string);
            }
        }

        if (label != null) await LogProductAsync(connection, $"{(active ? "Restored" : "Archived")} product: {label}");
        return label;
    }

    [HttpGet("get-inventory")]
    public IActionResult GetInventory()
    {
        var products = new List<object>();
        using (var connection = new NpgsqlConnection(_connectionString))
        {
            connection.Open();
            string sql = "SELECT id, product_name, category, size, color, price, stock_quantity, low_stock_threshold, image_url FROM products WHERE is_active = true";

            using (var cmd = new NpgsqlCommand(sql, connection))
            using (var reader = cmd.ExecuteReader())
            {
                while (reader.Read())
                {
                    var stock = Convert.ToInt32(reader["stock_quantity"]);
                    var threshold = Convert.ToInt32(reader["low_stock_threshold"]);
                    products.Add(new {
                        product_name = reader["product_name"].ToString(),
                        category = reader["category"].ToString(),
                        size = reader["size"] == DBNull.Value ? "" : reader["size"].ToString(),
                        color = reader["color"] == DBNull.Value ? "" : reader["color"].ToString(),
                        price = Convert.ToDecimal(reader["price"]),
                        stock_quantity = stock,
                        low_stock_threshold = threshold,
                        stock_status = StockStatus.Of(stock, threshold),
                        imageUrl = reader["image_url"].ToString()
                    });
                }
            }
        }
        return Ok(products);
    }

[Authorize(Roles = UserRoles.Owner)]
[HttpGet("get-products")]
public IActionResult GetProducts()
{
    var products = new List<object>();
    using (var connection = new NpgsqlConnection(_connectionString))
    {
        connection.Open();
        string sql = "SELECT id, product_name, category, price, stock_quantity, low_stock_threshold, size, color, image_url FROM products WHERE is_active = true";

        using (var cmd = new NpgsqlCommand(sql, connection))
        using (var reader = cmd.ExecuteReader())
        {
            while (reader.Read())
            {
                var stock = Convert.ToInt32(reader["stock_quantity"]);
                var threshold = Convert.ToInt32(reader["low_stock_threshold"]);
                products.Add(new {
                    id = Convert.ToInt32(reader["id"]),
                    product_name = reader["product_name"].ToString(),
                    category = reader["category"].ToString(),
                    price = Convert.ToDecimal(reader["price"]),
                    stock_quantity = stock,
                    low_stock_threshold = threshold,
                    stock_status = StockStatus.Of(stock, threshold),
                    size = reader["size"].ToString(),
                    color = reader["color"].ToString(),
                    image_url = reader["image_url"].ToString()
                });
            }
        }
    }
    return Ok(products);
}

    [Authorize(Roles = UserRoles.Owner)]
    [HttpGet("get-archived-products")]
    public IActionResult GetArchivedProducts()
    {
        var products = new List<object>();
        using (var connection = new NpgsqlConnection(_connectionString))
        {
            connection.Open();
            const string sql = @"SELECT id, product_name, category, price, stock_quantity,
                                        size, color, image_url
                                 FROM products
                                 WHERE is_active = false
                                 ORDER BY product_name";
            using (var cmd = new NpgsqlCommand(sql, connection))
            using (var reader = cmd.ExecuteReader())
            {
                while (reader.Read())
                {
                    products.Add(new
                    {
                        id = Convert.ToInt32(reader["id"]),
                        product_name = reader["product_name"].ToString(),
                        category = reader["category"].ToString(),
                        price = Convert.ToDecimal(reader["price"]),
                        stock_quantity = Convert.ToInt32(reader["stock_quantity"]),
                        size = reader["size"].ToString(),
                        color = reader["color"].ToString(),
                        image_url = reader["image_url"].ToString()
                    });
                }
            }
        }

        return Ok(products);
    }

    [Authorize(Roles = UserRoles.Owner)]
    [HttpPost("restore-product/{id}")]
    [LiveUpdate(LiveTopics.Products, LiveTopics.Activity)]
    public async Task<IActionResult> RestoreProduct(int id)
    {
        try
        {
            if (await SetProductActiveAsync(id, true) == null)
            {
                return NotFound(new { message = "Archived product was not found." });
            }

            return Ok(new { message = "Product restored successfully." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = ex.Message });
        }
    }

    [Authorize(Roles = UserRoles.Owner)]
    [HttpPut("update-product/{id}")]
    [LiveUpdate(LiveTopics.Products, LiveTopics.Activity)]
    public async Task<IActionResult> UpdateProduct(int id, [FromForm] ProductUploadDTO dto)
    {
        if (dto == null || string.IsNullOrWhiteSpace(dto.ProductName))
        {
            return BadRequest(new { message = "Product name is required." });
        }

        try
        {
            using (var connection = new NpgsqlConnection(_connectionString))
            {
                await connection.OpenAsync();
                string? imageUrl = null;

                // The price and stock before the edit, so the activity log can say what changed.
                decimal oldPrice;
                int oldStock;
                await using (var current = new NpgsqlCommand(
                    "SELECT COALESCE(price, 0), COALESCE(stock_quantity, 0) FROM products WHERE id = @id AND is_active = true", connection))
                {
                    current.Parameters.AddWithValue("@id", id);
                    await using var reader = await current.ExecuteReaderAsync();
                    if (!await reader.ReadAsync())
                    {
                        return NotFound(new { message = "Active product was not found." });
                    }
                    oldPrice = reader.GetDecimal(0);
                    oldStock = reader.GetInt32(1);
                }

                if (dto.ImageFile != null && dto.ImageFile.Length > 0)
                {
                    imageUrl = await SaveImageAsync(dto.ImageFile);
                }

                const string sql = @"
                    UPDATE products
                    SET product_name = @name,
                        category = @category,
                        price = @price,
                        stock_quantity = @stock,
                        size = @size,
                        color = @color,
                        image_url = COALESCE(@image, image_url)
                    WHERE id = @id AND is_active = true";
                using (var cmd = new NpgsqlCommand(sql, connection))
                {
                    cmd.Parameters.AddWithValue("@name", dto.ProductName.Trim());
                    cmd.Parameters.AddWithValue("@category", dto.Category);
                    cmd.Parameters.AddWithValue("@price", dto.Price);
                    cmd.Parameters.AddWithValue("@stock", dto.StockQuantity);
                    cmd.Parameters.AddWithValue("@size", dto.Size ?? string.Empty);
                    cmd.Parameters.AddWithValue("@color", dto.Color ?? string.Empty);
                    cmd.Parameters.AddWithValue("@image", (object?)imageUrl ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("@id", id);
                    if (await cmd.ExecuteNonQueryAsync() == 0)
                    {
                        return NotFound(new { message = "Active product was not found." });
                    }
                }

                var changes = new List<string>();
                if (dto.Price != oldPrice) changes.Add($"price {Money.Peso(oldPrice)} → {Money.Peso(dto.Price)}");
                if (dto.StockQuantity != oldStock) changes.Add($"stock {oldStock} → {dto.StockQuantity}");
                await LogProductAsync(connection, $"Updated product: {ProductLabel(dto.ProductName, dto.Size, dto.Color)}"
                    + (changes.Count > 0 ? $" ({string.Join(", ", changes)})" : ""));
            }

            return Ok(new { message = "Product updated successfully." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = ex.Message });
        }
    }

    [Authorize(Roles = UserRoles.Owner)]
    [HttpPost("archive-product/{id}")]
    [LiveUpdate(LiveTopics.Products, LiveTopics.Activity)]
    public async Task<IActionResult> ArchiveProduct(int id)
    {
        try
        {
            if (await SetProductActiveAsync(id, false) == null)
            {
                return NotFound(new { message = "Product was not found or is already archived." });
            }
            return Ok(new { message = "Product archive status updated successfully!" });
        }
        catch (Exception ex)
        {
            return StatusCode(500, $"Internal error: {ex.Message}");
        }
    }

    // Archives every size and color of a product (the one row {id} belongs to) with one log entry.
    [Authorize(Roles = UserRoles.Owner)]
    [HttpPost("archive-group/{id}")]
    [LiveUpdate(LiveTopics.Products, LiveTopics.Activity)]
    public async Task<IActionResult> ArchiveGroup(int id)
    {
        try
        {
            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();

            var group = await LockGroupAsync(connection, transaction, id);
            if (group.Count == 0) return NotFound(new { message = "Product was not found or is already archived." });

            await using (var command = new NpgsqlCommand(
                "UPDATE products SET is_active = false WHERE id = ANY(@ids)", connection, transaction))
            {
                command.Parameters.AddWithValue("@ids", group.Select(row => row.Id).ToArray());
                await command.ExecuteNonQueryAsync();
            }

            await LogProductAsync(connection, $"Archived product: {group[0].Name} ({VariantCount(group.Count)})", transaction);
            await transaction.CommitAsync();
            return Ok(new { message = "Product archived.", archived = group.Count });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = ex.Message });
        }
    }

    // Changes what every size and color of a product shares: its name, category, price and
    // (when a file is uploaded) its photo. Sizes, colors and stock stay as they are.
    [Authorize(Roles = UserRoles.Owner)]
    [HttpPut("update-details/{id}")]
    [LiveUpdate(LiveTopics.Products, LiveTopics.Activity)]
    public async Task<IActionResult> UpdateDetails(int id, [FromForm] ProductDetailsForm form)
    {
        var name = ProductRules.Clean(form.ProductName);
        var category = ProductRules.Clean(form.Category);
        var problem = ProductRules.DetailsProblem(name, category, form.Price);
        if (problem != null) return BadRequest(new { message = problem });

        try
        {
            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();

            var group = await LockGroupAsync(connection, transaction, id);
            if (group.Count == 0) return NotFound(new { message = "Active product was not found." });
            var old = group[0];

            // Taking another product's name and category (ignoring case, archived ones included)
            // would mix two products' sizes and colors.
            await using (var taken = new NpgsqlCommand(@"
                SELECT EXISTS (
                    SELECT 1 FROM products
                    WHERE lower(trim(COALESCE(product_name, ''))) = lower(@name)
                      AND lower(trim(COALESCE(category, ''))) = lower(@category)
                      AND NOT (COALESCE(product_name, '') = @oldName AND COALESCE(category, '') = @oldCategory))",
                connection, transaction))
            {
                taken.Parameters.AddWithValue("@name", name);
                taken.Parameters.AddWithValue("@category", category);
                taken.Parameters.AddWithValue("@oldName", old.Name);
                taken.Parameters.AddWithValue("@oldCategory", old.Category);
                if (await taken.ExecuteScalarAsync() is true)
                {
                    return Conflict(new { message = $"Another product is already called \"{name}\" in {category}. Use a different name or category." });
                }
            }

            var imageUrl = form.ImageFile is { Length: > 0 } ? await SaveImageAsync(form.ImageFile) : null;
            await using (var command = new NpgsqlCommand(@"
                UPDATE products
                SET product_name = @name, category = @category, price = @price, image_url = COALESCE(@image, image_url)
                WHERE id = ANY(@ids)", connection, transaction))
            {
                command.Parameters.AddWithValue("@name", name);
                command.Parameters.AddWithValue("@category", category);
                command.Parameters.AddWithValue("@price", form.Price);
                command.Parameters.AddWithValue("@image", (object?)imageUrl ?? DBNull.Value);
                command.Parameters.AddWithValue("@ids", group.Select(row => row.Id).ToArray());
                await command.ExecuteNonQueryAsync();
            }

            var changes = new List<string>();
            var oldPrices = group.Select(row => row.Price).Distinct().ToList();
            if (oldPrices.Count > 1) changes.Add($"price set to {Money.Peso(form.Price)}");
            else if (oldPrices[0] != form.Price) changes.Add($"price {Money.Peso(oldPrices[0])} → {Money.Peso(form.Price)}");
            if (name != old.Name) changes.Add($"renamed from {old.Name}");
            if (category != old.Category) changes.Add($"category {old.Category} → {category}");
            if (imageUrl != null) changes.Add("new photo");
            var details = changes.Count > 0 ? $"{string.Join(", ", changes)}; " : "";
            await LogProductAsync(connection, $"Updated product: {name} ({details}{VariantCount(group.Count)})", transaction);

            await transaction.CommitAsync();
            return Ok(new { message = "Product details saved.", productName = name, category });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = ex.Message });
        }
    }

    // Adds a product with its sizes and colors, or more sizes and colors of a product that exists,
    // in one transaction. A size and color the product already has (or had, before it was
    // archived) is refused, so the same item never gets a second row.
    [Authorize(Roles = UserRoles.Owner)]
    [HttpPost("add-variants")]
    [LiveUpdate(LiveTopics.Products, LiveTopics.Activity)]
    public async Task<IActionResult> AddVariants([FromForm] ProductVariantsForm form)
    {
        var name = ProductRules.Clean(form.ProductName);
        var category = ProductRules.Clean(form.Category);
        var problem = ProductRules.DetailsProblem(name, category, form.Price) ?? ProductRules.VariantsProblem(form.Variants);
        if (problem != null) return BadRequest(new { message = problem });

        var variants = form.Variants
            .Select(variant => (Size: ProductRules.Clean(variant.Size), Color: ProductRules.Clean(variant.Color), Stock: variant.StockQuantity))
            .ToList();
        var repeated = variants
            .GroupBy(variant => (ProductRules.Key(variant.Size), ProductRules.Key(variant.Color)))
            .FirstOrDefault(sameVariant => sameVariant.Count() > 1);
        if (repeated != null)
        {
            var first = repeated.First();
            return BadRequest(new { message = $"{VariantLabel(first.Size, first.Color)} is listed more than once." });
        }

        try
        {
            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();

            // The sizes and colors this product already has, active or archived, ignoring case.
            var existing = new List<(string Name, string Category, decimal Price, string Size, string Color, bool IsActive)>();
            await using (var command = new NpgsqlCommand(@"
                SELECT COALESCE(product_name, ''), COALESCE(category, ''), COALESCE(price, 0),
                       COALESCE(size, ''), COALESCE(color, ''), is_active
                FROM products
                WHERE lower(trim(COALESCE(product_name, ''))) = lower(@name)
                  AND lower(trim(COALESCE(category, ''))) = lower(@category)
                ORDER BY id
                FOR UPDATE", connection, transaction))
            {
                command.Parameters.AddWithValue("@name", name);
                command.Parameters.AddWithValue("@category", category);
                await using var reader = await command.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    existing.Add((reader.GetString(0), reader.GetString(1), reader.GetDecimal(2),
                        reader.GetString(3), reader.GetString(4), reader.GetBoolean(5)));
                }
            }

            foreach (var variant in variants)
            {
                var match = existing.FirstOrDefault(row =>
                    ProductRules.Key(row.Size) == ProductRules.Key(variant.Size)
                    && ProductRules.Key(row.Color) == ProductRules.Key(variant.Color));
                if (match == default) continue;

                var label = $"{name} · {VariantLabel(variant.Size, variant.Color)}";
                return Conflict(new
                {
                    message = match.IsActive
                        ? $"{label} already exists. Change its stock from Manage instead."
                        : $"{label} is archived. Restore it from Archived Products instead."
                });
            }

            // More sizes of a product that exists keep its spelling and, when its sizes share
            // one price, that price, so they stay on the same card.
            var active = existing.Where(row => row.IsActive).ToList();
            var addingToExisting = active.Count > 0;
            var price = form.Price;
            if (addingToExisting)
            {
                name = active[0].Name;
                category = active[0].Category;
                var prices = active.Select(row => row.Price).Distinct().ToList();
                if (prices.Count == 1) price = prices[0];
            }

            string imageUrl = ProductRules.DefaultImageUrl;
            if (form.ImageFile is { Length: > 0 })
            {
                imageUrl = await SaveImageAsync(form.ImageFile);
            }
            else if (form.PhotoFromId is int photoFromId)
            {
                await using var photo = new NpgsqlCommand("SELECT image_url FROM products WHERE id = @id", connection, transaction);
                photo.Parameters.AddWithValue("@id", photoFromId);
                if (await photo.ExecuteScalarAsync() is string url && url.Length > 0) imageUrl = url;
            }

            foreach (var variant in variants)
            {
                await using var insert = new NpgsqlCommand(@"
                    INSERT INTO products (product_name, category, price, stock_quantity, size, color, image_url)
                    VALUES (@name, @category, @price, @stock, @size, @color, @image)", connection, transaction);
                insert.Parameters.AddWithValue("@name", name);
                insert.Parameters.AddWithValue("@category", category);
                insert.Parameters.AddWithValue("@price", price);
                insert.Parameters.AddWithValue("@stock", variant.Stock);
                insert.Parameters.AddWithValue("@size", variant.Size);
                insert.Parameters.AddWithValue("@color", variant.Color);
                insert.Parameters.AddWithValue("@image", imageUrl);
                await insert.ExecuteNonQueryAsync();
            }

            var labels = string.Join(", ", variants.Select(variant => VariantLabel(variant.Size, variant.Color)));
            var stock = variants.Sum(variant => variant.Stock);
            await LogProductAsync(connection, addingToExisting
                ? $"Added to product {name}: {labels} (stock {stock})"
                : $"Added product: {name} ({labels}; {Money.Peso(price)}, stock {stock})", transaction);

            await transaction.CommitAsync();
            return Ok(new { message = "Product saved.", added = variants.Count, productName = name, category });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = ex.Message });
        }
    }
}
