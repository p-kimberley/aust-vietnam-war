using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Avw.Data;
using Microsoft.Extensions.DependencyInjection;

namespace Avw.Api.Tests;

public class DataProtectionTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public void Startup_fails_without_a_key_certificate_unless_unencrypted_keys_are_explicitly_allowed()
    {
        using var strict = factory.WithWebHostBuilder(b => b.UseSetting("DataProtection:AllowUnencryptedKeys", "false"));

        var ex = Assert.Throws<InvalidOperationException>(() => strict.CreateClient());
        Assert.Contains("DataProtection:CertificatePath", ex.Message);
    }

    [Fact]
    public async Task Keys_are_encrypted_with_the_configured_certificate()
    {
        var pfx = Path.Combine(Path.GetTempPath(), $"avw-test-{Guid.NewGuid():N}.pfx");
        using (var rsa = RSA.Create(2048))
        {
            var req = new CertificateRequest("CN=avw-test", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            using var cert = req.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(30));
            File.WriteAllBytes(pfx, cert.Export(X509ContentType.Pfx, "pw"));
        }

        try
        {
            using var encrypted = factory.WithWebHostBuilder(b =>
            {
                b.UseSetting("DataProtection:AllowUnencryptedKeys", "false");
                b.UseSetting("DataProtection:CertificatePath", pfx);
                b.UseSetting("DataProtection:CertificatePassword", "pw");
            });

            // The login redirect protects OIDC state, which forces a key to be created and persisted.
            using var client = encrypted.CreateClient(new() { AllowAutoRedirect = false });
            await client.GetAsync("/api/auth/login");

            using var scope = encrypted.Services.CreateScope();
            var xml = scope.ServiceProvider.GetRequiredService<AvwDbContext>().DataProtectionKeys.Select(k => k.Xml).ToList();

            Assert.NotEmpty(xml);
            Assert.All(xml, x =>
            {
                Assert.Contains("EncryptedData", x);
                Assert.DoesNotContain("<masterKey", x);
            });
        }
        finally
        {
            File.Delete(pfx);
        }
    }
}
