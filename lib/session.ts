import { SessionOptions } from 'iron-session'

export interface SessionData {
  merchantId: number
  email: string
  fullName: string
  isSuperadmin: boolean
  isLoggedIn: boolean
}

export const SESSION_OPTIONS: SessionOptions = {
  password: process.env.SESSION_SECRET as string,
  cookieName: 'accessly_session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
}
