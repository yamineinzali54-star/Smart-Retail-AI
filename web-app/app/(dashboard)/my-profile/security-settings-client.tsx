"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  RiUserLine,
  RiLockLine,
  RiShieldLine,
  RiSaveLine,
  RiRefreshLine,
} from "@remixicon/react";

type User = {
  id: string;
  userName: string;
  fullName: string;
  email: string | null;
  role: string;
  totpSecret: string | null;
  totpVerified: boolean;
};

type Props = {
  user: User;
};

export default function SecuritySettingsClient({ user }: Props) {
  const [activeTab, setActiveTab] = useState<"profile" | "password" | "2fa">("profile");
  const [profileData, setProfileData] = useState({ fullName: user.fullName, email: user.email || "" });
  const [passwordData, setPasswordData] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [totpData, setTotpData] = useState({ code: "", password: "" });
  const [totpSetupData, setTotpSetupData] = useState({ otpAuthUrl: null as string | null, code: "" });
  const [isEnrolled, setIsEnrolled] = useState(user.totpVerified);
  const [pendingSetup, setPendingSetup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function clearMessages() {
    setError(null);
    setSuccess(null);
  }

  async function handleProfileUpdate(e: React.FormEvent) {
    e.preventDefault();
    clearMessages();
    setBusy(true);
    try {
      const res = await fetch("/api/settings/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(profileData),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error === "EMAIL_TAKEN" ? "This email is already in use." : data?.error || "Failed to update profile.");
        return;
      }
      setSuccess("Profile updated successfully.");
      // Update local user data
      setProfileData({ fullName: data.user.fullName, email: data.user.email });
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    clearMessages();
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/settings/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(passwordData),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error === "INVALID_CURRENT_PASSWORD" ? "Current password is incorrect." : data?.error || "Failed to change password.");
        return;
      }
      setSuccess("Password changed successfully.");
      setPasswordData({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } finally {
      setBusy(false);
    }
  }

  async function startTotpSetup() {
    clearMessages();
    setBusy(true);
    try {
      const res = await fetch("/api/auth/totp/setup", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError("Could not start 2FA setup. Please try again.");
        return;
      }
      setTotpSetupData({ otpAuthUrl: data.otpAuthUrl, code: "" });
      setPendingSetup(true);
    } finally {
      setBusy(false);
    }
  }

  async function confirmTotpSetup(e: React.FormEvent) {
    e.preventDefault();
    clearMessages();
    if (!totpSetupData.otpAuthUrl) return;
    setBusy(true);
    try {
      const res = await fetch("/api/auth/totp/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ totpCode: totpSetupData.code }),
      });
      if (!res.ok) {
        setError("Invalid code — check your authenticator app and try again.");
        return;
      }
      setIsEnrolled(true);
      setPendingSetup(false);
      setTotpSetupData({ otpAuthUrl: null, code: "" });
      setSuccess("Two-factor authentication enabled successfully.");
    } finally {
      setBusy(false);
    }
  }

  async function disableTotp(e: React.FormEvent) {
    e.preventDefault();
    clearMessages();
    setBusy(true);
    try {
      const res = await fetch("/api/auth/totp/disable", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: totpData.password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error === "INVALID_CREDENTIALS" ? "Wrong password." : "Could not disable 2FA. Please try again.");
        return;
      }
      setIsEnrolled(false);
      setTotpData({ code: "", password: "" });
      setSuccess("Two-factor authentication disabled.");
    } finally {
      setBusy(false);
    }
  }

  const tabs = [
    { value: "profile", label: "Profile", icon: RiUserLine },
    { value: "password", label: "Password", icon: RiLockLine },
    { value: "2fa", label: "Two-Factor Auth", icon: RiShieldLine },
  ] as const;

  return (
    <div className="flex flex-col gap-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="flex items-center justify-center gap-2">
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RiUserLine className="h-4 w-4" />
                Profile
              </CardTitle>
              <CardDescription>Manage your personal information</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleProfileUpdate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full Name</Label>
                  <Input
                    id="fullName"
                    value={profileData.fullName}
                    onChange={(e) => setProfileData({ ...profileData, fullName: e.target.value })}
                    required
                    disabled={busy}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={profileData.email}
                    onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
                    placeholder="you@example.com"
                    disabled={busy}
                  />
                </div>
                {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
                {success && <p className="text-sm text-green-600" role="status">{success}</p>}
                <Button type="submit" disabled={busy} className="w-full sm:w-auto">
                  {busy ? <RiRefreshLine className="h-4 w-4 mr-2 animate-spin" /> : <RiSaveLine className="h-4 w-4 mr-2" />} Save Changes
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Password Tab */}
        <TabsContent value="password" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RiLockLine className="h-4 w-4" />
                Password
              </CardTitle>
              <CardDescription>Change your password</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handlePasswordChange} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="currentPassword">Current Password</Label>
                  <Input
                    id="currentPassword"
                    type="password"
                    value={passwordData.currentPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                    required
                    disabled={busy}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="newPassword">New Password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={passwordData.newPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                    required
                    minLength={8}
                    disabled={busy}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm New Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={passwordData.confirmPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                    required
                    disabled={busy}
                  />
                </div>
                {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
                {success && <p className="text-sm text-green-600" role="status">{success}</p>}
                <Button type="submit" disabled={busy} className="w-full sm:w-auto">
                  {busy ? <RiRefreshLine className="h-4 w-4 mr-2 animate-spin" /> : <RiSaveLine className="h-4 w-4 mr-2" />} Change Password
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 2FA Tab */}
        <TabsContent value="2fa" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RiShieldLine className="h-4 w-4" />
                Two-Factor Authentication
              </CardTitle>
              <CardDescription>
                Add an extra layer of security to your account using an authenticator app.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isEnrolled ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-lg bg-green-50 border border-green-200">
                    <div className="flex items-center gap-3">
                      <RiShieldLine className="h-6 w-6 text-green-600" />
                      <div>
                        <p className="font-medium text-green-800">Two-factor authentication is <strong>enabled</strong>.</p>
                        <p className="text-sm text-green-700">You will need a code from your authenticator app to sign in.</p>
                      </div>
                    </div>
                  </div>
                  <form onSubmit={disableTotp} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="disablePassword">Confirm with your password to turn it off</Label>
                      <Input
                        id="disablePassword"
                        type="password"
                        value={totpData.password}
                        onChange={(e) => setTotpData({ ...totpData, password: e.target.value })}
                        autoComplete="current-password"
                        required
                        disabled={busy}
                      />
                    </div>
                    {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
                    <Button type="submit" variant="destructive" disabled={busy} className="w-full sm:w-auto">
                      {busy ? <RiRefreshLine className="h-4 w-4 mr-2 animate-spin" /> : <RiShieldLine className="h-4 w-4 mr-2" />} Turn off 2FA
                    </Button>
                  </form>
                </div>
              ) : (
                <div className="space-y-4">
                  {!pendingSetup ? (
                    <div className="space-y-4">
                      <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
                        <div className="flex items-center gap-3">
                          <RiShieldLine className="h-6 w-6 text-blue-600" />
                          <div>
                            <p className="font-medium text-blue-800">Two-factor authentication is off.</p>
                            <p className="text-sm text-blue-700">Turn it on to add an extra layer of security to your account.</p>
                          </div>
                        </div>
                      </div>
                      <Button onClick={startTotpSetup} disabled={busy} className="w-full sm:w-auto">
                        {busy ? <RiRefreshLine className="h-4 w-4 mr-2 animate-spin" /> : <RiShieldLine className="h-4 w-4 mr-2" />} Turn on 2FA
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="p-4 rounded-lg bg-yellow-50 border border-yellow-200">
                        <p className="text-sm font-medium text-yellow-800 mb-2">Setup in progress — scan the QR code or enter the key below into your authenticator app, then confirm with a code.</p>
                      </div>
                      {totpSetupData.otpAuthUrl ? (
                        <code className="text-xs break-all rounded-md bg-muted p-3">{totpSetupData.otpAuthUrl}</code>
                      ) : null}
                      <form onSubmit={confirmTotpSetup} className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="totpCode">6-digit code from your authenticator app</Label>
                          <Input
                            id="totpCode"
                            value={totpSetupData.code}
                            onChange={(e) => setTotpSetupData({ ...totpSetupData, code: e.target.value })}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            required
                            disabled={busy}
                          />
                        </div>
                        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
                        <Button type="submit" disabled={busy} className="w-full sm:w-auto">
                          {busy ? <RiRefreshLine className="h-4 w-4 mr-2 animate-spin" /> : <RiShieldLine className="h-4 w-4 mr-2" />} Verify & Turn On
                        </Button>
                      </form>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}