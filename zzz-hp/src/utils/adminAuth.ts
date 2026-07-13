const ADMIN_AUTH_STORAGE_KEY = 'zzz-hp-admin-authed'

export function isAdminAuthenticated(): boolean {
  return sessionStorage.getItem(ADMIN_AUTH_STORAGE_KEY) === '1'
}

export function setAdminAuthenticated(value: boolean) {
  if (value) {
    sessionStorage.setItem(ADMIN_AUTH_STORAGE_KEY, '1')
    return
  }
  sessionStorage.removeItem(ADMIN_AUTH_STORAGE_KEY)
}

export function clearAdminAuthenticated() {
  setAdminAuthenticated(false)
}
