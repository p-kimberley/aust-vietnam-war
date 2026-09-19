# One image holds the API, the worker and the migrator; the Helm chart picks the entry point per workload.
#   docker build -t avw-server server/
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Restore first, against project files only, so dependency layers cache.
COPY global.json Directory.Build.props Directory.Packages.props Avw.slnx ./
COPY src/Avw.Data/Avw.Data.csproj src/Avw.Data/
COPY src/Avw.Api/Avw.Api.csproj src/Avw.Api/
COPY src/Avw.Worker/Avw.Worker.csproj src/Avw.Worker/
COPY src/Avw.Migrator/Avw.Migrator.csproj src/Avw.Migrator/
COPY tests/Avw.Api.Tests/Avw.Api.Tests.csproj tests/Avw.Api.Tests/
RUN dotnet restore Avw.slnx

COPY . .
RUN dotnet publish src/Avw.Api -c Release --no-restore -o /out/api \
 && dotnet publish src/Avw.Worker -c Release --no-restore -o /out/worker \
 && dotnet publish src/Avw.Migrator -c Release --no-restore -o /out/migrator

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /out .

# The .NET images provide a non-root user (UID 1654).
USER $APP_UID
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
# CMD (not ENTRYPOINT) so the Helm chart, or a person, can run the worker or migrator from the same image.
CMD ["dotnet", "/app/api/Avw.Api.dll"]
