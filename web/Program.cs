var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllersWithViews();

var app = builder.Build();

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Home/Error");
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}

app.UseHttpsRedirection();

// En desarrollo, sin precompresión: Browser Link de Visual Studio inyecta su script en texto plano dentro de las
// respuestas HTML y, si van en gzip, las corrompe (ERR_CONTENT_DECODING_FAILED en wwwroot/diagramas/*.html).
// UseStaticFiles va antes de UseRouting (con un endpoint ya elegido no actúa); en producción no corre y sigue la versión comprimida.
if (app.Environment.IsDevelopment()) app.UseStaticFiles();

app.UseRouting();

app.UseAuthorization();

app.MapStaticAssets();

app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}")
    .WithStaticAssets();


app.Run();
