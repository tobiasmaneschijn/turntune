import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

interface TestUserDefinition {
  label: string;
  email: string;
  password: string;
  displayName: string;
  isAppAdmin: boolean;
}

function requiredEnvironmentValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}. Add it to .env.test-users.local.`);
  return value;
}

function testUsers(): TestUserDefinition[] {
  return [
    {
      label: "admin",
      email: requiredEnvironmentValue("SOUNDSPIN_TEST_ADMIN_EMAIL"),
      password: requiredEnvironmentValue("SOUNDSPIN_TEST_ADMIN_PASSWORD"),
      displayName: "QA Admin",
      isAppAdmin: true
    },
    {
      label: "host",
      email: requiredEnvironmentValue("SOUNDSPIN_TEST_HOST_EMAIL"),
      password: requiredEnvironmentValue("SOUNDSPIN_TEST_HOST_PASSWORD"),
      displayName: "QA Host",
      isAppAdmin: false
    },
    {
      label: "listener",
      email: requiredEnvironmentValue("SOUNDSPIN_TEST_LISTENER_EMAIL"),
      password: requiredEnvironmentValue("SOUNDSPIN_TEST_LISTENER_PASSWORD"),
      displayName: "QA Listener",
      isAppAdmin: false
    }
  ];
}

async function findUserByEmail(client: SupabaseClient, email: string) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 1000) return null;
  }
  throw new Error(`Could not finish searching for ${email}.`);
}

async function ensureAuthUser(client: SupabaseClient, definition: TestUserDefinition) {
  const existing = await findUserByEmail(client, definition.email);
  if (existing) {
    const { data, error } = await client.auth.admin.updateUserById(existing.id, {
      password: definition.password,
      user_metadata: { ...existing.user_metadata, display_name: definition.displayName }
    });
    if (error) throw error;
    return { user: data.user, action: "updated" as const };
  }

  const { data, error } = await client.auth.admin.createUser({
    email: definition.email,
    password: definition.password,
    email_confirm: true,
    user_metadata: { display_name: definition.displayName }
  });
  if (error) throw error;
  return { user: data.user, action: "created" as const };
}

async function ensureProfile(client: SupabaseClient, user: User, definition: TestUserDefinition) {
  const { error } = await client.from("soundspin_profiles").upsert({
    user_id: user.id,
    display_name: definition.displayName,
    is_app_admin: definition.isAppAdmin
  }, { onConflict: "user_id" });
  if (error) throw error;

  const { data, error: verifyError } = await client
    .from("soundspin_profiles")
    .select("user_id, display_name, is_app_admin")
    .eq("user_id", user.id)
    .single();
  if (verifyError) throw verifyError;
  if (data.display_name !== definition.displayName || data.is_app_admin !== definition.isAppAdmin) {
    throw new Error(`Profile verification failed for ${definition.label}.`);
  }
}

async function main() {
  const client = createClient(
    requiredEnvironmentValue("SUPABASE_URL"),
    requiredEnvironmentValue("SUPABASE_SECRET_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
  );

  for (const definition of testUsers()) {
    const { user, action } = await ensureAuthUser(client, definition);
    await ensureProfile(client, user, definition);
    console.log(`${definition.label}: ${action} and verified (${definition.email})`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
