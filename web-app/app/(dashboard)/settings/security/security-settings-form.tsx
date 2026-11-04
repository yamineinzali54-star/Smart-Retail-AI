"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface Props {
  userName: string;
  hasTotp: boolean;
}

export default function SecuritySettingsForm({ hasTotp }: Props) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [otpAuthUrl, setOtpAuthUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/settings/security/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Failed to change password");
        return;
      }
      setSuccess("Password changed successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setError("Failed to change password");
    } finally {
      setBusy(false);
    }
  }

  async function handleEnableTotp() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/settings/security/totp", {
        method: "POST",
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Failed to enable 2FA");
        return;
      }
      setOtpAuthUrl(data.otpAuthUrl);
    } catch {
      setError("Failed to enable 2FA");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyTotp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/settings/security/totp/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ totpCode }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Invalid code");
        return;
      }
      setSuccess("Two-factor authentication enabled successfully");
      setOtpAuthUrl(null);
      setTotpCode("");
    } catch {
      setError("Failed to verify code");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>
            Enter your current password and a new password
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {success && <p className="text-sm text-green-600">{success}</p>}
            <Button type="submit" disabled={busy}>
              {busy ? "Changing..." : "Change password"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>
            {hasTotp
              ? "Two-factor authentication is enabled"
              : "Enable two-factor authentication for extra security"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!hasTotp && !otpAuthUrl && (
            <Button onClick={handleEnableTotp} disabled={busy}>
              {busy ? "Enabling..." : "Enable 2FA"}
            </Button>
          )}
          {otpAuthUrl && (
            <div className="space-y-4">
              <p className="text-sm">
                Scan this QR code with your authenticator app:
              </p>
              <code className="text-xs break-all rounded-md bg-muted p-3">
                {otpAuthUrl}
              </code>
              <form onSubmit={handleVerifyTotp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="totpCode">Verification code</Label>
                  <Input
                    id="totpCode"
                    type="text"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    required
                    maxLength={8}
                  />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                {success && <p className="text-sm text-green-600">{success}</p>}
                <Button type="submit" disabled={busy}>
                  {busy ? "Verifying..." : "Verify and enable"}
                </Button>
              </form>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
