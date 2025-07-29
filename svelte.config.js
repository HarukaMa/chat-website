import adapter from "@sveltejs/adapter-cloudflare"
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte"
import { renameSync, readFileSync, writeFileSync } from "node:fs"
import * as ts from "typescript"

function entry_hijack(_options = {}) {
  return {
    name: "adapter-cloudflare-entry-hijack",
    async adapt(builder) {
      await adapter().adapt(builder)
      let dest = builder.getBuildDirectory("cloudflare")
      renameSync(`${dest}/entry.js`, `${dest}/_worker.js`)
      const entry_ts = readFileSync(`src/entry.ts`).toString()
      const entry_js = ts.transpileModule(entry_ts, {
        compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2021 },
      }).outputText
      writeFileSync(`${dest}/entry.js`, entry_js)
    },
    async emulate() {
      adapter().emulate()
    },
    supports: adapter().supports,
  }
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // Consult https://svelte.dev/docs/kit/integrations
  // for more information about preprocessors
  preprocess: vitePreprocess(),
  kit: { adapter: entry_hijack() },
}

export default config
