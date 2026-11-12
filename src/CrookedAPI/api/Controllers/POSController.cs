using Microsoft.AspNetCore.Mvc;
using Npgsql;
using Crooked.Models;
using Crooked.Services;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System;

namespace Crooked.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class POSController : ControllerBase
    {
        private readonly string _connectionString = DatabaseConfig.ConnectionString;

        [HttpGet("products")]
        public async Task<IActionResult> GetProducts()
        {
            var products = new List<Product>();

            using (var conn = new NpgsqlConnection(_connectionString))
            {
                string query = @"SELECT id, product_name, category, price, stock_quantity, size, color, image_url
                                 FROM Products
                                 WHERE is_active = true
                                 ORDER BY product_name, size, color";
                var cmd = new NpgsqlCommand(query, conn);
                await conn.OpenAsync();
                var reader = await cmd.ExecuteReaderAsync();

                while (await reader.ReadAsync())
                {
                    products.Add(new Product
                    {
                        Id = reader.GetInt32(0),
                        Product_Name = reader.IsDBNull(1) ? "" : reader.GetString(1),
                        Category = reader.IsDBNull(2) ? "" : reader.GetString(2),
                        Price = reader.IsDBNull(3) ? 0 : reader.GetDecimal(3),
                        Stock_Quantity = reader.IsDBNull(4) ? 0 : reader.GetInt32(4),
                        Size = reader.IsDBNull(5) ? "" : reader.GetString(5),
                        Color = reader.IsDBNull(6) ? "" : reader.GetString(6),
                        ImageUrl = reader.IsDBNull(7) ? "" : reader.GetString(7)
                    });
                }
            }

            return Ok(products);
        }

        // A sale's stock is taken in the same database transaction that saves it
        // (POST /api/POS/Transaction, TransactionController.SaveTransaction).
    }
}