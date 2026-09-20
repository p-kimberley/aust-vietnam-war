# One image holds the API, the worker and the migrator; the Helm chart picks the entry point per workload.
#   docker build -t avw-server server/
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Restore first, against project files only, so dependency layers cache.
COPY global.json Directory.Build.props Directory.Packages.props Avw.slnx ./
COPY src/Avw.Core/Avw.Core.csproj src/Avw.Core/
COPY src/Avw.Data/Avw.Data.csproj src/Avw.Data/
COPY src/Avw.Indexing/Avw.Indexing.csproj src/Avw.Indexing/
COPY src/Avw.Api/Avw.Api.csproj src/Avw.Api/
COPY src/Avw.Worker/Avw.Worker.csproj src/Avw.Worker/
COPY src/Avw.Migration/Avw.Migration.csproj src/Avw.Migration/
COPY src/Avw.Migrator/Avw.Migrator.csproj src/Avw.Migrator/
COPY tests/Avw.Api.Tests/Avw.Api.Tests.csproj tests/Avw.Api.Tests/
# Publish for the one platform being built. Without a runtime identifier every native library for every platform
# (Magick.NET alone is about 200 MB) ends up in the image.
ARG TARGETARCH
RUN case "$TARGETARCH" in arm64) echo linux-arm64 > /rid ;; *) echo linux-x64 > /rid ;; esac
RUN dotnet restore Avw.slnx -r "$(cat /rid)"

COPY . .
# The migrator refers to the API project (for the picture pipeline), so it is published first: publishing the API before it
# leaves two builds of the API for the migrator's publish to trip over.
RUN RID="$(cat /rid)" \
 && dotnet publish src/Avw.Migrator -c Release -r "$RID" --no-self-contained --no-restore -o /out/migrator \
 && dotnet publish src/Avw.Worker -c Release -r "$RID" --no-self-contained --no-restore -o /out/worker \
 && dotnet publish src/Avw.Api -c Release -r "$RID" --no-self-contained --no-restore -o /out/api

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /out .

# The .NET images provide a non-root user (UID 1654).
USER $APP_UID
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
# CMD (not ENTRYPOINT) so the Helm chart, or a person, can run the worker or migrator from the same image.
CMD ["dotnet", "/app/api/Avw.Api.dll"]
