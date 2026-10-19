'use strict';
/* Audio Visualizer Pro — Studio Reborn
 * Rendering is isolated from audio capture. Instrument faces, needles,
 * mechanical parts and phosphor traces are drawn as adaptive Canvas geometry.
 */
(() => {
  const $ = id => document.getElementById(id);
  const clamp = (v,lo=0,hi=1) => Math.max(lo,Math.min(hi,v));
  const lerp = (a,b,t)=>a+(b-a)*t;
  const TAU = Math.PI*2;
  const modes=[{id:'blue',title:'BLUE STUDIO',render:'vu'},{id:'gold',title:'VINTAGE GOLD',render:'vu'},{id:'copper',title:'COPPER VALVE',render:'vu'},{id:'waterfall',title:'3D SPECTRAL WATERFALL',render:'waterfall'},{id:'scope',title:'DUAL CHANNEL OSCILLOSCOPE',render:'scope'},{id:'spectrum',title:'SA-64 · SPECTRUM ANALYZER',render:'spectrum'}].concat((window.AVModes||[]).map((m,i)=>({id:'extra',title:m.title,render:'extra',idx:i})));
  let mode = 5;
  let nextToast = null;
  const stage=$('stage');
  const sceneEls=modes.map(m=>$('scene-'+m.id));
  const controlsObserver=new ResizeObserver(()=>stage.style.setProperty('--controls-height',`${$('stage').querySelector('.toolbar').getBoundingClientRect().height}px`));
  controlsObserver.observe(stage.querySelector('.toolbar'));
  modes.forEach((m,i)=>{const option=document.createElement('option');option.value=i;option.textContent=`${String(i+1).padStart(2,'0')} · ${m.title.replace(/^\d+\s*·\s*/, '')}`;$('mode-select').appendChild(option)});
  $('mode-select').addEventListener('change',e=>setMode(Number(e.target.value)));
  function toast(text){const el=$('toast');el.textContent=text;el.classList.add('show');if(nextToast)clearTimeout(nextToast);nextToast=setTimeout(()=>el.classList.remove('show'),2400)}
  function setMode(i){mode=((i%modes.length)+modes.length)%modes.length;stage.classList.toggle('instrument',mode===5);stage.classList.toggle('gallery',mode!==5);$('mode-select').value=String(mode);sceneEls.forEach((el,j)=>el.classList.toggle('visible',el===sceneEls[mode]));$('mode-name').textContent=modes[mode].title;$('mode-index').textContent=`${String(mode+1).padStart(2,'0')} / ${String(modes.length).padStart(2,'0')}`;}
  $('next').addEventListener('click',()=>setMode(mode+1));$('previous').addEventListener('click',()=>setMode(mode-1));
  $('fullscreen').addEventListener('click',()=>{if(!document.fullscreenElement){stage.requestFullscreen().catch(()=>toast('Полный экран недоступен'));}else{document.exitFullscreen().catch(()=>{});}});
  window.addEventListener('keydown',e=>{if(e.altKey||e.ctrlKey||e.metaKey||e.target.matches('input,select,textarea,button,[contenteditable=true]'))return;if(e.code==='Space'&&mode===5){e.preventDefault();$('hold').click();return}if(e.key==='ArrowRight'){e.preventDefault();setMode(mode+1)}else if(e.key==='ArrowLeft'){e.preventDefault();setMode(mode-1)}else if(e.key==='PageDown'){e.preventDefault();setMode(mode+10)}else if(e.key==='PageUp'){e.preventDefault();setMode(mode-10)}else if(e.key==='Home')setMode(0);else if(e.key.toLowerCase()==='d')setDemo();else if(e.key.toLowerCase()==='f')$('fullscreen').click();else if(e.key.toLowerCase()==='s')startSystemAudio();});

  // One measurement path for microphone, loopback, files and PCM demo.
  // Display averaging is done in linear power by SpectrumEngine, never byte dB.
  let sourceMode='idle',audioContext=null,stream=null,sourceNode=null,analysers=null,playerSource=null,playingUrl=null;
  const wavSize=2048,FFT=32768,bands=64;
  let timeL=new Float32Array(FFT),timeR=new Float32Array(FFT);
  let freqL=new Float32Array(FFT/2),freqR=new Float32Array(FFT/2);
  let levels=[0,0],audioBands=new Float32Array(bands),leftWave=new Float32Array(wavSize),rightWave=new Float32Array(wavSize),lastFrame=0;
  let spectrumEngine=new window.AVSpectrum(48000,{fftSize:FFT,bands,minDb:-130});
  let activeNodes=[],sourceRequest=0,clipSeconds=0,held=false,readoutElapsed=0;
  let samplePeaks=[-Infinity,-Infinity],rmsLevels=[0,0];
  let frozenSpectrum=null;
  const spectrumDisplay=new window.AVSpectrumDisplay($('spectrum-canvas'));
  const sourceLabels={idle:'НЕТ СИГНАЛА',demo:'DEMO · PCM TEST',file:'АУДИОФАЙЛ',mic:'МИКРОФОН',system:'СИСТЕМНЫЙ ЗВУК'};
  function status(label,live){$('status').classList.toggle('live',live);$('status').lastChild.textContent=label}
  function responseOptions(){return $('response').value==='slow'?{attack:.1,release:1}:{attack:.035,release:.32}}
  function setHold(value){
    held=value;frozenSpectrum=value?{...spectrumEngine,db:Float32Array.from(spectrumEngine.db),peaks:Float32Array.from(spectrumEngine.peaks)}:null;
    $('hold').setAttribute('aria-pressed',String(value));
  }
  function updateSourceUI(){
    $('input-readout').textContent=sourceLabels[sourceMode];
    status(sourceMode==='idle'?'IDLE':sourceMode==='demo'?'TEST':sourceMode.toUpperCase(),sourceMode!=='idle');
    ['demo','system','mic','file'].forEach(id=>$(id).setAttribute('aria-pressed',String(sourceMode===id)));
    const df=spectrumEngine.binWidth.toFixed(2);
    $('fft-info').textContent=`FFT ${FFT} · Δf ${df} Hz · ${Math.round(spectrumEngine.sampleRate/100)/10} kHz`;
    $('fft-info').title=`Окно Blackman: ${(FFT/spectrumEngine.sampleRate*1000).toFixed(0)} мс. Разрешение ограничено окном FFT; близкие низкие частоты могут сливаться. Цифровой уровень, не SPL.`;
  }
  function disconnect(){
    const previous=stream;stream=null;
    activeNodes.forEach(n=>{try{n.disconnect()}catch{}});activeNodes=[];
    if(sourceMode==='demo'&&sourceNode){try{sourceNode.stop()}catch{}}
    if(previous)previous.getTracks().forEach(track=>track.stop());
    $('player').pause();sourceNode=null;analysers=null;
    levels.fill(0);rmsLevels.fill(0);audioBands.fill(0);leftWave.fill(0);rightWave.fill(0);samplePeaks.fill(-Infinity);
    spectrumEngine.reset();clipSeconds=0;setHold(false);sourceMode='idle';updateSourceUI();
  }
  async function ensureAudio(){
    if(!audioContext)audioContext=new (window.AudioContext||window.webkitAudioContext)({latencyHint:'interactive'});
    await audioContext.resume();
    if(audioContext.state!=='running')throw Error('Аудиоконтекст приостановлен. Нажмите кнопку источника ещё раз.');
    return audioContext;
  }
  function bindSplitter(src,playback=false){
    const ac=audioContext;
    const stereo=ac.createGain();stereo.channelCount=2;stereo.channelCountMode='explicit';stereo.channelInterpretation='speakers';
    const split=ac.createChannelSplitter(2),l=ac.createAnalyser(),r=ac.createAnalyser(),sink=ac.createGain();
    [l,r].forEach(a=>{a.fftSize=FFT;a.smoothingTimeConstant=0;a.minDecibels=-160;a.maxDecibels=0});
    // Speaker upmix duplicates mono, preserving real stereo separation.
    src.connect(stereo);stereo.connect(split);split.connect(l,0);split.connect(r,1);
    // A silent destination keeps even unmonitored microphone/demo graphs running.
    sink.gain.value=0;l.connect(sink);r.connect(sink);sink.connect(ac.destination);
    if(playback)src.connect(ac.destination);
    analysers=[l,r];activeNodes=[src,stereo,split,l,r,sink];sourceNode=src;
    spectrumEngine=new window.AVSpectrum(ac.sampleRate,{fftSize:FFT,bands,minDb:-130,...responseOptions()});
    updateSourceUI();
  }
  async function bindStream(s,isSystem,request){
    if(request!==sourceRequest){s.getTracks().forEach(t=>t.stop());return}
    await ensureAudio();
    if(request!==sourceRequest){s.getTracks().forEach(t=>t.stop());return}
    disconnect();
    try{bindSplitter(audioContext.createMediaStreamSource(s));stream=s;sourceMode=isSystem?'system':'mic';updateSourceUI();
      s.getTracks().forEach(t=>t.addEventListener('ended',()=>{if(stream===s)setIdle()},{once:true}));
      toast(isSystem?'Захват звука активен':'Микрофон подключён · мониторинг выключен');
    }catch(error){s.getTracks().forEach(t=>t.stop());throw error}
  }
  async function startSystemAudio(){
    const request=++sourceRequest;let acquired=null;
    try{
      if(!navigator.mediaDevices?.getDisplayMedia)throw Error('Захват звука недоступен. Используйте HTTPS или localhost.');
      acquired=await navigator.mediaDevices.getDisplayMedia({video:true,audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
      if(!acquired.getAudioTracks().length)throw Error('Выберите вкладку и включите «Передавать звук».');
      await bindStream(acquired,true,request);
    }catch(error){if(acquired&&stream!==acquired)acquired.getTracks().forEach(t=>t.stop());if(request===sourceRequest)toast('Захват: '+String(error.message||error).slice(0,150))}
  }
  async function startMic(){
    const request=++sourceRequest;let acquired=null;
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw Error('Микрофон недоступен. Используйте HTTPS или localhost.');
      acquired=await navigator.mediaDevices.getUserMedia({audio:{channelCount:{ideal:2},echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
      await bindStream(acquired,false,request);
    }catch(error){if(acquired&&stream!==acquired)acquired.getTracks().forEach(t=>t.stop());if(request===sourceRequest)toast('Микрофон: '+String(error.message||error).slice(0,150))}
  }
  function setIdle(){++sourceRequest;disconnect()}
  async function setDemo(){
    const request=++sourceRequest;
    try{
      const ac=await ensureAudio();if(request!==sourceRequest)return;
      disconnect();
      const buffer=ac.createBuffer(2,ac.sampleRate*4,ac.sampleRate);
      // Actual test samples: multitone + low-level filtered noise. No invented FFT bars.
      for(let ch=0;ch<2;ch++){
        const pcm=buffer.getChannelData(ch);let seed=12345+ch,noise=0;
        for(let j=0;j<pcm.length;j++){
          const t=j/ac.sampleRate;seed=(Math.imul(1664525,seed)+1013904223)>>>0;
          noise=.97*noise+.03*(seed/4294967296*2-1);
          const pulse=.45+.55*Math.pow(.5+.5*Math.sin(TAU*.5*t+ch*.3),4);
          pcm[j]=.45*(pulse*(.31*Math.sin(TAU*63*t)+.17*Math.sin(TAU*250*t+ch*.5))+.12*Math.sin(TAU*1000*t)+.055*Math.sin(TAU*4000*t)*(.55+.45*Math.sin(TAU*.25*t))+.015*Math.sin(TAU*12500*t)+noise*.15);
        }
      }
      const src=ac.createBufferSource();src.buffer=buffer;src.loop=true;bindSplitter(src);src.start();sourceMode='demo';updateSourceUI();
      toast('DEMO: измеряется тестовый PCM-сигнал · звук не воспроизводится');
    }catch(error){if(request===sourceRequest){disconnect();toast('DEMO: '+String(error.message||error).slice(0,130))}}
  }
  $('demo').addEventListener('click',setDemo);$('stop').addEventListener('click',setIdle);$('system').addEventListener('click',startSystemAudio);$('mic').addEventListener('click',startMic);
  $('file').addEventListener('click',()=>$('file-input').click());
  $('file-input').addEventListener('change',async e=>{
    const f=e.target.files?.[0];if(!f)return;const request=++sourceRequest;
    try{
      const ac=await ensureAudio();if(request!==sourceRequest)return;disconnect();
      if(playingUrl)URL.revokeObjectURL(playingUrl);playingUrl=URL.createObjectURL(f);
      const p=$('player');p.src=playingUrl;
      if(!playerSource)playerSource=ac.createMediaElementSource(p);
      bindSplitter(playerSource,true);await p.play();
      if(request!==sourceRequest)return;
      sourceMode='file';updateSourceUI();toast('Воспроизводится: '+f.name);
    }catch(error){if(request===sourceRequest){disconnect();toast('Ошибка аудиофайла: '+String(error.message||error).slice(0,130))}}
    finally{e.target.value=''}
  });
  $('player').addEventListener('error',()=>{if(sourceMode==='file'){setIdle();toast('Браузер не смог декодировать аудиофайл')}});
  $('response').addEventListener('change',()=>spectrumEngine.configure(responseOptions()));
  $('reference').addEventListener('change',()=>{spectrumDisplay.reference=Number($('reference').value)});
  $('hold').addEventListener('click',()=>setHold(!held));
  $('reset-peaks').addEventListener('click',()=>{spectrumEngine.resetPeaks();if(held)setHold(true)});
  function meterPosition(rms){
    if(rms<1e-8)return 0;
    // Nominal 0 VU is a full-scale-sine-referenced digital level of −18 dBFS.
    const db=20*Math.log10(rms*Math.SQRT2)+18;
    const marks=[[-20,0],[-10,.18],[-7,.29],[-5,.40],[-3,.51],[-1,.61],[0,.70],[3,.82],[6,1]];
    if(db<=-20)return 0;if(db>=6)return 1;
    for(let i=1;i<marks.length;i++)if(db<=marks[i][0])return lerp(marks[i-1][1],marks[i][1],(db-marks[i-1][0])/(marks[i][0]-marks[i-1][0]));
  }
  function updateLive(dt){
    if(analysers){
      analysers[0].getFloatTimeDomainData(timeL);analysers[1].getFloatTimeDomainData(timeR);
      analysers[0].getFloatFrequencyData(freqL);analysers[1].getFloatFrequencyData(freqR);
      spectrumEngine.update(freqL,freqR,dt);
      let energyL=0,energyR=0,peakL=0,peakR=0;
      for(let i=0;i<wavSize;i++){
        const l=timeL[FFT-wavSize+i],r=timeR[FFT-wavSize+i];leftWave[i]=l;rightWave[i]=r;
        energyL+=l*l;energyR+=r*r;peakL=Math.max(peakL,Math.abs(l));peakR=Math.max(peakR,Math.abs(r));
      }
      const alpha=1-Math.exp(-dt/.065);
      rmsLevels[0]=lerp(rmsLevels[0],energyL/wavSize,alpha);rmsLevels[1]=lerp(rmsLevels[1],energyR/wavSize,alpha);
      levels[0]=meterPosition(Math.sqrt(rmsLevels[0]));levels[1]=meterPosition(Math.sqrt(rmsLevels[1]));
      const peaks=[peakL,peakR];
      for(let ch=0;ch<2;ch++)samplePeaks[ch]=Math.max(peaks[ch]>1e-8?20*Math.log10(peaks[ch]):-Infinity,samplePeaks[ch]-dt*24);
      clipSeconds=Math.max(peakL>=.999||peakR>=.999?1:0,clipSeconds-dt);
      for(let i=0;i<bands;i++)audioBands[i]=clamp((spectrumEngine.db[i]+90)/90);
    }
    readoutElapsed+=dt;
    if(readoutElapsed>=.1){readoutElapsed=0;updateReadouts()}
    return {left:levels[0],right:levels[1],bands:audioBands,waveL:leftWave,waveR:rightWave,energy:(levels[0]+levels[1])*.5,dt,sampleRate:audioContext?.sampleRate||48000,sourceActive:sourceMode!=='idle',sourceVersion:`${sourceMode}:${sourceRequest}`};
  }
  function updateReadouts(){
    $('display-state').textContent=held?'HOLD':sourceMode==='idle'?'NO SIGNAL':sourceMode==='demo'?'TEST SIGNAL':'RUN';
    if(held)return;
    let iMax=0;for(let i=1;i<bands;i++)if(spectrumEngine.db[i]>spectrumEngine.db[iMax])iMax=i;
    const db=spectrumEngine.db[iMax],hasSignal=sourceMode!=='idle'&&db>-120;
    $('frequency-readout').textContent=hasSignal?`${Math.round(spectrumEngine.centers[iMax])} Hz`:'— Hz';
    $('band-readout').textContent=hasSignal?`${db.toFixed(1).replace('-','−')} dBFS`:'−∞ dBFS';
    for(const [i,id] of ['left-readout','right-readout'].entries())$(id).textContent=samplePeaks[i]>-120?samplePeaks[i].toFixed(1).replace('-','−'):'−∞';
    $('overload').classList.toggle('active',clipSeconds>0);
  }

  // Physical instrument scenes share the same measured frame as SA-64.
  // No painted-in pointers or labels can disagree with the current sample rate.
  function sizeCanvas(canvas){
    const r=canvas.getBoundingClientRect(),d=Math.min(2,window.devicePixelRatio||1);
    const w=Math.max(2,Math.round(r.width*d)),h=Math.max(2,Math.round(r.height*d));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
    return {w,h};
  }
  const primaryScenes=[
    ['primary-blue','hardware','vu',{sk:'blue',bg:'dark',title:'BLUE STUDIO',primary:true,id:0}],
    ['primary-gold','hardware','vu',{sk:'cream',bg:'dark',title:'VINTAGE GOLD',primary:true,id:1}],
    ['primary-copper','hardware','vu',{sk:'copper',bg:'wood',title:'COPPER VALVE',primary:true,id:2}],
    ['waterfall','electronic','mount',{h:150,n:64,bg:'dark',title:'SPECTRAL WATERFALL',primary:true,id:3}],
    ['scope','electronic','osc',{h:150,liss:false,bg:'dark',title:'DUAL CHANNEL OSCILLOSCOPE',primary:true,id:4}]
  ].map(([id,renderer,family,options])=>({canvas:$(id),ctx:$(id).getContext('2d',{alpha:false}),renderer,family,options,state:{}}));
  const extraCanvas=$('extra'),extraContext=extraCanvas.getContext('2d',{alpha:false});
  let lastPaint=0,paintElapsed=0;
  function frameLoop(now){
    const dt=lastFrame?Math.max(0,(now-lastFrame)*.001):.016;lastFrame=now;
    const frame=updateLive(dt);paintElapsed+=dt;
    // The renderer receives the time since its last paint (30 Hz target), while
    // spectrum measurement runs at animation cadence. Neither depends on FPS.
    if(now-lastPaint>=1000/30){
      lastPaint=now;frame.dt=paintElapsed;paintElapsed=0;
      if(mode===5){spectrumDisplay.draw(held?frozenSpectrum:spectrumEngine,{idle:sourceMode==='idle',hold:held})}
      else if(mode<5){
        const scene=primaryScenes[mode],{w,h}=sizeCanvas(scene.canvas);
        const renderer=scene.renderer==='hardware'?window.AVHardware:window.AVElectronic;
        scene.ctx.save();renderer.draw(scene.family,scene.ctx,w,h,frame,now*.001,scene.options,scene.state);scene.ctx.restore();
      }else{
        const {w,h}=sizeCanvas(extraCanvas);
        window.AVModes[modes[mode].idx].draw(extraContext,w,h,frame,now*.001);
      }
    }
    requestAnimationFrame(frameLoop);
  }
  setMode(5);updateSourceUI();requestAnimationFrame(frameLoop);
  // Test hook for deterministic browser integration; no JS internals exposed to Electron.
  window.AVProDiagnostics={getMode:()=>mode,getLevels:()=>levels.slice(),getSource:()=>sourceMode,setMode,getSpectrum:()=>({db:Array.from(spectrumEngine.db),peaks:Array.from(spectrumEngine.peaks),centers:Array.from(spectrumEngine.centers),binWidth:spectrumEngine.binWidth,sampleRate:spectrumEngine.sampleRate,rawPower:Array.from(spectrumEngine.rawPower),samplePeaks:samplePeaks.slice(),held})};
})();
