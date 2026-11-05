package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testSecret = "test-secret"

func newTestMiddleware(t *testing.T) *AuthMiddleware {
	t.Helper()
	am, err := NewAuthMiddleware(testSecret)
	if err != nil {
		t.Fatal(err)
	}
	return am
}

func signRaw(t *testing.T, method jwt.SigningMethod, secret string, claims jwt.Claims) string {
	t.Helper()
	s, err := jwt.NewWithClaims(method, claims).SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestNewAuthMiddlewareRequiresSecret(t *testing.T) {
	if _, err := NewAuthMiddleware(""); err == nil {
		t.Error("expected error for empty secret")
	}
}

func TestIssueAndVerifyToken(t *testing.T) {
	am := newTestMiddleware(t)

	tok, err := am.IssueToken(42, "script editor")
	if err != nil {
		t.Fatal(err)
	}
	claims, err := am.VerifyToken(tok)
	if err != nil {
		t.Fatal(err)
	}
	if claims.UserID != 42 || claims.Role != "script editor" {
		t.Errorf("got %+v", claims)
	}

	var raw jwtClaims
	if _, _, err := jwt.NewParser().ParseUnverified(tok, &raw); err != nil {
		t.Fatal(err)
	}
	if ttl := raw.ExpiresAt.Sub(raw.IssuedAt.Time); ttl != time.Hour {
		t.Errorf("token lifetime = %v, want 1h", ttl)
	}
}

func TestVerifyTokenRejects(t *testing.T) {
	am := newTestMiddleware(t)
	valid := func(exp time.Time) jwtClaims {
		return jwtClaims{Role: "admin", RegisteredClaims: jwt.RegisteredClaims{
			Subject: "1", ExpiresAt: jwt.NewNumericDate(exp),
		}}
	}
	future := time.Now().Add(time.Hour)

	cases := map[string]string{
		"expired":      signRaw(t, jwt.SigningMethodHS256, testSecret, valid(time.Now().Add(-time.Minute))),
		"wrong secret": signRaw(t, jwt.SigningMethodHS256, "other-secret", valid(future)),
		"other alg":    signRaw(t, jwt.SigningMethodHS512, testSecret, valid(future)),
		"no expiry": signRaw(t, jwt.SigningMethodHS256, testSecret,
			jwtClaims{Role: "admin", RegisteredClaims: jwt.RegisteredClaims{Subject: "1"}}),
		"non-numeric subject": signRaw(t, jwt.SigningMethodHS256, testSecret,
			jwtClaims{Role: "admin", RegisteredClaims: jwt.RegisteredClaims{Subject: "bob", ExpiresAt: jwt.NewNumericDate(future)}}),
		"missing role": signRaw(t, jwt.SigningMethodHS256, testSecret,
			jwtClaims{RegisteredClaims: jwt.RegisteredClaims{Subject: "1", ExpiresAt: jwt.NewNumericDate(future)}}),
		"garbage": "not.a.token",
	}
	for name, tok := range cases {
		if _, err := am.VerifyToken(tok); err == nil {
			t.Errorf("%s: expected rejection", name)
		}
	}
}

func serve(h http.Handler, authHeader string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestMiddleware(t *testing.T) {
	am := newTestMiddleware(t)
	var got *Claims
	h := am.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, _ = GetClaimsFromContext(r.Context())
	}))

	tok, _ := am.IssueToken(7, "requester")
	if rec := serve(h, "Bearer "+tok); rec.Code != http.StatusOK {
		t.Fatalf("valid token: status = %d", rec.Code)
	}
	if got == nil || got.UserID != 7 || got.Role != "requester" {
		t.Errorf("claims in context = %+v", got)
	}

	for name, header := range map[string]string{
		"no header":     "",
		"wrong scheme":  "Basic " + tok,
		"no token":      "Bearer ",
		"bare token":    tok,
		"invalid token": "Bearer not.a.token",
	} {
		if rec := serve(h, header); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: status = %d, want 401", name, rec.Code)
		}
	}
}

func TestRequireAdmin(t *testing.T) {
	am := newTestMiddleware(t)
	ok := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})
	protected := am.Middleware(RequireAdmin(ok))

	for role, want := range map[string]int{
		"admin":         http.StatusOK,
		"script editor": http.StatusForbidden,
		"script viewer": http.StatusForbidden,
		"requester":     http.StatusForbidden,
	} {
		tok, _ := am.IssueToken(1, role)
		if rec := serve(protected, "Bearer "+tok); rec.Code != want {
			t.Errorf("role %q: status = %d, want %d", role, rec.Code, want)
		}
	}

	// Without the auth middleware in front there are no claims, so it must refuse.
	if rec := serve(RequireAdmin(ok), ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("no claims: status = %d, want 401", rec.Code)
	}
}
