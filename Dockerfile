FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /source
COPY . .

# Railway sends either the repo root or src/ as the build context (depending on the
# service's Root Directory setting), so locate the project instead of hardcoding its path.
RUN csproj="$(find . -name CrookedAPI.csproj -not -path '*/obj/*' | head -n 1)" \
    && test -n "$csproj" \
    && dotnet publish "$csproj" -c Release -o /app -p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app .

# The Railway volume mounted at /app/wwwroot/images/products hides the product photos built
# into the image, so keep a copy here; the app copies missing ones into the volume at startup.
RUN mkdir -p wwwroot/images/products && cp -a wwwroot/images/products product-images

ENTRYPOINT ["dotnet", "CrookedAPI.dll"]
