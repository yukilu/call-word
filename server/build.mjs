import esbuild from 'esbuild';
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const releaseDir = path.join(__dirname, '..', 'release');

// 清理旧的 release 目录
rmSync(releaseDir, { recursive: true, force: true });

// 1. 打包后端为单文件（所有第三方库打包进去，node: 内置模块保持外部引用）
//    ESM 格式，扩展名 .mjs，Node.js 直接识别为 ESM
await esbuild.build({
  entryPoints: [path.join(__dirname, 'index.js')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: path.join(releaseDir, 'index.mjs'),
  legalComments: 'none',
  banner: {
    js: `// call-word 后端打包文件（自动生成，请勿手动编辑）
process.env.NODE_ENV = 'production';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
`,
  },
});

// 2. 复制前端静态文件到 release/dist
const webDist = path.join(__dirname, '..', 'web', 'dist');
if (!existsSync(path.join(webDist, 'index.html'))) {
  console.error('[build] 前端尚未构建，请先执行 npm run build -w web');
  process.exit(1);
}
cpSync(webDist, path.join(releaseDir, 'dist'), { recursive: true });

console.log('[build] 打包完成 → release/');
console.log('  release/index.mjs    (后端，含全部依赖)');
console.log('  release/dist/         (前端静态文件)');
console.log('  release/call-word.db  (运行时自动创建)');
console.log('启动: node release/index.mjs');
