const L=require('/home/user/Damn_Vinted/tests/lib');
const {chromium}=require('playwright-core');
const OUT=process.argv[2]+'/';
(async()=>{
  const server=await L.serviSito(8933);
  const b=await chromium.launch({executablePath:L.chromium(),args:['--no-sandbox']});
  const c=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const p=await c.newPage();
  const oggi=new Date(), iso=d=>d.toISOString().slice(0,10);
  const g=n=>{const d=new Date(oggi);d.setDate(d.getDate()+n);return iso(d);};
  await p.addInitScript(([o,i1,i2,i3,i4,i5,d1])=>{
    localStorage.setItem('piano.stato', JSON.stringify({v:1,
      cose:[
        {id:'a',testo:'finire la relazione per giovedì',momento:'mattina',giorno:o,fatta:true},
        {id:'b',testo:'palestra o camminata lunga',momento:'pomeriggio',giorno:o,fatta:false},
        {id:'c',testo:'chiamare mamma',momento:'sera',giorno:o,fatta:false},
        {id:'d',testo:'cercare il regalo di Sara',momento:'',giorno:o,fatta:false,extra:true},
        {id:'f',testo:'spesa',momento:'',giorno:d1,fatta:false},
        {id:'g',testo:'pagare bolletta',giorno:i1,fatta:true},{id:'h',testo:'x',giorno:i1,fatta:true},
        {id:'i',testo:'y',giorno:i2,fatta:true},{id:'l',testo:'z',giorno:i3,fatta:true}
      ],
      abitudini:[
        {id:'x1',nome:'camminare',emoji:'🚶',giorni:[o,i1,i2,i4,i5]},
        {id:'x2',nome:'leggere prima di dormire',emoji:'📖',giorni:[i1,i2,i3]},
        {id:'x3',nome:'bere due litri',emoji:'💧',giorni:[o]}
      ],
      giornate:{[o]:{energia:4,nota:'giornata piena ma buona'},[i1]:{energia:3},[i2]:{energia:5},[i3]:{energia:2},[i4]:{energia:4},[i5]:{energia:3}}
    }));
  },[g(0),g(-1),g(-2),g(-3),g(-4),g(-5),g(1)]);
  await p.goto('http://127.0.0.1:8933/vita/',{waitUntil:'load'});
  await p.waitForTimeout(600);
  await p.screenshot({path:OUT+'0-casa.png'});
  // col dito, come si fa davvero: si tocca il raggio OGGI
  const box = await p.locator('.raggio[data-sezione="oggi"] .lama').boundingBox();
  await p.touchscreen.tap(box.x+box.width/2, box.y+box.height/2);
  await p.waitForTimeout(900);
  await p.screenshot({path:OUT+'1-oggi.png'});
  // e si gira: un quarto di giro col dito vero
  const cdp = await c.newCDPSession(p);
  const cc = await p.evaluate(()=>{const r=document.getElementById('lunaApp').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,raggio:r.width*0.36};});
  const punti=[]; for(let gr=-90;gr<=0;gr+=9){const a=gr*Math.PI/180;punti.push([cc.x+cc.raggio*Math.cos(a),cc.y+cc.raggio*Math.sin(a)]);}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:punti[0][0],y:punti[0][1]}]});
  for(const q of punti.slice(1)) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:q[0],y:q[1]}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await p.waitForTimeout(700);
  await p.screenshot({path:OUT+'2-girata.png'});
  await b.close();server.close(); console.log('sezione dopo il giro:', await p.evaluate(()=>document.querySelector('.sez.on').id));
})();
