package auth

import (
	"strings"
	"testing"
)

func TestSetupLink(t *testing.T) {
	for _, base := range []string{"https://app.example.com", "https://app.example.com/"} {
		if got, want := SetupLink(base, "a b/c"), "https://app.example.com/set-password?token=a+b%2Fc"; got != want {
			t.Errorf("SetupLink(%q) = %q, want %q", base, got, want)
		}
	}
}

func TestInviteAdminThenSetPasswordThenLogin(t *testing.T) {
	setupDB(t)

	token, err := InviteAdmin(" Pat ", "Pat@Example.com")
	if err != nil {
		t.Fatal(err)
	}

	if _, _, err := Authenticate("pat@example.com", goodPassword); err == nil {
		t.Fatal("invited admin can log in before choosing a password")
	}
	if err := SetupPassword(token, goodPassword); err != nil {
		t.Fatalf("setup with invite token: %v", err)
	}

	_, role, err := Authenticate("pat@example.com", goodPassword)
	if err != nil || role != "admin" {
		t.Fatalf("login: role=%q err=%v, want admin", role, err)
	}
	if err := SetupPassword(token, goodPassword); err != ErrInvalidSetupToken {
		t.Errorf("invite token reused: err = %v, want ErrInvalidSetupToken", err)
	}
}

func TestInviteAdminStoresOnlyTokenHash(t *testing.T) {
	setupDB(t)
	token, err := InviteAdmin("Pat", "pat@example.com")
	if err != nil {
		t.Fatal(err)
	}

	var stored string
	if err := DB.QueryRow(`SELECT setup_token_hash FROM users WHERE email = 'pat@example.com'`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored != HashSetupToken(token) || strings.Contains(stored, token) {
		t.Errorf("stored %q, want only the hash of the token", stored)
	}
}

func TestInviteAdminReissuesInviteAndPromotesPending(t *testing.T) {
	setupDB(t)

	first, err := InviteAdmin("Pat", "pat@example.com")
	if err != nil {
		t.Fatal(err)
	}
	second, err := InviteAdmin("Pat", "pat@example.com")
	if err != nil {
		t.Fatalf("re-invite: %v", err)
	}
	if err := SetupPassword(first, goodPassword); err != ErrInvalidSetupToken {
		t.Errorf("old invite still works after re-invite: err = %v", err)
	}
	if err := SetupPassword(second, goodPassword); err != nil {
		t.Errorf("new invite: %v", err)
	}

	// Someone who only asked for access can be invited as admin.
	addPending(t, "Sam", "sam@example.com")
	token, err := InviteAdmin("Sam", "sam@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if err := SetupPassword(token, goodPassword); err != nil {
		t.Fatal(err)
	}
	if _, role, err := Authenticate("sam@example.com", goodPassword); err != nil || role != "admin" {
		t.Errorf("promoted pending user: role=%q err=%v", role, err)
	}
}

func TestInviteAdminLeavesActiveAccountsAlone(t *testing.T) {
	setupDB(t)
	if err := CreateAdmin("Pat", "pat@example.com", goodPassword); err != nil {
		t.Fatal(err)
	}

	if _, err := InviteAdmin("Imposter", "pat@example.com"); err != ErrAlreadyActive {
		t.Fatalf("err = %v, want ErrAlreadyActive", err)
	}

	var name, hash string
	if err := DB.QueryRow(`SELECT name, password_hash FROM users WHERE email = 'pat@example.com'`).Scan(&name, &hash); err != nil {
		t.Fatal(err)
	}
	if name != "Pat" || hash == "" {
		t.Errorf("active account modified: name=%q hash=%q", name, hash)
	}
	if _, _, err := Authenticate("pat@example.com", goodPassword); err != nil {
		t.Errorf("active admin locked out: %v", err)
	}
}

func TestInviteAdminRequiresName(t *testing.T) {
	setupDB(t)
	if _, err := InviteAdmin("  ", "pat@example.com"); err == nil {
		t.Error("blank name accepted")
	}
}
