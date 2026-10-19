FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY src/CrookedAPI.sln ./
COPY src/CrookedAPI/*.csproj ./CrookedAPI/
RUN dotnet restore

COPY src/ ./
RUN dotnet publish CrookedAPI/CrookedAPI.csproj -c Release -o out

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /src/out ./
ENTRYPOINT ["dotnet", "CrookedAPI.dll"]