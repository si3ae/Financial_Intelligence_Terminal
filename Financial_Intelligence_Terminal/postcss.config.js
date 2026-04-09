/**
 * PostCSS configuration.
 *
 * Without this file, Vite passes CSS through untouched and never runs Tailwind.
 * The `@tailwind base/components/utilities` directives in `src/index.css` then
 * remain inert, every utility class (`flex`, `bg-background`, etc.) becomes a
 * no-op, and the page renders unstyled.
 *
 * - tailwindcss : reads `tailwind.config.ts` and emits CSS for the classes that
 *                 are actually used in the source tree (JIT).
 * - autoprefixer: adds vendor prefixes (-webkit-, -moz-, ...) to the generated CSS
 *                 based on the project's browserslist.
 *
 * Vite auto-discovers `postcss.config.{js,cjs,mjs}` at the project root, so no
 * import or `vite.config.ts` change is required.
 */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
