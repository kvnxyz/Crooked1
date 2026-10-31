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

DatabaseSetup.EnsureSchema();

var frontend = Path.Combine(app.Environment.ContentRootPath, "Frontend");
var pages = new PhysicalFileProvider(Path.Combine(frontend, "page"));
var uploads = Path.Combine(app.Environment.ContentRootPath, "wwwroot");
Directory.CreateDirectory(uploads);
ProductImages.RestoreBuiltIn(app.Environment.ContentRootPath);

app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = pages });
app.UseStaticFiles(new StaticFileOptions { FileProvider = pages });
// Pages link to ../page, ../design, ../javascript and ../assets, so Frontend is also served from the root.
app.UseStaticFiles(new StaticFileOptions { FileProvider = new PhysicalFileProvider(frontend) });
app.UseStaticFiles(new StaticFileOptions { FileProvider = new PhysicalFileProvider(uploads) });

app.MapControllers();
app.Run();

//asdwa
//asdw
