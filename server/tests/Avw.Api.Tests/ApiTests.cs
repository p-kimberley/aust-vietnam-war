using System.Net;
using System.Net.Http.Json;
using System.Web;
using Avw.Api.Auth;

namespace Avw.Api.Tests;

public class ApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private HttpClient Client() => factory.CreateClient(new() { AllowAutoRedirect = false });

    [Theory]
    [InlineData("/api/health/live")]
    [InlineData("/api/health/ready")]
    public async Task Health_endpoints_are_ok(string path)
    {
        var res = await Client().GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task OpenApi_document_describes_the_auth_endpoints()
    {
        var json = await Client().GetStringAsync("/api/openapi/v1.json");
        Assert.Contains("/api/auth/me", json);
        Assert.Contains("/api/auth/logout", json);
    }

    [Fact]
    public async Task Me_is_anonymous_without_a_session_and_is_never_cached()
    {
        var res = await Client().GetAsync("/api/auth/me");
        var me = await res.Content.ReadFromJsonAsync<MeResponse>();

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.False(me!.Authenticated);
        Assert.Contains("no-store", res.Headers.CacheControl!.ToString());
    }

    [Fact]
    public async Task Me_returns_only_avw_roles()
    {
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
        req.Headers.Add("X-Test-User", "Pat Editor");
        req.Headers.Add("X-Test-Roles", "editor,offline_access,uma_authorization,default-roles-avw");

        var me = await (await Client().SendAsync(req)).Content.ReadFromJsonAsync<MeResponse>();

        Assert.True(me!.Authenticated);
        Assert.Equal("Pat Editor", me.Name);
        Assert.Equal(42, me.Id);
        Assert.Equal(["editor"], me.Roles);
    }

    [Fact]
    public async Task State_changing_requests_need_the_csrf_header()
    {
        var res = await Client().PostAsync("/api/auth/logout", content: null);
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
    }

    [Fact]
    public async Task Logout_without_a_session_returns_home()
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/logout");
        req.Headers.Add(CsrfHeaderMiddleware.HeaderName, CsrfHeaderMiddleware.HeaderValue);

        var body = await (await Client().SendAsync(req)).Content.ReadFromJsonAsync<LogoutResponse>();

        Assert.Equal("/", body!.RedirectUrl);
    }

    [Fact]
    public async Task Logout_with_a_session_returns_the_keycloak_end_session_url()
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/logout");
        req.Headers.Add(CsrfHeaderMiddleware.HeaderName, CsrfHeaderMiddleware.HeaderValue);
        req.Headers.Add("X-Test-User", "Pat");

        var body = await (await Client().SendAsync(req)).Content.ReadFromJsonAsync<LogoutResponse>();
        var url = new Uri(body!.RedirectUrl);
        var query = HttpUtility.ParseQueryString(url.Query);

        Assert.Equal("auth.test", url.Host);
        Assert.Equal("avw-api", query["client_id"]);
        Assert.Equal("http://localhost/", query["post_logout_redirect_uri"]);
    }

    [Fact]
    public async Task Login_redirects_to_keycloak_with_pkce()
    {
        var res = await Client().GetAsync("/api/auth/login?returnUrl=/studio");

        Assert.Equal(HttpStatusCode.Redirect, res.StatusCode);
        var location = res.Headers.Location!;
        var query = HttpUtility.ParseQueryString(location.Query);
        Assert.Equal("auth.test", location.Host);
        Assert.Equal("code", query["response_type"]);
        Assert.Equal("S256", query["code_challenge_method"]);
        Assert.False(string.IsNullOrEmpty(query["code_challenge"]));
        Assert.Equal("http://localhost/api/auth/signin-oidc", query["redirect_uri"]);
        Assert.Null(query["prompt"]);
    }

    [Fact]
    public async Task Register_asks_keycloak_for_the_registration_form()
    {
        var res = await Client().GetAsync("/api/auth/register");

        var query = HttpUtility.ParseQueryString(res.Headers.Location!.Query);
        Assert.Equal("create", query["prompt"]);
    }

    [Theory]
    [InlineData("/studio", true)]
    [InlineData("/battlemap?incident=12", true)]
    [InlineData("/", true)]
    [InlineData("//evil.example", false)]
    [InlineData("/\\evil.example", false)]
    [InlineData("https://evil.example", false)]
    [InlineData("javascript:alert(1)", false)]
    [InlineData("/ok\r\nSet-Cookie: x=y", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void Return_urls_must_be_same_site_paths(string? path, bool expected) =>
        Assert.Equal(expected, AuthEndpoints.IsSafeLocalPath(path));
}
