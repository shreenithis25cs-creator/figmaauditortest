const SESSION_KEY = 'figma-auditor-session'

type AuthSession = {
  access_token: string
  refresh_token: string
  expires_at: number
}

export type ScanRecord = {
  id: number
  component_count: number | null
  unused_count: number | null
  duplicate_groups: number | null
  status: string
  created_at: string
}

export type DashboardData = {
  account: {
    plan: string
    free_scans_left: number
    credits: number
    plan_expires_at: string | null
    email: string | null
  }
  scans: ScanRecord[]
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isScanRecord(value: unknown): value is ScanRecord {
  const scan = record(value)
  return Boolean(
    scan &&
    typeof scan.id === 'number' &&
    (scan.component_count === null || typeof scan.component_count === 'number') &&
    (scan.unused_count === null || typeof scan.unused_count === 'number') &&
    (scan.duplicate_groups === null || typeof scan.duplicate_groups === 'number') &&
    typeof scan.status === 'string' &&
    typeof scan.created_at === 'string',
  )
}

function isScanArray(value: unknown): value is ScanRecord[] {
  return Array.isArray(value) && value.every(isScanRecord)
}

function configuration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '')
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to connect Supabase.')
  }
  return { url, anonKey }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error('The server returned an unreadable response.')
  }
  const result = record(body)
  if (!result) throw new Error('The server returned an invalid response.')
  if (!response.ok) {
    const error = typeof result.error === 'string' ? result.error : ''
    const message = typeof result.msg === 'string'
      ? result.msg
      : typeof result.message === 'string'
        ? result.message
        : ''
    if (error === 'account_not_linked') {
      throw new Error('No Figma Auditor account uses this email yet. Save this same verified email in the Figma plugin first.')
    }
    if (error === 'account_link_ambiguous') {
      throw new Error('This email is linked to more than one Figma account. Contact support to resolve the account link.')
    }
    if (error === 'email_not_verified') {
      throw new Error('Verify your email address before opening the dashboard.')
    }
    if (error === 'rate_limited') {
      throw new Error('Too many dashboard requests. Wait a minute and try again.')
    }
    throw new Error(message || error || `Request failed (${response.status}).`)
  }
  return result
}

function saveSession(body: Record<string, unknown>): AuthSession | null {
  if (
    typeof body.access_token !== 'string' ||
    typeof body.refresh_token !== 'string'
  ) {
    return null
  }
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600
  const session: AuthSession = {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: typeof body.expires_at === 'number'
      ? body.expires_at
      : Math.floor(Date.now() / 1000) + expiresIn,
  }
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  return session
}

function loadSession(): AuthSession | null {
  const stored = window.sessionStorage.getItem(SESSION_KEY)
  if (!stored) return null
  try {
    const parsed: unknown = JSON.parse(stored)
    const value = record(parsed)
    if (
      !value ||
      typeof value.access_token !== 'string' ||
      typeof value.refresh_token !== 'string' ||
      typeof value.expires_at !== 'number'
    ) {
      window.sessionStorage.removeItem(SESSION_KEY)
      return null
    }
    return {
      access_token: value.access_token,
      refresh_token: value.refresh_token,
      expires_at: value.expires_at,
    }
  } catch {
    window.sessionStorage.removeItem(SESSION_KEY)
    return null
  }
}

async function authRequest(path: string, body: Record<string, string>) {
  const { url, anonKey } = configuration()
  const response = await fetch(`${url}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return responseJson(response)
}

export async function signUp(email: string, password: string): Promise<boolean> {
  const result = await authRequest('signup', { email, password })
  return saveSession(result) !== null
}

export async function signIn(email: string, password: string): Promise<void> {
  const result = await authRequest('token?grant_type=password', { email, password })
  if (!saveSession(result)) {
    throw new Error('Sign-in succeeded but no session was returned.')
  }
}

async function accessToken(): Promise<string | null> {
  const session = loadSession()
  if (!session) return null
  if (session.expires_at > Math.floor(Date.now() / 1000) + 60) {
    return session.access_token
  }

  let result: Record<string, unknown>
  try {
    result = await authRequest('token?grant_type=refresh_token', {
      refresh_token: session.refresh_token,
    })
  } catch (error) {
    window.sessionStorage.removeItem(SESSION_KEY)
    throw error
  }
  const refreshed = saveSession(result)
  if (!refreshed) {
    window.sessionStorage.removeItem(SESSION_KEY)
    throw new Error('Your session expired. Please sign in again.')
  }
  return refreshed.access_token
}

export async function getDashboard(): Promise<DashboardData | null> {
  const token = await accessToken()
  if (!token) return null

  const { url, anonKey } = configuration()
  const response = await fetch(`${url}/functions/v1/dashboard`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  })
  if (response.status === 401) {
    window.sessionStorage.removeItem(SESSION_KEY)
    throw new Error('Your session expired. Please sign in again.')
  }
  const result = await responseJson(response)
  const account = record(result.account)
  const scans = result.scans
  if (
    !account ||
    typeof account.plan !== 'string' ||
    typeof account.free_scans_left !== 'number' ||
    typeof account.credits !== 'number' ||
    !nullableString(account.plan_expires_at) ||
    !nullableString(account.email) ||
    !isScanArray(scans)
  ) {
    throw new Error('The dashboard returned incomplete account data.')
  }
  return {
    account: {
      plan: account.plan,
      free_scans_left: account.free_scans_left,
      credits: account.credits,
      plan_expires_at: account.plan_expires_at,
      email: account.email,
    },
    scans,
  }
}

export async function signOut(): Promise<void> {
  try {
    const token = await accessToken()
    if (token) {
      const { url, anonKey } = configuration()
      const response = await fetch(`${url}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
      })
      if (!response.ok) await responseJson(response)
    }
  } finally {
    window.sessionStorage.removeItem(SESSION_KEY)
  }
}
