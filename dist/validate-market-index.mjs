import { readFileSync } from 'node:fs';

const modulePath = 'file:///D:/DeepSeek/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js';
const { parseMarketIndex, marketInstallTarget } = await import(modulePath);

const file = process.argv[2];
const indexUrl = process.argv[3] ?? 'https://example.com/dsh-market/index.json';
const parsed = parseMarketIndex(JSON.parse(readFileSync(file, 'utf8')), indexUrl);

console.log(JSON.stringify({
  ok: true,
  format: parsed.format,
  title: parsed.title,
  plugins: parsed.plugins.map((plugin) => ({
    name: plugin.name,
    versions: plugin.versions.map((version) => ({
      version: version.version,
      install: marketInstallTarget(plugin.name, version),
    })),
  })),
}, null, 2));
