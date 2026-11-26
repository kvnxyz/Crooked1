using System.Globalization;

namespace Crooked.Services
{
    // The shop keeps Philippine time (UTC+8, no daylight saving) while servers such as
    // Railway run on UTC, so dates are converted explicitly instead of using server local time.
    public static class ShopClock
    {
        private static readonly TimeSpan Offset = TimeSpan.FromHours(8);

        // Stored transaction times are UTC; Npgsql returns them as Utc or Unspecified kind.
        public static DateTime ToShopTime(DateTime storedUtc)
        {
            var utc = storedUtc.Kind == DateTimeKind.Local
                ? storedUtc.ToUniversalTime()
                : DateTime.SpecifyKind(storedUtc, DateTimeKind.Utc);
            return DateTime.SpecifyKind(utc.Add(Offset), DateTimeKind.Unspecified);
        }

        public static DateTime ToUtc(DateTime shopTime) =>
            DateTime.SpecifyKind(DateTime.SpecifyKind(shopTime, DateTimeKind.Unspecified) - Offset, DateTimeKind.Utc);

        public static DateTime StartOfDayUtc(DateOnly shopDay) => ToUtc(shopDay.ToDateTime(TimeOnly.MinValue));

        public static DateOnly Today => ShopDate(DateTime.UtcNow);

        public static DateOnly ShopDate(DateTime storedUtc) => DateOnly.FromDateTime(ToShopTime(storedUtc));

        public static string DisplayDate(DateOnly shopDay) =>
            shopDay.ToString("MMM dd, yyyy", CultureInfo.InvariantCulture);

        public static string Display(DateTime storedUtc) =>
            ToShopTime(storedUtc).ToString("MMM dd, yyyy · hh:mm tt", CultureInfo.InvariantCulture);

        // The time of day only, such as "02:45 PM" (the void deadline, which is always within 30 minutes).
        public static string DisplayTime(DateTime storedUtc) =>
            ToShopTime(storedUtc).ToString("hh:mm tt", CultureInfo.InvariantCulture);

        public static string Iso(DateTime storedUtc) =>
            new DateTimeOffset(ToShopTime(storedUtc), Offset).ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture);
    }
}
