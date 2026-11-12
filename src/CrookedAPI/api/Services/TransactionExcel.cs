using ClosedXML.Excel;
using Crooked.Models;

namespace Crooked.Services
{
    // Builds the transactions workbook for the Audit Logs export: one sheet of sales and one of their items.
    public static class TransactionExcel
    {
        public const string ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

        private const string TransactionsSheet = "Transactions";
        private const string ItemsSheet = "Items";
        private const string PesoFormat = "\"₱\"#,##0.00";
        private const string DateFormat = "yyyy-mm-dd hh:mm AM/PM";

        private static readonly (string Name, double Width)[] TransactionColumns =
        {
            ("Transaction ID", 16), ("Reference ID", 30), ("Date & Time", 24), ("Payment Method", 18),
            ("Sold By", 22), ("Status", 14), ("Total Amount", 16)
        };

        private static readonly (string Name, double Width)[] ItemColumns =
        {
            ("Reference ID", 30), ("Product", 28), ("Category", 16), ("Size", 10), ("Color", 14),
            ("Quantity", 10), ("Unit Price", 14), ("Line Total", 14), ("Exchange Reason", 22)
        };

        public static byte[] Build(IReadOnlyList<TransactionSheetRow> transactions, IReadOnlyList<TransactionItemSheetRow> items)
        {
            using var workbook = new XLWorkbook();
            WriteTransactions(workbook, transactions);
            WriteItems(workbook, items);
            return Save(workbook);
        }

        private static void WriteTransactions(XLWorkbook workbook, IReadOnlyList<TransactionSheetRow> transactions)
        {
            var sheet = AddSheet(workbook, TransactionsSheet, TransactionColumns);
            var row = 2;
            foreach (var transaction in transactions)
            {
                sheet.Cell(row, 1).Value = transaction.TransactionId;
                sheet.Cell(row, 2).Value = transaction.ReferenceId;
                sheet.Cell(row, 3).Value = ShopClock.ToShopTime(transaction.DateTimeUtc);
                sheet.Cell(row, 3).Style.DateFormat.Format = DateFormat;
                sheet.Cell(row, 4).Value = transaction.PaymentMethod;
                sheet.Cell(row, 5).Value = transaction.SoldBy;
                sheet.Cell(row, 6).Value = transaction.Status;
                sheet.Cell(row, 7).Value = transaction.TotalAmount;
                sheet.Cell(row, 7).Style.NumberFormat.Format = PesoFormat;
                row++;
            }
        }

        private static void WriteItems(XLWorkbook workbook, IReadOnlyList<TransactionItemSheetRow> items)
        {
            var sheet = AddSheet(workbook, ItemsSheet, ItemColumns);
            var row = 2;
            foreach (var item in items)
            {
                sheet.Cell(row, 1).Value = item.ReferenceId;
                sheet.Cell(row, 2).Value = item.ProductName;
                sheet.Cell(row, 3).Value = item.Category;
                sheet.Cell(row, 4).Value = item.Size;
                sheet.Cell(row, 5).Value = item.Color;
                sheet.Cell(row, 6).Value = item.Quantity;
                sheet.Cell(row, 7).Value = item.UnitPrice;
                sheet.Cell(row, 8).Value = item.UnitPrice * item.Quantity;
                sheet.Cell(row, 9).Value = item.ExchangeReason;
                sheet.Range(row, 7, row, 8).Style.NumberFormat.Format = PesoFormat;
                row++;
            }
        }

        private static IXLWorksheet AddSheet(XLWorkbook workbook, string name, (string Name, double Width)[] columns)
        {
            var sheet = workbook.Worksheets.Add(name);
            for (var index = 0; index < columns.Length; index++)
            {
                var cell = sheet.Cell(1, index + 1);
                cell.Value = columns[index].Name;
                sheet.Column(index + 1).Width = columns[index].Width;
            }

            var header = sheet.Range(1, 1, 1, columns.Length);
            header.Style.Font.Bold = true;
            header.Style.Font.FontColor = XLColor.White;
            header.Style.Fill.BackgroundColor = XLColor.FromHtml("#111111");
            header.SetAutoFilter();
            sheet.SheetView.FreezeRows(1);
            return sheet;
        }

        private static byte[] Save(XLWorkbook workbook)
        {
            using var stream = new MemoryStream();
            workbook.SaveAs(stream);
            return stream.ToArray();
        }
    }
}
