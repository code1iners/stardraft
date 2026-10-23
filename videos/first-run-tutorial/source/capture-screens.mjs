import { chromium } from 'playwright-core';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { globSync } from 'node:fs';

/** 실제 앱 컴포넌트에 가상 상태를 전달하는 독립 렌더링 파일. */
await build({entryPoints:['source/screens.tsx'],outfile:'source/screens.cjs',bundle:true,platform:'node',format:'cjs',jsx:'automatic',nodePaths:[resolve('../../apps/desktop/node_modules')]});
execFileSync(process.execPath,['source/screens.cjs'],{stdio:'inherit'});
/** HyperFrames가 설치한 브라우저. 다른 환경에서는 CHROME_PATH로 지정한다. */
const chrome=process.env.CHROME_PATH || globSync(homedir()+'/.cache/hyperframes/chrome/**/chrome-headless-shell').find(p=>statSync(p).isFile());
if(!chrome) throw new Error('먼저 npx hyperframes browser ensure를 실행하세요.');
/** 네트워크와 실제 계정 없이 화면을 그리는 브라우저. */
const browser=await chromium.launch({executablePath:chrome,headless:true});
/** 촬영할 화면 크기 목록. */
const screens=JSON.parse(readFileSync('source/screens.json','utf8'));
/** 동영상 커서 위치에 활용할 실제 버튼 좌표. */
const targets={};
for(const screen of screens){
  const page=await browser.newPage({viewport:{width:screen.width,height:screen.height},deviceScaleFactor:2});
  await page.goto('file://'+resolve('source/'+screen.name+'.html'));
  await page.evaluate(()=>document.fonts.ready);
  if(screen.name==='flow-before') { await page.locator('input[type="password"]').fill('DEMO-KEY-NOT-A-REAL-SECRET'); await page.getByRole('button',{name:'확인',exact:true}).evaluate(el=>el.disabled=false); }
  await page.screenshot({path:'assets/screens/'+screen.name+'.png'});
  targets[screen.name]=await page.locator('button').evaluateAll(nodes=>nodes.map(n=>({label:n.textContent.trim(),x:n.getBoundingClientRect().x+n.getBoundingClientRect().width/2,y:n.getBoundingClientRect().y+n.getBoundingClientRect().height/2})));
  await page.close();
}
await browser.close();
writeFileSync('source/targets.json',JSON.stringify(targets,null,2));
console.log('captured '+screens.length+' actual React screens with fictional data');
