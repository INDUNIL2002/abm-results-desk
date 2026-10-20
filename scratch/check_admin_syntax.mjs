import fs from 'fs';

const html = fs.readFileSync('admin/index.html', 'utf8');
const scriptMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);

if (!scriptMatch) {
  console.log('No script found');
} else {
  // Save module code to test import/syntax
  fs.writeFileSync('scratch/admin_temp_script.mjs', scriptMatch[1]);
  console.log('Saved scratch/admin_temp_script.mjs');
}
