namespace Crooked.Models
{
    // The one rule for "low stock", sent with each product as stock_status so every page labels a
    // size or color the same way. A variant is low when its stock is at or below its own
    // low_stock_threshold, which ThresholdForecastService sets to CoverageDays of predicted sales
    // (a new product keeps the column's default of 5 until its first forecast).
    public static class StockStatus
    {
        public const string InStock = "in";
        public const string Low = "low";
        public const string Out = "out";

        public static string Of(int stock, int threshold) =>
            stock <= 0 ? Out : stock <= threshold ? Low : InStock;
    }
}
