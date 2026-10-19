FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /app

COPY CrookedAPI/CrookedAPI.csproj ./CrookedAPI/
RUN dotnet restore ./CrookedAPI/CrookedAPI.csproj

COPY CrookedAPI/ ./CrookedAPI/
RUN dotnet publish ./CrookedAPI/CrookedAPI.csproj -c Release --no-restore -o ./out

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app/out ./