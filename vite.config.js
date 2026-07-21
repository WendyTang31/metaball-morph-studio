import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 打包目标:一个自包含的 dist/index.html —— 所有 JS(含 jszip)与 CSS 内联进单个文件。
// 这样才能双击(file://)直接运行:分离的 ES 模块在 file:// 下会被浏览器 CORS 拦截,
// 只有内联成 inline <script> 才可跑。base:'./' 保证任何引用都是相对路径。
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2020',
    // 全部内联,不切分 chunk / 不外抽 CSS,产物就一个 HTML。
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
  },
});
