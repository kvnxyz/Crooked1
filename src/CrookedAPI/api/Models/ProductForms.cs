using Microsoft.AspNetCore.Http;

namespace Crooked.Models
{
    // PUT /api/Products/update-details/{id}: what every size and color of a product shares.
    public sealed class ProductDetailsForm
    {
        public string? ProductName { get; set; }
        public string? Category { get; set; }
        public decimal Price { get; set; }
        public IFormFile? ImageFile { get; set; }
    }

    // POST /api/Products/add-variants: a new product with its sizes and colors, or more sizes and
    // colors of one that exists. Sent as Variants[0].Size, Variants[0].Color, Variants[0].StockQuantity, ...
    public sealed class ProductVariantsForm
    {
        public string? ProductName { get; set; }
        public string? Category { get; set; }
        public decimal Price { get; set; }
        public IFormFile? ImageFile { get; set; }
        // With no uploaded file, the new rows use this product row's photo.
        public int? PhotoFromId { get; set; }
        public List<VariantInput> Variants { get; set; } = new();
    }

    public sealed class VariantInput
    {
        public string? Size { get; set; }
        public string? Color { get; set; }
        public int StockQuantity { get; set; }
    }

    // Limits and comparisons shared by the product forms.
    public static class ProductRules
    {
        public const decimal MaxPrice = 99999.99m;
        public const int MaxVariants = 50;
        public const int MaxVariantLength = 30;
        public const int MaxNameLength = 100;
        public const int MaxCategoryLength = 50;

        public static string Clean(string? value) => (value ?? "").Trim();

        // Names, categories, sizes and colors match ignoring case and surrounding spaces.
        public static string Key(string? value) => Clean(value).ToLowerInvariant();

        // Why the shared details can't be saved, or null when they can.
        public static string? DetailsProblem(string name, string category, decimal price)
        {
            if (name.Length == 0) return "Product name is required.";
            if (name.Length > MaxNameLength) return $"Product name must be {MaxNameLength} characters or fewer.";
            if (category.Length == 0) return "Category is required.";
            if (category.Length > MaxCategoryLength) return $"Category must be {MaxCategoryLength} characters or fewer.";
            if (price < 0 || price > MaxPrice || price != decimal.Round(price, 2))
                return "Price must be from ₱0.00 to ₱99,999.99, with up to 2 decimal places.";
            return null;
        }

        // Why the sizes and colors can't be added, or null when they can.
        public static string? VariantsProblem(IReadOnlyList<VariantInput>? variants)
        {
            if (variants == null || variants.Count == 0) return "Add at least one size or color.";
            if (variants.Count > MaxVariants) return $"Add at most {MaxVariants} sizes and colors at a time.";
            if (variants.Any(variant => Clean(variant.Size).Length > MaxVariantLength || Clean(variant.Color).Length > MaxVariantLength))
                return $"Sizes and colors must be {MaxVariantLength} characters or fewer.";
            if (variants.Any(variant => variant.StockQuantity < 0)) return "Stock must be a whole number of 0 or more.";
            return null;
        }
    }
}
