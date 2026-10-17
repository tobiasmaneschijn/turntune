// Local unit/browser fixtures must never inherit application/provider credentials,
// Auth overrides, public origins, listening ports, proxy trust or Node injection.
// Preserve basic process settings and the managed network proxy/CA trust only.
const inherited = /^(?:LC_[A-Z_]+|CI|PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TMP|TEMP|TERM|COLORTERM|LANG|TZ|NO_COLOR|FORCE_COLOR|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR|REQUESTS_CA_BUNDLE|CURL_CA_BUNDLE|SYSTEMROOT|COMSPEC|PATHEXT|WINDIR)$/i;

export function testEnvironment(source = process.env) {
  return { ...Object.fromEntries(Object.entries(source).filter(([name]) => inherited.test(name))), NODE_ENV: "test" };
}
