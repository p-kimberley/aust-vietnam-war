using System.Net.Security;
using System.Security.Cryptography.X509Certificates;

namespace Avw.Api.Map;

/// <summary>
/// Trusts a server certificate that chains to one specific private CA (for example the CA the Elasticsearch operator
/// generates), without adding that CA to the machine's trust store. The host name must still match, so this is not
/// "accept anything".
/// </summary>
public sealed class PrivateCaValidation(X509Certificate2 authority)
{
    public static PrivateCaValidation FromFile(string path) =>
        new(X509CertificateLoader.LoadCertificateFromFile(path));

    public bool Validate(X509Certificate? certificate, X509Chain? presented, SslPolicyErrors errors)
    {
        if (certificate is null)
        {
            return false;
        }

        // A wrong host name is never excused by a trusted CA.
        if ((errors & SslPolicyErrors.RemoteCertificateNameMismatch) != 0)
        {
            return false;
        }

        using var chain = new X509Chain();
        chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
        chain.ChainPolicy.CustomTrustStore.Add(authority);
        // A private CA has no reachable CRL or OCSP endpoint.
        chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;

        if (presented is not null)
        {
            foreach (var element in presented.ChainElements)
            {
                chain.ChainPolicy.ExtraStore.Add(element.Certificate);
            }
        }

        using var leaf = certificate as X509Certificate2 ?? new X509Certificate2(certificate);
        return chain.Build(leaf);
    }
}
