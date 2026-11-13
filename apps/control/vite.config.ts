import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// 控制台构建为静态文件，由 LiveCG 服务端托管在 /control/ 下。
// 图文模板（/graphics/templates/*.js）在运行时动态加载，不打包：新增模板无需重新构建控制台。
export default defineConfig({
  base: "/control/",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        rooms: resolve(__dirname, "rooms.html"),
      },
    },
  },
});
