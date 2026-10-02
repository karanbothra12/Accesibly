import bcrypt from 'bcryptjs'

const COST = 12

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST)
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters'
  return null
}
