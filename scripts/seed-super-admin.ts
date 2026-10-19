import { loadEnvConfig } from "@next/env";
import { neon } from "@neondatabase/serverless";
import { hashPassword } from "../src/lib/password";

loadEnvConfig(process.cwd());

class SeedConfigurationError extends Error {}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new SeedConfigurationError(
      `${name} must be set in .env.local before seeding.`,
    );
  }
  return value;
}

async function seedSuperAdmin(): Promise<void> {
  const databaseUrl = requiredEnvironmentVariable("DATABASE_URL");
  const displayName = requiredEnvironmentVariable("SUPER_ADMIN_DISPLAY_NAME");
  const loginName = requiredEnvironmentVariable("SUPER_ADMIN_LOGIN_NAME");
  const password = requiredEnvironmentVariable("SUPER_ADMIN_PASSWORD");
  let passwordHash: string;
  try {
    passwordHash = await hashPassword(password);
  } catch (error) {
    if (error instanceof Error && error.message.includes("4 characters")) {
      throw new SeedConfigurationError(error.message);
    }
    throw error;
  }
  const sql = neon(databaseUrl);

  const existingSuperAdmin =
    await sql`select id from users where role = 'super_admin' limit 1`;
  if (existingSuperAdmin.length > 0) {
    throw new SeedConfigurationError(
      "A Super Admin already exists. The one-time seed will not create another.",
    );
  }

  const existingLogin =
    await sql`select id from users where lower(btrim(login_name)) = lower(btrim(${loginName})) limit 1`;
  if (existingLogin.length > 0) {
    throw new SeedConfigurationError("That login name is already in use.");
  }

  await sql`
    insert into users (role, parent_user_id, display_name, login_name, password_hash)
    values ('super_admin', null, ${displayName}, ${loginName}, ${passwordHash})
  `;

  console.log("Super Admin created successfully.");
}

seedSuperAdmin().catch((error: unknown) => {
  if (error instanceof SeedConfigurationError) {
    console.error(`Super Admin seed failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "unknown";
  const message = `Database operation failed (code: ${code}). Check the connection and schema.`;
  console.error(`Super Admin seed failed: ${message}`);
  process.exitCode = 1;
});
