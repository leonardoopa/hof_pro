import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, getToken, setToken, setUnauthorizedHandler } from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(() => Boolean(getToken()))

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(logout)
    if (!getToken()) return
    api
      .me()
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false))
  }, [logout])

  const authenticate = useCallback(async (request) => {
    const { access_token, user: me } = await request
    setToken(access_token)
    setUser(me)
  }, [])

  const value = useMemo(
    () => ({
      user,
      loading,
      logout,
      login: (credentials) => authenticate(api.login(credentials)),
      register: (payload) => authenticate(api.register(payload)),
    }),
    [user, loading, logout, authenticate],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
