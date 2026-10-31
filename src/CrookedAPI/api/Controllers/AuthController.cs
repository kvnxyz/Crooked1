using Microsoft.AspNetCore.Mvc;
using Npgsql;
using Crooked.Models;
using Crooked.Services;
using System.Collections.Generic;
using System;

namespace Crooked.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class AuthController : ControllerBase
    {
        // Tinatawag nya yung connection string mula sa DatabaseConfig.cs
        private readonly string _connectionString = DatabaseConfig.ConnectionString;

        [HttpPost("login")]
        [LiveUpdate(LiveTopics.Activity)]
        public IActionResult Login([FromBody] User loginRequest)
        {
            try 
            {
                using (var connection = new NpgsqlConnection(_connectionString))
                {
                    connection.Open();

                    string sql = "SELECT role, full_name FROM users WHERE username = @user AND password = @pass AND is_active = true";
                    using (var cmd = new NpgsqlCommand(sql, connection))
                    {
                        cmd.Parameters.AddWithValue("@user", loginRequest.Username);
                        cmd.Parameters.AddWithValue("@pass", loginRequest.Password);

                        using (var reader = cmd.ExecuteReader())
                        {
                            if (reader.Read())
                            {
                                string role = reader["role"].ToString();
                                string fullName = reader["full_name"].ToString();
                                reader.Close(); 

                                var logSql = "INSERT INTO activity_logs (staff_name, action, date_occurred) VALUES (@name, 'Logged into the system', NOW())";                            
                                using (var logCmd = new NpgsqlCommand(logSql, connection))
                                {
                                    logCmd.Parameters.AddWithValue("@name", fullName);
                                    logCmd.ExecuteNonQuery();
                                }

                                return Ok(new { role, fullName });
                            }
                        }
                    }
                }
                return Unauthorized(new { message = "Account archived or invalid credentials." });
            }
            catch (Exception ex)
            {
                Console.WriteLine("Database Error: " + ex.Message);
                return StatusCode(500, new { message = "Database Error: " + ex.Message });
            }
        }

        [HttpGet("dashboard-stats")]
        public IActionResult GetStats()
        {
            try
            {
                using (var connection = new NpgsqlConnection(_connectionString))
                {
                    connection.Open();
                    var sql = "SELECT COUNT(*) FROM users WHERE is_active = true";
                    using (var cmd = new NpgsqlCommand(sql, connection))
                    {
                        var count = Convert.ToInt32(cmd.ExecuteScalar());
                        return Ok(new { totalUsers = count });
                    }
                }
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = ex.Message });
            }
        }

        [HttpPost("toggle-archive/{id}")]
        [LiveUpdate(LiveTopics.Staff, LiveTopics.Activity)]
        public IActionResult ToggleArchive(int id, [FromQuery] bool archive)
        {
            try
            {
                using (var connection = new NpgsqlConnection(_connectionString))
                {
                    connection.Open();
                    string staffName;

                    using (var nameCmd = new NpgsqlCommand(
                        "SELECT full_name FROM users WHERE id = @id AND role = 'staff'", connection))
                    {
                        nameCmd.Parameters.AddWithValue("@id", id);
                        staffName = nameCmd.ExecuteScalar()?.ToString();
                    }

                    if (staffName == null)
                    {
                        return NotFound(new { message = "Staff account not found." });
                    }

                    const string updateSql = "UPDATE users SET is_active = @status WHERE id = @id AND role = 'staff'";
                    using (var cmd = new NpgsqlCommand(updateSql, connection))
                    {
                        cmd.Parameters.AddWithValue("@status", !archive);
                        cmd.Parameters.AddWithValue("@id", id);
                        if (cmd.ExecuteNonQuery() == 0)
                        {
                            return NotFound(new { message = "Staff account not found." });
                        }
                    }

                    var logSql = "INSERT INTO activity_logs (staff_name, action, date_occurred) VALUES ('Main Owner', @action, NOW())";
                    using (var logCmd = new NpgsqlCommand(logSql, connection))
                    {
                        logCmd.Parameters.AddWithValue("@action", archive ? $"Archived: {staffName}" : $"Unarchived: {staffName}");
                        logCmd.ExecuteNonQuery();
                    }
                }

                return Ok(new { message = archive ? "Staff account archived." : "Staff account restored." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = ex.Message });
            }
        }

        [HttpGet("get-staff")]
        public IActionResult GetStaff()
        {
            var staffList = new List<object>();
            using (var connection = new NpgsqlConnection(_connectionString))
            {
                connection.Open();
                var sql = "SELECT id, full_name, username, is_active FROM users WHERE role = 'staff'";
                using (var cmd = new NpgsqlCommand(sql, connection))
                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        staffList.Add(new { 
                            id = reader["id"], 
                            fullName = reader["full_name"], 
                            username = reader["username"],
                            isActive = Convert.ToBoolean(reader["is_active"])
                        });
                    }
                }
            }
            return Ok(staffList);
        }

        [HttpGet("get-logs")]
        public IActionResult GetLogs()
        {
            var logs = new List<object>();
            using (var connection = new NpgsqlConnection(_connectionString))
            {
                connection.Open();
                var sql = "SELECT staff_name, action, date_occurred FROM activity_logs ORDER BY date_occurred DESC LIMIT 10";
                using (var cmd = new NpgsqlCommand(sql, connection))
                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        logs.Add(new { 
                            staffName = reader["staff_name"], 
                            action = reader["action"], 
                            dateOccurred = reader["date_occurred"] 
                        });
                    }
                }
            }
            return Ok(logs);
        }

        [HttpPost("register-staff")]
        [LiveUpdate(LiveTopics.Staff)]
        public IActionResult RegisterStaff([FromBody] User request)
        {
            if (!PasswordPolicy.IsValid(request.Password))
            {
                return BadRequest(new { message = PasswordPolicy.Description });
            }

            using (var connection = new NpgsqlConnection(_connectionString))
            {
                connection.Open();
                var sql = "INSERT INTO users (username, password, role, full_name, is_active) VALUES (@user, @pass, 'staff', @name, true)";
                using (var cmd = new NpgsqlCommand(sql, connection))
                {
                    cmd.Parameters.AddWithValue("@user", request.Username);
                    cmd.Parameters.AddWithValue("@pass", request.Password);
                    cmd.Parameters.AddWithValue("@name", request.FullName);
                    cmd.ExecuteNonQuery();
                }
            }
            return Ok();
        }

        [HttpPost("reset-password")]
public IActionResult ResetPassword([FromBody] ResetRequest request)
{

    string masterRecoveryKey = "CRKD_OWNER_2026"; 

    if (request.RecoveryKey != masterRecoveryKey)
    {
        return BadRequest(new { message = "Invalid Recovery Key!" });
    }

    if (!PasswordPolicy.IsValid(request.NewPassword))
    {
        return BadRequest(new { message = PasswordPolicy.Description });
    }

    try
    {
        using (var connection = new NpgsqlConnection(_connectionString))
        {
            connection.Open();

            var sql = "UPDATE users SET password = @newPass WHERE username = @user AND role = 'owner'";
            using (var cmd = new NpgsqlCommand(sql, connection))
            {
                cmd.Parameters.AddWithValue("@newPass", request.NewPassword);
                cmd.Parameters.AddWithValue("@user", request.Username);
                
                int rowsAffected = cmd.ExecuteNonQuery();
                if (rowsAffected > 0)
                {
                    return Ok(new { message = "Owner password reset successfully!" });
                }
                else
                {
                    return BadRequest(new { message = "Owner username not found." });
                }
            }
        }
    }
                catch (Exception ex)
                {
                    return StatusCode(500, new { message = ex.Message });
            }
        }
    }
}