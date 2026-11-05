package auth

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const TokenTTL = time.Hour

type AuthMiddleware struct {
	secret []byte
}

// Claims are what a verified token says about the caller.
type Claims struct {
	UserID int64
	Role   string
}

type jwtClaims struct {
	Role string `json:"role"`
	jwt.RegisteredClaims
}

// NewAuthMiddleware creates the middleware from a plain secret string
func NewAuthMiddleware(secret string) (*AuthMiddleware, error) {
	if secret == "" {
		return nil, errors.New("JWT secret must not be empty")
	}
	return &AuthMiddleware{secret: []byte(secret)}, nil
}

// IssueToken signs a token for the user that expires after TokenTTL.
func (am *AuthMiddleware) IssueToken(userID int64, role string) (string, error) {
	now := time.Now()
	claims := jwtClaims{
		Role: role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strconv.FormatInt(userID, 10),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(TokenTTL)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(am.secret)
}

func (am *AuthMiddleware) VerifyToken(tokenStr string) (*Claims, error) {
	var c jwtClaims
	_, err := jwt.ParseWithClaims(tokenStr, &c,
		func(*jwt.Token) (any, error) { return am.secret, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return nil, errors.New("invalid or expired token")
	}
	id, err := strconv.ParseInt(c.Subject, 10, 64)
	if err != nil || c.Role == "" {
		return nil, errors.New("malformed claims")
	}
	return &Claims{UserID: id, Role: c.Role}, nil
}

// Middleware validates the Bearer token on incoming requests
func (am *AuthMiddleware) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tokenStr, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || tokenStr == "" {
			http.Error(w, "missing or invalid authorization header", http.StatusUnauthorized)
			return
		}
		claims, err := am.VerifyToken(tokenStr)
		if err != nil {
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), claimsKey, claims)))
	})
}

// RequireRole middleware — chains after Middleware()
func RequireRole(roles ...string) func(http.Handler) http.Handler {
	allowed := make(map[string]bool, len(roles))
	for _, r := range roles {
		allowed[r] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := GetClaimsFromContext(r.Context())
			if !ok {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			if !allowed[claims.Role] {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireAdmin — chains after Middleware()
func RequireAdmin(next http.Handler) http.Handler {
	return RequireRole("admin")(next)
}

type contextKey string

const claimsKey = contextKey("claims")

func GetClaimsFromContext(ctx context.Context) (*Claims, bool) {
	claims, ok := ctx.Value(claimsKey).(*Claims)
	return claims, ok
}
