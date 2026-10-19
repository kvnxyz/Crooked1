FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY CrookedAPI.sln ./
COPY CrookedAPI/*.csproj ./CrookedAPI/
RUN dotnet restore

COPY . ./
RUN dotnet publish CrookedAPI/CrookedAPI.csproj -c Release -o out

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /src/out ./
ENTRYPOINT ["dotnet", "CrookedAPI.dll"]