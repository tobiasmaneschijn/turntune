import type { SupabaseClient } from "@supabase/supabase-js";
import { changePrivateLibrary, emptyLibrary, libraryMutationSchema, privateLibrarySchema, PrivateLibraryDataError, type LibraryMutation, type PrivateLibrary } from "../features/music/private-library.js";
import { serverT } from "../lib/i18n.js";
import type { ResourcePolicyStore } from "../resources/resource-policy.js";
import { resourceQuotaError } from "./quota-errors.js";

export interface LocalPrivateLibraryData {
  privateLibraries?: Record<string, PrivateLibrary>;
}

/** Owns per-account ordering, revision checks, and local write rollback. */
export class PrivateLibraryRepository {
  private libraryWrites = new Map<string, Promise<PrivateLibrary>>();

  constructor(
    private readonly supabase: SupabaseClient | null,
    private readonly localData: () => LocalPrivateLibraryData,
    private readonly persistFile: () => Promise<void>,
    private readonly resourcePolicies: ResourcePolicyStore
  ) {}

  async getPrivateLibrary(userId: string): Promise<PrivateLibrary> {
    if (!this.supabase) {
      const libraries = this.localData().privateLibraries;
      return structuredClone(libraries && Object.hasOwn(libraries, userId) ? libraries[userId] : emptyLibrary());
    }
    const { data, error } = await this.supabase.from("soundspin_private_libraries").select("data, revision").eq("user_id", userId).maybeSingle();
    if (error) throw new Error(serverT("could_not_load_private_picks_and_sets_value1", { value1: error.message }));
    if (!data) return emptyLibrary();
    const parsed = privateLibrarySchema.safeParse(data.data);
    if (!parsed.success || !Number.isSafeInteger(Number(data.revision)) || Number(data.revision) < 1) throw new PrivateLibraryDataError();
    return parsed.data;
  }

  /** Per-owner ordering plus database revision checks prevent lost concurrent-tab edits. */
  updatePrivateLibrary(userId: string, value: LibraryMutation): Promise<PrivateLibrary> {
    const mutation = libraryMutationSchema.parse(value);
    const previous = this.libraryWrites.get(userId);
    const operation = (previous ? previous.catch(() => emptyLibrary()) : Promise.resolve(emptyLibrary())).then(async () => {
      const {limits}=await this.resourcePolicies.get(userId);
      if (!this.supabase) {
        const local = this.localData();
        local.privateLibraries ||= {};
        const before = local.privateLibraries[userId];
        const next = mutation.type === "clear-library" ? emptyLibrary() : changePrivateLibrary(before || emptyLibrary(), mutation,Date.now(),limits);
        Object.defineProperty(local.privateLibraries, userId, { value: next, writable: true, enumerable: true, configurable: true });
        try { await this.persistFile(); }
        catch (error) {
          const libraries = this.localData().privateLibraries!;
          if (before) libraries[userId] = before; else delete libraries[userId];
          throw error;
        }
        return structuredClone(next);
      }
      const supabase = this.supabase;
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data, error } = await supabase.from("soundspin_private_libraries").select("data, revision").eq("user_id", userId).maybeSingle();
        if (error) throw new Error(serverT("could_not_load_private_picks_and_sets_value1", { value1: error.message }));
        const parsed = data ? privateLibrarySchema.safeParse(data.data) : null;
        const validRevision = !data || (Number.isSafeInteger(Number(data.revision)) && Number(data.revision) >= 1 && Number(data.revision) < Number.MAX_SAFE_INTEGER);
        if (mutation.type !== "clear-library" && ((!parsed?.success && data) || !validRevision)) throw new PrivateLibraryDataError();
        const next = mutation.type === "clear-library" ? emptyLibrary() : changePrivateLibrary(parsed?.success ? parsed.data : emptyLibrary(), mutation,Date.now(),limits);
        if (!data) {
          const insert = await supabase.from("soundspin_private_libraries").insert({ user_id: userId, data: next, revision: 1 });
          if (!insert.error) return next;
          if (insert.error.code === "23505") continue;
          throw resourceQuotaError(insert.error)??new Error(serverT("could_not_save_private_picks_and_sets_value1", { value1: insert.error.message }));
        }
        const revision = validRevision ? Number(data.revision) + 1 : 1;
        const update = await supabase.from("soundspin_private_libraries").update({ data: next, revision, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("revision", data.revision).select("revision").maybeSingle();
        if (update.error) throw resourceQuotaError(update.error)??new Error(serverT("could_not_save_private_picks_and_sets_value1", { value1: update.error.message }));
        if (update.data) return next;
      }
      throw new Error(serverT("your_library_changed_in_another_tab_refresh_and_try_again"));
    });
    this.libraryWrites.set(userId, operation);
    void operation.finally(() => { if (this.libraryWrites.get(userId) === operation) this.libraryWrites.delete(userId); }).catch(() => {});
    return operation;
  }
}
