import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(directory, '..', '.env') })

function required(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing ${name} in server/.env`)
  }
  return value
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL'),
  keycloakUrl: required('KEYCLOAK_URL').replace(/\/$/, ''),
  keycloakRealm: required('KEYCLOAK_REALM'),
  keycloakClientId: required('KEYCLOAK_CLIENT_ID'),
  keycloakAdmin: required('KEYCLOAK_ADMIN'),
  keycloakAdminPassword: required('KEYCLOAK_ADMIN_PASSWORD'),
  webOrigin: required('WEB_ORIGIN').replace(/\/$/, ''),
  operatorUsername: process.env.KEYCLOAK_OPERATOR_USERNAME ?? 'operator',
  operatorPassword: process.env.KEYCLOAK_OPERATOR_PASSWORD ?? 'operator',
  authDisabled: process.env.AUTH_DISABLED === 'true',
}

export const schemaPath = path.join(directory, '..', '..', 'db', 'init', '001_schema.sql')
