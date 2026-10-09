import { z } from "zod";
import { MUSIC_PROVIDERS } from "../shared/providers.js";

export const allowedProvidersSchema = z.array(z.enum(MUSIC_PROVIDERS))
  .min(1, "Allow at least one music service.")
  .max(MUSIC_PROVIDERS.length)
  .refine(providers => new Set(providers).size === providers.length, "Music services must be unique.");
