using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using Crooked;
using Crooked.Models;
using Crooked.Services;

var builder = WebApplication.CreateBuilder(args);

// Railway assigns the listening port at runtime through PORT.
var port = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrEmpty(port))
{
    builder.WebHost.UseUrls($"http://0.0.0.0:{port}");
}

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();

// Login sets an HttpOnly session cookie; the API checks it on every request (see MapControllers below).
// The cookie lasts until the browser closes, or 12 hours without any request, whichever comes first.
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "crkd_session";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Strict;
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        options.ExpireTimeSpan = TimeSpan.FromHours(12);
        options.SlidingExpiration = true;
        // This is an API, so answer 401/403 instead of redirecting to a login page.
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };
        // Ends sessions whose account was archived or given another role since login.
        options.Events.OnValidatePrincipal = AccountSessions.ValidateAsync;
    });
builder.Services.AddAuthorization();

// Railway ends HTTPS at its proxy, so trust its X-Forwarded-Proto header; that lets the
// session cookie be marked Secure on the deployed site while plain http://localhost still works.
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedProto;
    options.KnownNetworks.Clear();
    options.KnownProxies.Clear();
});
builder.Services.AddHttpClient();
builder.Services.AddSingleton<LiveUpdates>();

// Register threshold forecast options and service
builder.Services.Configure<ThresholdForecastOptions>(builder.Configuration.GetSection("ThresholdForecast"));
builder.Services.AddHostedService<ThresholdForecastService>();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader();
    });
});

var app = builder.Build();

app.UseForwardedHeaders();

DatabaseSetup.EnsureSchema();

var frontend = Path.Combine(app.Environment.ContentRootPath, "Frontend");
var pages = new PhysicalFileProvider(Path.Combine(frontend, "page"));
var uploads = Path.Combine(app.Environment.ContentRootPath, "wwwroot");
Directory.CreateDirectory(uploads);
ProductImages.RestoreBuiltIn(app.Environment.ContentRootPath);

// Browsers check an HTML page for changes on every visit (cheap, thanks to its ETag) instead of
// reusing an old copy. Otherwise a browser can keep an old page after a deploy, with its old
// ?v= script links, and run old scripts against the new API.
static void RevalidatePages(StaticFileResponseContext context)
{
    if (context.File.Name.EndsWith(".html", StringComparison.OrdinalIgnoreCase))
    {
        context.Context.Response.Headers.CacheControl = "no-cache";
    }
}

app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = pages });
app.UseStaticFiles(new StaticFileOptions { FileProvider = pages, OnPrepareResponse = RevalidatePages });
// Pages link to ../page, ../design, ../javascript and ../assets, so Frontend is also served from the root.
app.UseStaticFiles(new StaticFileOptions { FileProvider = new PhysicalFileProvider(frontend), OnPrepareResponse = RevalidatePages });
app.UseStaticFiles(new StaticFileOptions { FileProvider = new PhysicalFileProvider(uploads) });

app.UseAuthentication();
app.UseAuthorization();

// Every API endpoint needs a signed-in user unless it is marked [AllowAnonymous] (login and owner
// recovery). Owner-only endpoints add [Authorize(Roles = UserRoles.Owner)]. The static pages stay
// public; session.js sends signed-out visitors to the login page.
app.MapControllers().RequireAuthorization();
app.Run();

//asdwa
//asdw
