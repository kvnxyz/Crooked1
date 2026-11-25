using System.Net;
using System.Net.Http.Json;
using System.Net.Mail;

namespace Crooked.Services
{
    // Sends the app's emails (the Forgot Password codes). Set these on the server (Railway variables):
    //   EMAIL_FROM        the sender address; the email service must accept it as a sender
    //   EMAIL_FROM_NAME   optional, the sender's name (default "CRKD Clothing Shop")
    // and one of
    //   BREVO_API_KEY     sends through Brevo's HTTPS API, which works on every Railway plan, or
    //   SMTP_HOST, SMTP_PORT (default 587), SMTP_USERNAME, SMTP_PASSWORD
    //                     sends through an SMTP server with STARTTLS (port 587, not 465), such as
    //                     smtp.gmail.com with a Gmail app password. Railway only allows outgoing
    //                     SMTP on its Pro plan.
    // Without them a local Development run (dotnet run) writes each email to the console instead,
    // and any other run can't send email (Enabled is false).
    public sealed class EmailSender
    {
        private const string DefaultFromName = "CRKD Clothing Shop";
        private const string BrevoUrl = "https://api.brevo.com/v3/smtp/email";
        private static readonly TimeSpan SendTimeout = TimeSpan.FromSeconds(20);

        private readonly IHttpClientFactory _httpClientFactory;
        private readonly ILogger<EmailSender> _logger;
        private readonly string? _from;
        private readonly string _fromName;
        private readonly string? _brevoKey;
        private readonly string? _smtpHost;
        private readonly int _smtpPort;
        private readonly string? _smtpUsername;
        private readonly string? _smtpPassword;

        private enum Transport { None, Brevo, Smtp, Console }
        private readonly Transport _transport;

        public EmailSender(IConfiguration configuration, IHostEnvironment environment,
            IHttpClientFactory httpClientFactory, ILogger<EmailSender> logger)
        {
            _httpClientFactory = httpClientFactory;
            _logger = logger;

            _from = Clean(configuration["EMAIL_FROM"]);
            _fromName = Clean(configuration["EMAIL_FROM_NAME"]) ?? DefaultFromName;
            _brevoKey = Clean(configuration["BREVO_API_KEY"]);
            _smtpHost = Clean(configuration["SMTP_HOST"]);
            _smtpPort = int.TryParse(Clean(configuration["SMTP_PORT"]), out var port) ? port : 587;
            _smtpUsername = Clean(configuration["SMTP_USERNAME"]);
            _smtpPassword = Clean(configuration["SMTP_PASSWORD"]);

            if (_from != null && _brevoKey != null) _transport = Transport.Brevo;
            else if (_from != null && _smtpHost != null) _transport = Transport.Smtp;
            else if (environment.IsDevelopment()) _transport = Transport.Console;

            switch (_transport)
            {
                case Transport.Brevo:
                case Transport.Smtp:
                    logger.LogInformation("Emails are sent through {Transport} from {From}.", _transport, _from);
                    break;
                case Transport.Console:
                    logger.LogWarning("Email isn't set up, so emails (such as Forgot Password codes) are written to this console instead.");
                    break;
                default:
                    logger.LogWarning("Email isn't set up (EMAIL_FROM with BREVO_API_KEY or SMTP_HOST), so Forgot Password can't send codes.");
                    break;
            }
        }

        public bool Enabled => _transport != Transport.None;

        // Throws when the email can't be sent.
        public async Task SendAsync(string to, string subject, string text, string html)
        {
            using var timeout = new CancellationTokenSource(SendTimeout);
            switch (_transport)
            {
                case Transport.Brevo:
                    await SendWithBrevoAsync(to, subject, text, html, timeout.Token);
                    break;
                case Transport.Smtp:
                    await SendWithSmtpAsync(to, subject, text, html, timeout.Token);
                    break;
                case Transport.Console:
                    _logger.LogWarning("Email to {To} (not sent, because email isn't set up)\nSubject: {Subject}\n{Text}", to, subject, text);
                    break;
                default:
                    throw new InvalidOperationException("Email isn't set up on the server.");
            }
        }

        private async Task SendWithBrevoAsync(string to, string subject, string text, string html, CancellationToken cancellation)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, BrevoUrl);
            request.Headers.Add("api-key", _brevoKey);
            request.Headers.Add("accept", "application/json");
            request.Content = JsonContent.Create(new
            {
                sender = new { name = _fromName, email = _from },
                to = new[] { new { email = to } },
                subject,
                textContent = text,
                htmlContent = html
            });

            using var response = await _httpClientFactory.CreateClient(nameof(EmailSender)).SendAsync(request, cancellation);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync(cancellation);
                throw new InvalidOperationException($"Brevo answered {(int)response.StatusCode}: {body}");
            }
        }

        private async Task SendWithSmtpAsync(string to, string subject, string text, string html, CancellationToken cancellation)
        {
            using var client = new SmtpClient(_smtpHost, _smtpPort)
            {
                EnableSsl = true,
                DeliveryMethod = SmtpDeliveryMethod.Network,
                UseDefaultCredentials = false
            };
            if (_smtpUsername != null)
            {
                client.Credentials = new NetworkCredential(_smtpUsername, _smtpPassword);
            }

            using var message = new MailMessage
            {
                From = new MailAddress(_from!, _fromName),
                Subject = subject,
                Body = text,
                IsBodyHtml = false
            };
            message.To.Add(to);
            message.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(html, null, "text/html"));

            await client.SendMailAsync(message, cancellation);
        }

        private static string? Clean(string? value)
        {
            var cleaned = value?.Trim().Trim('"', '\'').Trim();
            return string.IsNullOrEmpty(cleaned) ? null : cleaned;
        }
    }
}
