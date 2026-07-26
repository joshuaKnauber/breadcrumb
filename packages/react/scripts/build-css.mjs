/**
 * Compiles the dashboard stylesheet into something safe to drop into someone
 * else's page.
 *
 * Two transforms do the isolation work. Every selector is scoped under
 * `.bc-root`, so no rule here can reach outside the dashboard and the host's
 * own `.flex` can never collide with ours. Then `@layer` wrappers are removed:
 * layered CSS loses to *any* unlayered rule in the host document regardless of
 * specificity, so staying unlayered is what lets the scoped selectors actually
 * win the cascade.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "../src/styles.css");
const out = join(here, "../dist/styles.css");

const SCOPE = ".bc-root";

/** Selectors inside these at-rules are keyframe stops, not element selectors. */
const NOT_SELECTORS = new Set(["keyframes", "-webkit-keyframes", "font-face", "property"]);

function inNonSelectorContext(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "atrule" && NOT_SELECTORS.has(p.name.toLowerCase())) return true;
  }
  return false;
}

function scopeSelector(selector) {
  const part = selector.trim();
  // `:root` is how the source addresses the dashboard root itself, and how
  // Tailwind emits theme variables. Both become the scope element.
  if (part === ":root" || part.startsWith(":root:") || part.startsWith(":root[")) {
    return SCOPE + part.slice(":root".length);
  }
  if (part.startsWith(":root ")) return SCOPE + part.slice(":root".length);
  // A bare `*` block (Tailwind's --tw-* defaults) has to cover the root too,
  // since descendant selectors never match the element they descend from.
  if (part === "*") return `${SCOPE}, ${SCOPE} *`;
  return `${SCOPE} ${part}`;
}

const scopePlugin = {
  postcssPlugin: "breadcrumb-scope",
  Once(root) {
    root.walkRules((rule) => {
      if (inNonSelectorContext(rule)) return;
      rule.selectors = rule.selectors.flatMap((s) => scopeSelector(s).split(",").map((x) => x.trim()));
    });
    root.walkAtRules("layer", (at) => {
      // `@layer a, b, c;` declares order and has no body — it goes away with them.
      if (!at.nodes) at.remove();
      else at.replaceWith(at.nodes);
    });
  },
};

// Left as bare specifiers so the consumer's bundler resolves and emits the font
// files. Inlining them here would produce url()s pointing into our node_modules.
const FONTS = [
  "@fontsource/instrument-sans/latin-400.css",
  "@fontsource/instrument-sans/latin-500.css",
  "@fontsource/instrument-sans/latin-600.css",
  "@fontsource/geist-mono/latin-400.css",
  "@fontsource/geist-mono/latin-500.css",
];

const css = readFileSync(src, "utf8");
const result = await postcss([tailwind(), scopePlugin]).process(css, { from: src, to: out });

const imports = FONTS.map((f) => `@import "${f}";`).join("\n");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${imports}\n\n${result.css}`);

console.log(`▸ ${out} (${(result.css.length / 1024).toFixed(0)} KB)`);
