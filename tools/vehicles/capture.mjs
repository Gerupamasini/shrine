import {chromium} from '@playwright/test';
import fs from 'node:fs';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const page=await browser.newPage({viewport:{width:1600,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const target=process.argv[2]??'catalog';const params=new URLSearchParams();if(target!=='catalog')params.set('model',target);if(process.argv[3])params.set('view',process.argv[3]);const suffix='?'+params;
await page.goto('http://127.0.0.1:5173/tools/vehicles/gallery.html'+suffix);await page.waitForFunction(()=>window.expectedModels>0&&window.loaded===window.expectedModels,null,{timeout:120000});
await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
fs.mkdirSync('artifacts/vehicles',{recursive:true});const file=`artifacts/vehicles/${target}${process.argv[3]?'-'+process.argv[3]:''}.png`;await page.screenshot({path:file});
console.log(JSON.stringify({file,loaded:await page.evaluate(()=>window.loaded),errors:[...errors,...await page.evaluate(()=>window.errors)]}));await browser.close();if(errors.length)process.exitCode=1;
