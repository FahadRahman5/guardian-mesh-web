import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// IMPORTANT: `base` must match your GitHub repo name exactly (with slashes).
// If your repo is github.com/FahadRahman5/guardian-mesh-web, keep this as-is.
export default defineConfig({
  plugins: [react()],
});
