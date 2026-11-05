package auth

import (
	"sync"

	"golang.org/x/crypto/bcrypt"
)

func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(hash), err
}

func CheckPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// dummyHash is compared against when no user matches, so an unknown email
// takes as long to reject as a wrong password.
var dummyHash = sync.OnceValue(func() string {
	hash, _ := HashPassword("dummy-password")
	return hash
})
