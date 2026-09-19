using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Avw.Api.Map;

namespace Avw.Api.Tests;

public class PrivateCaValidationTests
{
    private static X509Certificate2 NewCa(string name)
    {
        using var key = RSA.Create(2048);
        var req = new CertificateRequest($"CN={name}", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        req.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
        req.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign, true));
        using var withKey = req.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(30));
        return new X509Certificate2(withKey.Export(X509ContentType.Pfx));
    }

    private static X509Certificate2 NewLeaf(X509Certificate2 issuer, string host = "es.test")
    {
        using var key = RSA.Create(2048);
        var req = new CertificateRequest($"CN={host}", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var san = new SubjectAlternativeNameBuilder();
        san.AddDnsName(host);
        req.CertificateExtensions.Add(san.Build());
        using var signed = req.Create(issuer, DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(10), RandomNumberGenerator.GetBytes(8));
        return new X509Certificate2(signed.Export(X509ContentType.Cert));
    }

    // What the TLS stack reports when the certificate is not in the machine store.
    private const SslPolicyErrors Untrusted = SslPolicyErrors.RemoteCertificateChainErrors;

    [Fact]
    public void Accepts_a_certificate_signed_by_the_private_ca()
    {
        using var ca = NewCa("avw test ca");
        using var leaf = NewLeaf(ca);

        Assert.True(new PrivateCaValidation(ca).Validate(leaf, null, Untrusted));
    }

    [Fact]
    public void Rejects_a_certificate_signed_by_a_different_ca()
    {
        using var ca = NewCa("avw test ca");
        using var other = NewCa("someone else");
        using var leaf = NewLeaf(other);

        Assert.False(new PrivateCaValidation(ca).Validate(leaf, null, Untrusted));
    }

    [Fact]
    public void Rejects_a_self_signed_certificate_that_is_not_the_ca()
    {
        using var ca = NewCa("avw test ca");
        using var stranger = NewCa("es.test");

        Assert.False(new PrivateCaValidation(ca).Validate(stranger, null, Untrusted));
    }

    [Fact]
    public void A_trusted_ca_does_not_excuse_the_wrong_host_name()
    {
        using var ca = NewCa("avw test ca");
        using var leaf = NewLeaf(ca);

        Assert.False(new PrivateCaValidation(ca).Validate(
            leaf, null, Untrusted | SslPolicyErrors.RemoteCertificateNameMismatch));
    }

    [Fact]
    public void Rejects_a_missing_certificate()
    {
        using var ca = NewCa("avw test ca");
        Assert.False(new PrivateCaValidation(ca).Validate(null, null, SslPolicyErrors.RemoteCertificateNotAvailable));
    }
}
