import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getToken } from '../api/client'
import { useStore } from '../hooks/useStore'

interface User {
  id: number
  email: string
  nickname: string
  role: string
}

interface AuthGuardProps {
  children: React.ReactNode
  requireAdmin?: boolean
  onUserLoaded?: (isAdmin: boolean, user: User | null) => void
}

export default function AuthGuard({ children, requireAdmin = false, onUserLoaded }: AuthGuardProps) {
  const navigate = useNavigate()
  const storeSetUser = useStore((s) => s.setUser)
  const [checking, setChecking] = useState(true)
  const [isValid, setIsValid] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    const verifyToken = async () => {
      const token = getToken()
      if (!token) {
        navigate('/login')
        return
      }

      try {
        const resp = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` }
        })

        if (resp.ok) {
          const userData = await resp.json()
          setUser(userData)
          setIsAdmin(userData.role === 'admin')
          setIsValid(true)
          storeSetUser(userData)
          onUserLoaded?.(userData.role === 'admin', userData)
        } else {
          localStorage.removeItem('carcare_token')
          localStorage.removeItem('carcare_refresh_token')
          navigate('/login')
        }
      } catch {
        navigate('/login')
      } finally {
        setChecking(false)
      }
    }

    verifyToken()
  }, [navigate, onUserLoaded])

  if (checking) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-slate-500">验证中...</div>
      </div>
    )
  }

  if (!isValid) {
    return null
  }

  if (requireAdmin && !isAdmin) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-red-500">无权限访问</div>
      </div>
    )
  }

  return <>{children}</>
}