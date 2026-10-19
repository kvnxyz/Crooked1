FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /app

COPY src/CrookedAPI.sln ./
COPY src/CrookedAPI/*.csproj ./CrookedAPI/
RUN dotnet restore

COPY . ./
RUN dotnet publish CrookedAPI/CrookedAPI.csproj -c Release -o out

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app/out ./
ENTRYPOINT ["dotnet", "CrookedAPI.dll"]