import path from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const browserTests = path.join(repositoryRoot, "tests/browser");
