import webPush from 'web-push';
import fs from 'node:fs';
import path from 'node:path';
// Generar una sola vez. Nunca imprimir ni versionar la clave privada.
const filename=path.resolve('.env.local');
let env=fs.existsSync(filename)?fs.readFileSync(filename,'utf8'):'';
const field=(name)=>env.match(new RegExp('^'+name+'=(.+)$','m'))?.[1]?.replace(/^["']|["']$/g,'');
let publicKey=field('WEB_PUSH_PUBLIC_KEY'),privateKey=field('WEB_PUSH_PRIVATE_KEY');
if(!publicKey&&!privateKey){({publicKey,privateKey}=webPush.generateVAPIDKeys());env+='\nWEB_PUSH_PUBLIC_KEY='+publicKey+'\nWEB_PUSH_PRIVATE_KEY='+privateKey+'\nWEB_PUSH_SUBJECT=https://fleet.fenice.cl\n';fs.writeFileSync(filename,env,{mode:0o600});}
if(!publicKey||!privateKey)throw new Error('Configuracion VAPID incompleta. No se reemplazan claves existentes.');
fs.chmodSync(filename,0o600);
const directory=path.resolve('.fenice/notifications');fs.mkdirSync(directory,{recursive:true,mode:0o700});
fs.writeFileSync(path.join(directory,'render-env-transfer.json'),JSON.stringify({envVars:[{key:'WEB_PUSH_PUBLIC_KEY',value:publicKey},{key:'WEB_PUSH_PRIVATE_KEY',value:privateKey},{key:'WEB_PUSH_SUBJECT',value:'https://fleet.fenice.cl'},{key:'ALERT_WORKER_ENABLED',value:'true'}]}),{mode:0o600});
console.log('Configuracion Web Push preparada en archivos privados. No se han impreso claves.');
