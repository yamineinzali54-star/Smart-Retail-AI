// @vitest-environment jsdom
// Component test (DB-free, fetch-mocked) for the live login form
// (components/login-form — the component app/(auth)/login/page.tsx renders).
// Covers credentials-first submit, TOTP reveal, role-based redirect,
// legacy /dashboard/* next-mapping, and ?next= open-redirect rejection.
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LoginForm } from "@/components/login-form"

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  params: new URLSearchParams(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: vi.fn() }),
  useSearchParams: () => nav.params,
}))

function mockFetchOnce(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify(body), { status })
  )
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function usernameInput() {
  return document.querySelector(
    'input[autocomplete="username"]'
  ) as HTMLInputElement
}

function passwordInput() {
  return document.querySelector(
    'input[autocomplete="current-password"]'
  ) as HTMLInputElement
}

function codeInput() {
  return document.querySelector('input[autocomplete="one-time-code"]')
}

async function signIn(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  pass: string
) {
  await user.type(usernameInput(), name)
  await user.type(passwordInput(), pass)
  await user.click(screen.getByRole("button", { name: /sign in/i }))
}

beforeEach(() => {
  vi.unstubAllGlobals()
  nav.push.mockClear()
  nav.params = new URLSearchParams()
})

afterEach(() => {
  cleanup()
})

describe("LoginForm", () => {
  it("renders username + password and no 2FA UI by default", () => {
    render(<LoginForm />)
    expect(screen.getByText("SmartRetailAI")).toBeInTheDocument()
    expect(usernameInput()).not.toBeNull()
    expect(passwordInput()).not.toBeNull()
    expect(codeInput()).toBeNull()
  })

  it("posts credentials to /api/auth/login", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchOnce(200, {
      ok: true,
      user: { role: "inventory" },
    })
    render(<LoginForm />)
    await signIn(user, "inventory1", "Inventory@123")
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe("/api/auth/login")
    expect(JSON.parse(init.body as string)).toMatchObject({
      userName: "inventory1",
    })
  })

  it("redirects an inventory session to /inventory", async () => {
    const user = userEvent.setup()
    mockFetchOnce(200, { ok: true, user: { role: "inventory" } })
    render(<LoginForm />)
    await signIn(user, "inventory1", "Inventory@123")
    expect(nav.push).toHaveBeenCalledWith("/inventory")
  })

  it("redirects a cashier session to /pos and admin to /admin", async () => {
    const user = userEvent.setup()
    mockFetchOnce(200, { ok: true, user: { role: "cashier" } })
    render(<LoginForm />)
    await signIn(user, "cashier1", "Cashier@123")
    expect(nav.push).toHaveBeenCalledWith("/pos")
    cleanup()
    nav.push.mockClear()
    mockFetchOnce(200, { ok: true, user: { role: "admin" } })
    render(<LoginForm />)
    await signIn(user, "admin1", "Admin@123")
    expect(nav.push).toHaveBeenCalledWith("/admin")
  })

  it("follows a safe same-origin ?next= path", async () => {
    const user = userEvent.setup()
    nav.params = new URLSearchParams({ next: "/stock" })
    mockFetchOnce(200, { ok: true, user: { role: "inventory" } })
    render(<LoginForm />)
    await signIn(user, "inventory1", "Inventory@123")
    expect(nav.push).toHaveBeenCalledWith("/stock")
  })

  it("maps a legacy /dashboard/inventory ?next= to /inventory", async () => {
    const user = userEvent.setup()
    nav.params = new URLSearchParams({ next: "/dashboard/inventory" })
    mockFetchOnce(200, { ok: true, user: { role: "inventory" } })
    render(<LoginForm />)
    await signIn(user, "inventory1", "Inventory@123")
    expect(nav.push).toHaveBeenCalledWith("/inventory")
  })

  it("rejects an off-site ?next= and falls back to the role home", async () => {
    const user = userEvent.setup()
    nav.params = new URLSearchParams({ next: "https://evil.com" })
    mockFetchOnce(200, { ok: true, user: { role: "inventory" } })
    render(<LoginForm />)
    await signIn(user, "inventory1", "Inventory@123")
    expect(nav.push).toHaveBeenCalledWith("/inventory")
    expect(nav.push).not.toHaveBeenCalledWith("https://evil.com")
  })

  it("rejects a protocol-relative ?next= (//evil.com)", async () => {
    const user = userEvent.setup()
    nav.params = new URLSearchParams({ next: "//evil.com" })
    mockFetchOnce(200, { ok: true, user: { role: "cashier" } })
    render(<LoginForm />)
    await signIn(user, "cashier1", "Cashier@123")
    expect(nav.push).toHaveBeenCalledWith("/pos")
    expect(nav.push).not.toHaveBeenCalledWith("//evil.com")
  })

  it("shows an error message on invalid credentials", async () => {
    const user = userEvent.setup()
    mockFetchOnce(401, { ok: false, error: "INVALID_CREDENTIALS" })
    render(<LoginForm />)
    await signIn(user, "nobody", "wrong")
    expect(await screen.findByText(/invalid username/i)).toBeInTheDocument()
  })

  it("reveals the code field on TOTP_REQUIRED and resubmits with the code", async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        async () =>
          new Response(JSON.stringify({ ok: false, error: "TOTP_REQUIRED" }), {
            status: 401,
          })
      )
      .mockImplementationOnce(
        async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
      )
    vi.stubGlobal("fetch", fetchMock)
    render(<LoginForm />)
    await signIn(user, "admin1", "Admin@123")
    const code = await screen.findByLabelText(/authenticator code/i)
    await user.type(code, "123456")
    await user.click(screen.getByRole("button", { name: /sign in/i }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({
      totpCode: "123456",
    })
  })
})
