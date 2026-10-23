import type { NextFunction, Request, Response } from 'express'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { env } from './env.js'

export type AuthUser = {
  username: string
  name: string
  email: string
  roles: string[]
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthUser
    }
  }
}

const issuer = `${env.keycloakUrl}/realms/${env.keycloakRealm}`
const jwks = createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`))

type Claims = JWTPayload & {
  preferred_username?: string
  given_name?: string
  family_name?: string
  name?: string
  email?: string
  azp?: string
  realm_access?: { roles?: string[] }
}

const localUser: AuthUser = {
  username: 'operator',
  name: 'Migration Operator',
  email: 'operator@localhost',
  roles: ['operator'],
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (env.authDisabled) {
    req.auth = localUser
    next()
    return
  }

  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Sign-in required.' })
    return
  }

  try {
    const { payload } = await jwtVerify(header.slice('Bearer '.length), jwks, {
      issuer,
      clockTolerance: 5,
    })
    const claims = payload as Claims
    if (claims.azp && claims.azp !== env.keycloakClientId) {
      res.status(401).json({ error: 'Sign-in required.' })
      return
    }

    const username = claims.preferred_username ?? 'unknown'
    const name =
      claims.name ||
      [claims.given_name, claims.family_name].filter(Boolean).join(' ') ||
      username
    const roles = (claims.realm_access?.roles ?? []).filter(
      (role) => !role.startsWith('default-roles-') && role !== 'offline_access' && role !== 'uma_authorization',
    )

    req.auth = {
      username,
      name,
      email: claims.email ?? '',
      roles,
    }
    next()
  } catch (error) {
    console.error('Token verification failed', error)
    res.status(401).json({ error: 'Sign-in required.' })
  }
}
