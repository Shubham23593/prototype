// Real-service browser smoke test. No request interception or fake API payloads.
import 'dotenv/config';
import { chromium as playwright } from 'playwright';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const root=process.cwd();
const runtime=path.join(root,'.runtime');
await fs.mkdir(runtime,{recursive:true});
const base=process.env.E2E_BASE_URL||'http://127.0.0.1:3000';
const checks=[];
const errors=[];
const header=process.env.ADMIN_API_KEY?{'X-Admin-Key':process.env.ADMIN_API_KEY}:{};
let watchedId;
let importedId;
let browser;
function ok(name){checks.push(name);console.log('PASS',name);}
async function get(route,options={}){const r=await fetch(base+route,{...options,headers:{...header,...options.headers}});const result=await r.json();assert.ok(r.ok,`${route}: ${JSON.stringify(result)}`);return result;}
async function launch(){
  let executable=process.env.CHROMIUM_EXECUTABLE_PATH||playwright.executablePath();
  let args=['--no-sandbox'];
  if(!existsSync(executable)){
    const chromium=(await import('@sparticuz/chromium')).default;
    const require=createRequire(import.meta.url);
    const bin=path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../bin');
    // Public npm package's own runtime libraries, not a third-party executable download.
    const libraryDir=path.join(runtime,'chromium-libs');
    await fs.mkdir(libraryDir,{recursive:true});
    const tar=path.join(runtime,'chromium-libs.tar');
    await fs.writeFile(tar,brotliDecompressSync(await fs.readFile(path.join(bin,'al2023.tar.br'))));
    execFileSync('tar',['-xf',tar,'-C',libraryDir]);
    process.env.LD_LIBRARY_PATH=`${path.join(libraryDir,'lib')}:${process.env.LD_LIBRARY_PATH||''}`;
    executable=await chromium.executablePath();
    args=chromium.args.filter(arg=>!['--disable-web-security','--allow-running-insecure-content','--single-process'].includes(arg));
  }
  return playwright.launch({executablePath:executable,args,headless:true});
}
try{
  const baseline=await get('/api/overview?mode=archive&region=india&window=7d&classKey=all');
  assert.equal(baseline.availability,'ready');assert.ok(baseline.model.available);assert.equal(baseline.total,67359);
  assert.equal(baseline.range.from.slice(0,10),'2025-03-25');assert.ok(baseline.events.every(event=>event.acquiredAt.startsWith('2025-')));
  ok('Actual archive, model inference and date provenance');
  browser=await launch();
  const page=await browser.newPage({viewport:{width:1440,height:1060},deviceScaleFactor:1});
  page.on('pageerror',error=>{console.error('Client error after',checks.at(-1),error.stack);errors.push(error.message);});
  page.on('request',request=>{if(request.url().includes('/api/')&&new URL(request.url()).origin!==new URL(base).origin)errors.push('Browser made a cross-origin API request: '+request.url());});
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await expect(page.getByText('67,359',{exact:true}).first()).toBeVisible({timeout:90000});
  await expect(page.locator('.leaflet-container')).toBeVisible();
  if(process.env.ADMIN_API_KEY){
    await page.getByRole('navigation',{name:'Data and model navigation'}).getByRole('button',{name:'Data sources'}).click();
    await page.getByRole('button',{name:'Admin access',exact:true}).click();
    await page.getByLabel('Session-only administrator key').fill(process.env.ADMIN_API_KEY);
    await page.getByRole('button',{name:'Use for this session'}).click();
    await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Overview',exact:true}).click();
    await expect(page.getByText('67,359',{exact:true}).first()).toBeVisible();
  }
  await page.screenshot({path:path.join(runtime,'dashboard-desktop.png'),fullPage:true});
  ok('Desktop dashboard renders genuine counters and Leaflet geometry');
  await page.getByLabel('Filter source type').selectOption('static');
  const staticData=await get('/api/overview?mode=archive&region=india&window=7d&classKey=static');
  await expect(page.getByText(staticData.total.toLocaleString('en-IN'),{exact:true}).first()).toBeVisible({timeout:30000});
  assert.ok(staticData.events.every(event=>event.prediction.classKey==='static'));
  await page.getByLabel('Filter source type').selectOption('all');
  await page.getByLabel('Monitoring region').selectOption('maharashtra');
  await expect(page.getByText('Maharashtra area · Click an observation to investigate')).toBeVisible();
  const local=await get('/api/overview?mode=archive&region=maharashtra&window=7d&classKey=all');
  assert.ok(local.total<baseline.total);assert.ok(local.events.every(e=>e.latitude>=15.5&&e.latitude<=22.5&&e.longitude>=72&&e.longitude<=81));
  await page.getByLabel('Monitoring region').selectOption('india');
  await expect(page.getByText('67,359',{exact:true}).first()).toBeVisible();
  ok('Region and model-class filters query real records');
  await page.getByRole('button',{name:'Expand map',exact:true}).click();
  assert.ok((await page.locator('.leaflet-container').boundingBox()).height>700);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Map layers'}).click();
  const canvasCount=await page.locator('.leaflet-container canvas').count();
  await page.getByLabel('Thermal observations',{exact:true}).uncheck();
  await expect.poll(()=>page.locator('.leaflet-container canvas').count()).toBeLessThan(canvasCount);
  await page.getByLabel('Thermal observations',{exact:true}).check();
  await page.getByRole('button',{name:'Map layers'}).click();
  ok('Fullscreen, Escape and actual map-layer toggles');
  await page.getByRole('button',{name:'Export data'}).click();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('link',{name:'Download CSV'}).click();
  const download=await downloadPromise;
  const csvPath=path.join(runtime,'export-verification.csv');await download.saveAs(csvPath);
  const csv=await fs.readFile(csvPath,'utf8');assert.equal(csv.split(/\r?\n/).length,baseline.total+1);assert.ok(csv.includes('uncalibrated_score'));assert.ok(csv.includes('archive'));
  ok('CSV export contains all matching real observations and provenance');
  const candidate=baseline.latest.find(event=>!event.review);assert.ok(candidate,'A real unreviewed observation is needed for the review test');
  const coordinate=`${Math.abs(candidate.latitude).toFixed(2)}°${candidate.latitude>=0?'N':'S'}, ${Math.abs(candidate.longitude).toFixed(2)}°${candidate.longitude>=0?'E':'W'}`;
  await page.getByRole('button').filter({has:page.getByText(coordinate,{exact:true})}).first().click();
  await expect(page.getByRole('dialog',{name:'Observation investigation'})).toBeVisible();
  await expect(page.getByText('Model assessment',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Fetch source evidence'}).click();
  await expect(page.getByRole('button',{name:'Recheck evidence sources'})).toBeVisible({timeout:150000});
  ok('Observation details and real source-evidence requests (including honest failures)');
  await page.getByLabel('Analyst note',{exact:false}).fill('Automated workflow verification on an actual FIRMS observation. This test note is removed after checking persistence.');
  await page.getByRole('button',{name:'Add to watchlist',exact:true}).click();
  await expect(page.getByRole('button',{name:'Remove from watchlist',exact:true})).toBeVisible();
  watchedId=candidate.id;
  assert.ok((await get('/api/watchlist')).events.some(event=>event.id===watchedId));
  await page.getByRole('button',{name:'Close observation',exact:true}).click();
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Review queue',exact:true}).click();
  await expect(page.getByText(watchedId,{exact:true})).toBeVisible();
  await page.getByLabel(`Remove ${watchedId} from review list`).click();
  await expect(page.getByText(watchedId,{exact:true})).toHaveCount(0);
  watchedId=undefined;
  ok('Persistent analyst review, genuine saved snapshot and removal');
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Observations',exact:true}).click();
  await expect(page.locator('tbody tr')).toHaveCount(12,{timeout:30000});
  const firstId=await page.locator('tbody tr').first().innerText();
  await page.getByLabel('Next observation page').click();
  await expect.poll(()=>page.locator('tbody tr').first().innerText()).not.toBe(firstId);
  await page.getByLabel('Search observation ID, coordinates, class or satellite').fill(candidate.id);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByText(candidate.id,{exact:true})).toBeVisible();
  ok('Server-side catalog pagination and search');
  await page.getByRole('navigation',{name:'Data and model navigation'}).getByRole('button',{name:'Historical data',exact:true}).click();
  await expect(page.getByText('3,16,035',{exact:true})).toBeVisible();
  const real=gunzipSync(await fs.readFile('data/replay/india-2025-q1.csv.gz')).toString('utf8').split('\n').slice(0,61).join('\n');
  const file=path.join(runtime,'e2e-real-source-rows.csv');await fs.writeFile(file,real);
  const importedResponse=page.waitForResponse(response=>response.url().endsWith('/api/history/import')&&response.request().method()==='POST');
  await page.locator('#historical-csv').setInputFiles(file);
  const imported=await (await importedResponse).json();assert.equal(imported.rows,60);importedId=imported.dataset_id;
  await expect(page.getByText('Archive schema validated',{exact:true})).toBeVisible();
  ok('Actual source-row CSV import and validation');
  await page.getByRole('navigation',{name:'Data and model navigation'}).getByRole('button',{name:'Model lab'}).click();
  await expect(page.getByText('Confusion matrix',{exact:true})).toBeVisible();
  await expect(page.getByText('62.7%',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Unseen dates · seen places',exact:true}).click();
  const card=await get('/api/model');
  await expect(page.getByText(`${(card.metrics.temporal.macro_f1*100).toFixed(1)}%`,{exact:true}).first()).toBeVisible();
  await page.screenshot({path:path.join(runtime,'model-lab.png'),fullPage:true});
  if(process.argv.includes('--train')){
    await page.getByRole('button',{name:'Train model',exact:true}).click();
    await page.getByLabel('Training archive').selectOption('default');
    await page.getByRole('button',{name:'Start actual training'}).click();
    await expect(page.getByText('Training complete',{exact:true})).toBeVisible({timeout:240000});
    const updated=await get('/api/model');assert.notEqual(updated.trained_at,card.trained_at);assert.equal(updated.dataset.sha256,card.dataset.sha256);
    ok('Actual background XGBoost retraining and artifact replacement');
  }
  ok('Model lab displays measured holdouts, including weak-class performance');
  await page.getByRole('navigation',{name:'Data and model navigation'}).getByRole('button',{name:'Data sources',exact:true}).click();
  await expect(page.getByText('Every signal has a source.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Check connections',exact:true}).click();
  await expect(page.getByRole('button',{name:'Check connections',exact:true})).toBeEnabled({timeout:40000});
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Overview',exact:true}).click();
  await page.getByRole('button',{name:'Near-real-time',exact:true}).click();
  const live=await get('/api/overview?mode=live&region=india&window=7d&classKey=all');
  if(live.availability==='unavailable'){await expect(page.getByText('Live source unavailable',{exact:true})).toBeVisible({timeout:30000});assert.equal(live.events.length,0);}
  else assert.ok(live.events.every(event=>Date.parse(event.acquiredAt)>=Date.now()-8*86400000));
  await page.getByRole('button',{name:'Historical',exact:true}).click();
  ok('Real source checks and live/historical separation without fabricated fallback');
  await page.goto(base+'/guide');await expect(page.getByRole('heading',{name:'ThermoScan: real data & training guide',exact:true})).toBeVisible();await page.goto(base);await expect(page.getByText('67,359',{exact:true}).first()).toBeVisible({timeout:60000});
  ok('Full historical-data and reproducible-training documentation route');
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('button',{name:'Open navigation',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await expect(page.getByRole('navigation',{name:'Data and model navigation'})).toBeVisible();
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Overview',exact:true}).click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Mobile page should not overflow horizontally');
  await page.screenshot({path:path.join(runtime,'dashboard-mobile.png'),fullPage:true});
  ok('Responsive mobile dashboard and functional navigation');
  assert.deepEqual(errors,[]);
  ok('No client runtime errors or browser cross-origin API calls');
  await fs.writeFile(path.join(runtime,'e2e-report.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,archiveRows:baseline.total,model:baseline.model,clientErrors:errors},null,2));
  console.log(`\n${checks.length} end-to-end checks passed.`);
}catch(error){
  console.error(error);
  if(browser){const pages=browser.contexts().flatMap(context=>context.pages());if(pages[0])await pages[0].screenshot({path:path.join(runtime,'e2e-failure.png'),fullPage:true}).catch(()=>{});}
  process.exitCode=1;
}finally{
  if(watchedId)await get(`/api/events/${watchedId}/review`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:'clear'})}).catch(()=>{});
  if(importedId){await fs.unlink(path.join(root,'data/uploads',`${importedId}.csv`)).catch(()=>{});await fs.unlink(path.join(root,'data/uploads',`${importedId}.provenance.json`)).catch(()=>{});}
  await browser?.close();
}
