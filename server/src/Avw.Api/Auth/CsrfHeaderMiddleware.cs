namespace Avw.Api.Auth;

/// <summary>
/// Defence in depth on top of SameSite cookies: every state-changing request to the API must carry a custom
/// header. A cross-site form or plain navigation cannot set one, and a cross-origin fetch that does would need
/// a CORS preflight, which the API never grants.
/// </summary>
public sealed class CsrfHeaderMiddleware(RequestDelegate next)
{
    public const string HeaderName = "X-Requested-With";
    public const string HeaderValue = "avw";

    public Task InvokeAsync(HttpContext ctx)
    {
        var unsafeMethod = !(HttpMethods.IsGet(ctx.Request.Method)
                             || HttpMethods.IsHead(ctx.Request.Method)
                             || HttpMethods.IsOptions(ctx.Request.Method)
                             || HttpMethods.IsTrace(ctx.Request.Method));

        if (unsafeMethod && ctx.Request.Headers[HeaderName] != HeaderValue)
        {
            return Results.Problem(
                    title: "Missing anti-forgery header",
                    detail: $"State-changing requests must send '{HeaderName}: {HeaderValue}'.",
                    statusCode: StatusCodes.Status403Forbidden)
                .ExecuteAsync(ctx);
        }

        return next(ctx);
    }
}
