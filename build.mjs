import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const dep = name => {
  let dir=path.dirname(require.resolve(name));
  while (dir!==path.dirname(dir)) {
    const file=path.join(dir,'package.json');
    if(fs.existsSync(file) && JSON.parse(fs.readFileSync(file,'utf8')).name===name)return dir;
    dir=path.dirname(dir);
  }
  throw new Error('Package not found: '+name);
};
const { build, transform } = await import(path.join(dep('esbuild'), 'lib/main.js'));
const { zipSync } = await import(path.join(dep('fflate'), 'esm/index.mjs'));
const root = path.dirname(fileURLToPath(import.meta.url));
const read = file => fs.readFileSync(file, 'utf8');
const pdf = dep('pdfjs-dist');
const script = (await build({entryPoints:[path.join(pdf,'legacy/build/pdf.mjs')],bundle:true,format:'iife',globalName:'pdfjsLib',platform:'browser',target:'es2022',minify:true,write:false,legalComments:'inline'})).outputFiles[0].text;
const worker = (await build({entryPoints:[path.join(pdf,'legacy/build/pdf.worker.mjs')],bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,write:false,legalComments:'inline'})).outputFiles[0].text;
const fflate = read(path.join(dep('fflate'),'umd/index.js')).replace(/\/\/# sourceMappingURL=.*$/gm,'');
const pdfLib = read(path.join(dep('pdf-lib'),'dist/pdf-lib.min.js')).replace(/\/\/# sourceMappingURL=.*$/gm,'');
const webmFix = (await transform(read(path.join(dep('fix-webm-duration'),'fix-webm-duration.js')),{target:'es2022',minify:true})).code;
const assetEntries = {};
const licenseFiles = [
  ['PDF.js 5.6.205 — Apache-2.0',path.join(pdf,'LICENSE')],
  ['pdf-lib 1.17.1 — MIT',path.join(dep('pdf-lib'),'LICENSE.md')],
  ['fflate 0.8.2 — MIT',path.join(dep('fflate'),'LICENSE')],
  ['fix-webm-duration 1.0.6 — MIT',path.join(dep('fix-webm-duration'),'LICENSE')],
];
for (const dir of ['cmaps','standard_fonts','wasm']) {
  for (const name of fs.readdirSync(path.join(pdf,dir)).sort()) {
    if (name.startsWith('LICENSE')) licenseFiles.push(['PDF.js '+dir+'/'+name,path.join(pdf,dir,name)]);
    else if (name.endsWith('.bcmap') || /\.(pfb|ttf)$/.test(name) || ['openjpeg.wasm','jbig2.wasm'].includes(name)) assetEntries[dir+'/'+name] = new Uint8Array(fs.readFileSync(path.join(pdf,dir,name)));
  }
}
for(const [name,file] of [['@pdf-lib/standard-fonts','LICENSE.md'],['@pdf-lib/upng','LICENSE'],['pako','LICENSE']]) {
  const pkg = JSON.parse(read(path.join(dep(name),'package.json')));
  licenseFiles.push([name+' '+pkg.version+' — '+pkg.license,path.join(dep(name),file)]);
}
// The legacy PDF.js build includes core-js compatibility code.
licenseFiles.push(['core-js — MIT (bundled by the PDF.js legacy build)',path.join(root,'src/core-js-LICENSE.txt')]);
const notices = 'Third-party software notices\n\nThese licenses apply only to the identified components and their data.\n\n' + licenseFiles.map(([name,file])=>'='.repeat(70)+'\n'+name+'\n'+'='.repeat(70)+'\n'+read(file)).join('\n\n');
fs.writeFileSync(path.join(root,'THIRD_PARTY_NOTICES.txt'),notices);
const zipWorker = fflate + '\nself.onmessage=e=>{try{const entries=Object.create(null);for(const x of e.data.entries)entries[x.name]=x.bytes;const bytes=fflate.zipSync(entries,{level:e.data.level});self.postMessage({bytes},[bytes.buffer]);}catch(err){self.postMessage({error:"ZIPを作れませんでした。ファイル数や容量を減らしてください。"});}};';
const embedded = 'const EMBEDDED='+JSON.stringify({pdfWorker:Buffer.from(worker).toString('base64'),pdfAssets:Buffer.from(zipSync(assetEntries,{level:9})).toString('base64'),zipWorker:Buffer.from(zipWorker).toString('base64')})+';\n';
const app = (await transform(read(path.join(root,'src/app.js')),{target:'es2022',minify:false,legalComments:'inline'})).code;
const escapeHTML = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const escapeScript = s => s.replace(/<\/script/gi,'<\\/script');
let html=read(path.join(root,'src/shell.html'));
const replacements = {
  '/*__STYLE__*/':read(path.join(root,'src/style.css')),
  '/*__LICENSE__*/':escapeHTML(read(path.join(root,'LICENSE'))),
  '/*__NOTICES__*/':escapeHTML(notices),
  '/*__LIBRARIES__*/':escapeScript(fflate+'\n'+pdfLib+'\n'+webmFix+'\n'+script),
  '/*__APP__*/':escapeScript(embedded+app)
};
for(const [needle,value] of Object.entries(replacements)) html=html.replace(needle,()=>value);
fs.writeFileSync(path.join(root,'index.html'),html);
console.log('Built index.html ('+(Buffer.byteLength(html)/1024/1024).toFixed(2)+' MiB), libraries and PDF resources embedded.');
