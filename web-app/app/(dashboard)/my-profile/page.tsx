import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { getSession } from "@/lib/auth";
import SecuritySettingsClient from "./security-settings-client";

// /my-profile — own-account settings: Profile, Password, 2FA
export default async function SecuritySettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [user] = await db
    .select({
      id: users.id,
      userName: users.userName,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      totpSecret: users.totpSecret,
      totpVerified: users.totpVerified,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!user) redirect("/login");

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-[1600px] flex-col gap-6 p-4 sm:p-6 lg:p-8">
          <div className="border-b border-border pb-5">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Account</p>
            <h1 className="font-heading text-2xl font-semibold tracking-tight">Security settings</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Signed in as {session.user.userName} ({session.user.role})
            </p>
          </div>
          <div className="w-full max-w-2xl">
            <SecuritySettingsClient
          user={{
            id: user.id,
            userName: user.userName,
            fullName: user.fullName,
            email: user.email,
            role: user.role,
            totpSecret: user.totpSecret,
            totpVerified: user.totpVerified,
          }}
            />
          </div>
    </div>
  );
}
