// seed-admin creates the first admin account.
//
// Without ADMIN_PASSWORD it prints a one-time set-password link, so the admin
// chooses their own password and nobody else ever knows it:
//
//	ADMIN_NAME="Pat" ADMIN_EMAIL="pat@example.com" ./seed-admin
//
// With ADMIN_PASSWORD it creates the account with that password directly.
package main

import (
	"VCCwebsite/internal/auth"
	"errors"
	"fmt"
	"log"
	"os"
)

func main() {
	dbPath := os.Getenv("AUTH_DB_PATH")
	if dbPath == "" {
		dbPath = "auth.db"
	}

	name := os.Getenv("ADMIN_NAME")
	email := os.Getenv("ADMIN_EMAIL")
	password := os.Getenv("ADMIN_PASSWORD")
	if name == "" || email == "" {
		log.Fatal("set ADMIN_NAME and ADMIN_EMAIL (and optionally ADMIN_PASSWORD)")
	}

	auth.Init(dbPath)
	defer auth.DB.Close()

	if password != "" {
		if err := auth.CreateAdmin(name, email, password); err != nil {
			log.Fatalf("seed admin failed: %v", err)
		}
		log.Printf("admin %s created in %s", auth.NormalizeEmail(email), dbPath)
		return
	}

	token, err := auth.InviteAdmin(name, email)
	if errors.Is(err, auth.ErrAlreadyActive) {
		log.Fatalf("%s already has an active account", auth.NormalizeEmail(email))
	}
	if err != nil {
		log.Fatalf("invite admin failed: %v", err)
	}

	appURL := os.Getenv("APP_URL")
	if appURL == "" {
		appURL = "http://localhost:8080"
	}
	fmt.Printf("\nInvited %s as an admin.\nOpen this link to set a password (single use, expires in %d hours):\n\n%s\n\n",
		auth.NormalizeEmail(email), int(auth.SetupTokenTTL.Hours()), auth.SetupLink(appURL, token))
}
