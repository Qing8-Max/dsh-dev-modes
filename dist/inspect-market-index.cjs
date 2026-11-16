const fs = require('node:fs');
const path = require('node:path');
const base = 'D:/DeepSeek/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-plugin-market-index';
console.log(JSON.stringify({
  root: fs.readdirSync(base),
  pkg: JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8')),
}, null, 2));
