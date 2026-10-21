/* ファイル圧縮君 — © 2026 Takakura Kentaro. See LICENSE. */
(() => {
  'use strict';
  // Capture the initial document before filenames, results or blob URLs enter the UI.
  const originalHTML = '<!doctype html>\n' + document.documentElement.outerHTML;
  const $ = id => document.getElementById(id);
  const MAX_FILE = 300 * 1024 ** 2, MAX_TOTAL = 600 * 1024 ** 2;
  let files = [], results = [], sequence = 0, busy = false, controller = null, context = null;
  let workerURL = null, assets = null, resultMode = 'shrink';
  const names = {image:'画像',pdf:'PDF',video:'動画',audio:'音声',other:'その他'};
  const extOf = name => (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
  const stemOf = name => name.replace(/\.[^.]+$/, '') || 'ファイル';
  function safeName(name, fallback = 'ファイル') {
    const clean = String(name).normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_').trim().replace(/[. ]+$/, '').slice(0, 120);
    const value = clean || fallback;
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) ? '_' + value : value;
  }
  const size = bytes => bytes >= 1024 ** 2 ? (bytes / 1024 ** 2).toFixed(2) + ' MB' : bytes >= 1024 ? (bytes / 1024).toFixed(1) + ' KB' : bytes + ' B';
  const reduction = (before,after) => before ? Math.round((1-after/before)*1000)/10 : 0;
  const tick = () => new Promise(r => setTimeout(r, 0));
  function abortError() { return new DOMException('処理を中止しました。', 'AbortError'); }
  function check(signal) { if (signal?.aborted) throw abortError(); }
  function notice(message) { $('notice').textContent = message; $('notice').hidden = !message; }
  function kind(file) {
    const ext = extOf(file.name);
    if (ext === 'pdf' || file.type === 'application/pdf') return 'pdf';
    if (/^(jpe?g|png|webp|bmp|gif|avif|heic|heif|tiff?)$/.test(ext) || /^image\/(?!svg)/.test(file.type)) return 'image';
    if (/^(mp4|m4v|mov|webm|avi|mkv|3gp)$/.test(ext) || file.type.startsWith('video/')) return 'video';
    if (/^(mp3|m4a|aac|wav|ogg|oga|opus|flac|aiff?)$/.test(ext) || file.type.startsWith('audio/')) return 'audio';
    return 'other';
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function addFiles(list) {
    if (busy) return;
    const warnings = [];
    let total = files.reduce((n,x) => n+x.file.size, 0);
    for (const file of list) {
      if (!file.size) { warnings.push(file.name + '：空のファイルは対象外です。'); continue; }
      if (file.size > MAX_FILE) { warnings.push(file.name + '：300MBを超えています。'); continue; }
      if (files.length >= 100 || total+file.size > MAX_TOTAL) { warnings.push('件数または合計容量の上限に達しました。'); break; }
      if (files.some(x => x.file.name===file.name && x.file.size===file.size && x.file.lastModified===file.lastModified)) continue;
      files.push({id:++sequence,file,kind:kind(file)}); total += file.size;
    }
    notice(warnings.join('\n'));
    renderQueue();
    $('files').value = '';
  }
  function renderQueue() {
    $('queue').replaceChildren();
    for (const item of files) {
      const li = element('li');
      li.append(element('span','file-badge',item.kind==='other'?'ZIP':names[item.kind]));
      const info = element('div','file-info');
      info.append(element('div','file-name',item.file.name),element('div','file-meta',size(item.file.size)));
      const remove = element('button','remove','×'); remove.type='button'; remove.disabled=busy;
      remove.setAttribute('aria-label',item.file.name+'を外す');
      remove.onclick = () => { files=files.filter(x=>x.id!==item.id); renderQueue(); };
      li.append(info,remove); $('queue').append(li);
    }
    $('queue-head').hidden = !files.length;
    $('queue-summary').textContent=files.length+'ファイル · '+size(files.reduce((n,x)=>n+x.file.size,0));
    $('start').disabled=busy || !files.length;
    $('ready-text').textContent=files.length ? files.length+'ファイルを順番に処理します' : 'ファイルを選ぶと始められます';
  }
  function settings() {
    const strength = +$('strength').value, t=(strength-10)/80;
    return {
      mode:document.querySelector('input[name=mode]:checked').value,
      strength, quality:.94-.54*t,
      imageSize:$('image-size').value==='auto' ? Math.round(3200-1920*t) : +$('image-size').value,
      imageFormat:$('image-format').value,
      pdfMode:$('pdf-mode').value, dpi:Math.round(180-100*t),
      videoSize:$('video-size').value==='auto' ? (strength<35?1920:strength<70?1280:854) : +$('video-size').value,
      fps:strength>=75?24:30,
      audioBits:(strength<35?192:strength<70?128:64)*1000,
      zipLevel:Math.max(1,Math.min(9,Math.round(strength/10))),
      suffix:safeName($('suffix').value,'').slice(0,40), keep:$('keep-smaller').checked
    };
  }
  function updateSettings() {
    const s=settings();
    const label=s.strength<35?'画質優先':s.strength<70?'バランス':'小さく';
    $('strength-value').textContent=label+' · '+s.strength;
    document.querySelectorAll('[data-strength]').forEach(b=>b.classList.toggle('active',+b.dataset.strength===s.strength));
    $('shrink-settings').hidden=s.mode==='zip';
    $('pdf-warning').hidden=s.pdfMode!=='raster';
    const rangeLabels=document.querySelectorAll('.range-labels span');
    rangeLabels[0].textContent=s.mode==='zip'?'処理速度を優先':'画質を優先';rangeLabels[1].textContent=s.mode==='zip'?'圧縮を優先':'小ささを優先';
    $('settings-summary').textContent=s.mode==='zip' ? '元の内容を変えずにZIP化。圧縮の強さはZIPの圧縮レベルに反映されます。すでに圧縮済みのファイルでは、容量が少し増える場合もあります。' :
      '画像：'+(s.imageFormat==='image/png'?'PNG（サイズ縮小のみ）':'画質 '+Math.round(s.quality*100)+'%')+' / 長辺 '+(s.imageSize?s.imageSize+' pxまで':'そのまま')+'　·　PDF：'+(s.pdfMode==='keep'?'文字・リンク保持（強さの設定は影響しません）':s.dpi+' dpiで画像化')+'　·　動画：長辺 '+s.videoSize+' px / '+s.fps+' fpsまで　·　音声：'+s.audioBits/1000+' kbps';
    $('start').textContent=s.mode==='zip'?'元ファイルをZIPにまとめる':'まとめて圧縮する';
    if(results.length && !busy) $('ready-text').textContent='設定を変えたら、もう一度圧縮してください';
  }
  function progress(text, value) {
    $('progress-text').textContent=text;
    $('progress').value=Math.min(100,Math.max(0,value));
    $('progress-percent').textContent=Math.round($('progress').value)+'%';
  }
  function setBusy(value) {
    busy=value;
    $('settings').disabled=value;
    for(const id of ['pick','clear','files']) $(id).disabled=value;
    $('cancel').hidden=!value;
    $('save-zip').disabled=value || !results.some(r=>r.blob);
    document.querySelectorAll('.result button,.result input,#zip-name').forEach(n=>n.disabled=value);
    renderQueue();
  }
  async function toBlob(canvas,type,quality) {
    const blob = await new Promise(resolve=>canvas.toBlob(resolve,type,quality));
    if(!blob) throw new Error('画像を書き出せませんでした。');
    if(blob.type!==type) throw new Error('このブラウザは選択した画像形式での保存に対応していません。JPEGかPNGを選んでください。');
    return blob;
  }
  async function compressImage(file,s,signal,report) {
    report('画像を読み込み中',0);
    const url=URL.createObjectURL(file), image=new Image();
    try {
      await eventLoad(image,'load',signal,()=>{image.src=url;});
      check(signal);
      const scale=Math.min(1,s.imageSize ? s.imageSize/Math.max(image.naturalWidth,image.naturalHeight) : 1);
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale)); canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      if(canvas.width*canvas.height>24000000) throw new Error('画像が大きすぎます。長辺の上限を小さくしてください。');
      const ctx=canvas.getContext('2d');
      if(s.imageFormat==='image/jpeg') {ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);}
      ctx.drawImage(image,0,0,canvas.width,canvas.height);
      report('画像を書き出し中',.7); await tick(); check(signal);
      const blob=await toBlob(canvas,s.imageFormat,s.quality);
      canvas.width=canvas.height=1;
      return {blob,ext:({'image/jpeg':'jpg','image/webp':'webp','image/png':'png'})[s.imageFormat],note:'画像を再生成（アニメーションは静止画・付加情報は引き継ぎません）'};
    } finally {URL.revokeObjectURL(url);image.src='';}
  }
  function decode64(s) {
    const str=atob(s), out=new Uint8Array(str.length);
    for(let i=0;i<str.length;i++) out[i]=str.charCodeAt(i);
    return out;
  }
  function pdfOptions() {
    if(!assets) assets=fflate.unzipSync(decode64(EMBEDDED.pdfAssets));
    if(!workerURL) {
      workerURL=URL.createObjectURL(new Blob([decode64(EMBEDDED.pdfWorker)],{type:'text/javascript'}));
      pdfjsLib.GlobalWorkerOptions.workerSrc=workerURL;
    }
    class BinaryDataFactory {
      async fetch({kind,filename}) {
        const category=kind==='cMapUrl'?'cmaps':kind==='standardFontDataUrl'?'standard_fonts':'wasm';
        const value=assets[category+'/'+filename];
        if(!value) throw new Error('同梱されていないPDFデータ：'+filename);
        return value.slice();
      }
    }
    return {BinaryDataFactory,useWorkerFetch:false,isEvalSupported:false,stopAtErrors:true,verbosity:0,
      cMapPacked:true,disableAutoFetch:true,isImageDecoderSupported:false,isOffscreenCanvasSupported:false,maxImageSize:32000000};
  }
  async function compressPDF(file,s,signal,report) {
    report('PDFを読み込み中',0);
    const bytes=new Uint8Array(await file.arrayBuffer()); check(signal);
    if(s.pdfMode==='keep') {
      let doc;
      try {doc=await PDFLib.PDFDocument.load(bytes,{updateMetadata:false});}
      catch(e) {throw new Error(/encrypt|password/i.test(String(e))?'暗号化・パスワード付きPDFには対応していません。':'PDFを開けませんでした。破損や形式を確認してください。');}
      check(signal); report('文字・リンクを保持して再保存中',.5);
      const output=await doc.save({useObjectStreams:true,objectsPerTick:20,updateFieldAppearances:false});
      check(signal);
      return {blob:new Blob([output],{type:'application/pdf'}),ext:'pdf',note:'文字・リンクを保持して再保存（画像の画質は変更しません）'};
    }
    const task=pdfjsLib.getDocument({data:bytes,...pdfOptions()});
    task.onPassword=()=>task.destroy();
    const onAbort=()=>{task.destroy().catch(()=>{});};signal.addEventListener('abort',onAbort,{once:true});
    let pdf;
    try {
      try {pdf=await task.promise;} catch(e) {check(signal);throw new Error('PDFを表示できませんでした。暗号化・パスワード付きPDFは対象外です。');}
      const output=await PDFLib.PDFDocument.create();
      for(let n=1;n<=pdf.numPages;n++) {
        check(signal); report('PDF '+n+' / '+pdf.numPages+'ページ', (n-1)/pdf.numPages);
        const page=await pdf.getPage(n), base=page.getViewport({scale:1});
        const scale=Math.min(s.dpi/72,Math.sqrt(12000000/(base.width*base.height)));
        const viewport=page.getViewport({scale});
        const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        const render=page.render({canvasContext:canvas.getContext('2d'),viewport,background:'#ffffff'});
        const stopRender=()=>render.cancel();signal.addEventListener('abort',stopRender,{once:true});
        try {await render.promise;} finally {signal.removeEventListener('abort',stopRender);}
        check(signal);
        const jpeg=await toBlob(canvas,'image/jpeg',s.quality);
        const embedded=await output.embedJpg(await jpeg.arrayBuffer());
        const dest=output.addPage([base.width,base.height]);
        dest.drawImage(embedded,{x:0,y:0,width:base.width,height:base.height});
        canvas.width=canvas.height=1;page.cleanup();await tick();
      }
      check(signal);
      return {blob:new Blob([await output.save()],{type:'application/pdf'}),ext:'pdf',note:'ページを画像化（文字検索・リンクなどは引き継ぎません）'};
    } finally {signal.removeEventListener('abort',onAbort);await task.destroy().catch(()=>{});}
  }
  function eventLoad(target,event,signal,action,timeout=30000) {
    return new Promise((resolve,reject)=>{
      let timer;
      const cleanup=()=>{clearTimeout(timer);target.removeEventListener(event,ok);target.removeEventListener('error',fail);signal.removeEventListener('abort',abort);};
      const ok=()=>{cleanup();resolve();};
      const fail=()=>{cleanup();reject(new Error('このブラウザではファイルを読み込めません。対応形式・破損を確認してください。'));};
      const abort=()=>{cleanup();reject(abortError());};
      target.addEventListener(event,ok,{once:true});target.addEventListener('error',fail,{once:true});signal.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>{cleanup();reject(new Error('読み込みがタイムアウトしました。別の形式や小さなファイルで試してください。'));},timeout);
      try {check(signal);action();} catch(e){cleanup();reject(e);}
    });
  }
  function supportedMIME(video) {
    if(!window.MediaRecorder) return null;
    const types=video ? ['video/mp4;codecs=avc1.42001E,mp4a.40.2','video/webm;codecs=vp8,opus','video/webm','video/mp4'] : ['audio/mp4;codecs=mp4a.40.2','audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/webm','audio/mp4'];
    return types.find(t=>MediaRecorder.isTypeSupported(t)) || null;
  }
  async function primePlayback(media,signal) {
    try {await media.play();}
    catch(e) {
      if(e.name!=='NotAllowedError') throw new Error('ファイルを再生できません。ブラウザが対応する形式か確認してください。');
      await new Promise((resolve,reject)=>{
        const b=element('button','primary','タップして動画・音声の変換を開始');b.type='button';$('media-host').append(b);
        const abort=()=>{b.remove();reject(abortError());};signal.addEventListener('abort',abort,{once:true});
        b.onclick=async()=>{try{await context.resume();await media.play();signal.removeEventListener('abort',abort);b.remove();resolve();}catch(err){signal.removeEventListener('abort',abort);b.remove();reject(new Error('再生を開始できませんでした。'));}};
      });
    }
    media.pause();
    if(media.currentTime>0) await eventLoad(media,'seeked',signal,()=>{media.currentTime=0;});
    check(signal);
  }
  async function compressMedia(file,s,signal,report,isVideo) {
    const mime=supportedMIME(isVideo);
    if(!mime || !context || (isVideo && !HTMLCanvasElement.prototype.captureStream)) throw new Error('このブラウザは動画・音声変換に対応していません。ZIPモードを使うか、対応ブラウザで開いてください。');
    const media=document.createElement(isVideo?'video':'audio'), url=URL.createObjectURL(file);
    media.preload='auto';media.playsInline=true;media.controls=false;
    const canvas=$('video-canvas');canvas.hidden=!isVideo;
    $('media-stage').hidden=false;$('media-host').replaceChildren(media);
    let source,destination,silent,stream,recorder,raf=0;
    try {
      report('動画・音声を読み込み中',0);
      await eventLoad(media,'loadeddata',signal,()=>{media.src=url;media.load();});
      if(!Number.isFinite(media.duration) || media.duration<=0) throw new Error('再生時間を取得できませんでした。別の形式で試してください。');
      source=context.createMediaElementSource(media);destination=context.createMediaStreamDestination();
      source.connect(destination);silent=context.createGain();silent.gain.value=0;source.connect(silent);silent.connect(context.destination);
      await primePlayback(media,signal);
      if(context.state!=='running') await context.resume();
      const tracks=[...destination.stream.getAudioTracks()];
      let videoBits;
      if(isVideo) {
        if(!media.videoWidth || !media.videoHeight) throw new Error('映像を読み込めません。音声ファイルの場合は拡張子を確認してください。');
        const scale=Math.min(1,s.videoSize/Math.max(media.videoWidth,media.videoHeight));
        canvas.width=Math.max(2,Math.floor(media.videoWidth*scale/2)*2);canvas.height=Math.max(2,Math.floor(media.videoHeight*scale/2)*2);
        const ctx=canvas.getContext('2d',{alpha:false});ctx.drawImage(media,0,0,canvas.width,canvas.height);
        const videoStream=canvas.captureStream(s.fps);tracks.push(...videoStream.getVideoTracks());
        const draw=()=>{if(media.readyState>=2)ctx.drawImage(media,0,0,canvas.width,canvas.height);raf=requestAnimationFrame(draw);};draw();
        videoBits=Math.round(Math.min(10000000,Math.max(180000,canvas.width*canvas.height*s.fps*(.12-.08*(s.strength-10)/80))));
      }
      stream=new MediaStream(tracks);
      try {recorder=new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:s.audioBits,...(isVideo?{videoBitsPerSecond:videoBits}:{})});}
      catch(e) {throw new Error('この端末では指定の形式で変換を開始できませんでした。ZIPモードを使うか、別のブラウザで試してください。');}
      const chunks=[];
      await new Promise((resolve,reject)=>{
        let settled=false,error=null,lastTime=0,stalledAt=Date.now();
        const finish=()=>{if(settled)return;settled=true;cleanup();error?reject(error):resolve();};
        const stop=err=>{if(settled || error)return;error=err;if(recorder.state!=='inactive'){try{recorder.stop();}catch(e){finish();}}else finish();};
        const abort=()=>stop(abortError());
        const fail=()=>stop(new Error('再生または変換中にエラーが起きました。別の形式で試してください。'));
        const hidden=()=>{if(document.hidden)stop(new Error('画面が背景に移ったため変換を中止しました。この画面を開いたまま再実行してください。'));};
        const ended=()=>{if(recorder.state!=='inactive')recorder.stop();};
        const monitor=setInterval(()=>{
          if(media.currentTime>lastTime+.01){lastTime=media.currentTime;stalledAt=Date.now();}
          if(Date.now()-stalledAt>30000)stop(new Error('再生が停止しました。画面を開いたまま再実行してください。'));
          report('変換中 '+Math.floor(media.currentTime)+' / '+Math.ceil(media.duration)+'秒',Math.min(.99,media.currentTime/media.duration));
        },300);
        const cleanup=()=>{clearInterval(monitor);signal.removeEventListener('abort',abort);media.removeEventListener('error',fail);media.removeEventListener('ended',ended);document.removeEventListener('visibilitychange',hidden);};
        recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onstop=finish;recorder.onerror=fail;
        signal.addEventListener('abort',abort,{once:true});media.addEventListener('error',fail);media.addEventListener('ended',ended);document.addEventListener('visibilitychange',hidden);
        try {check(signal);recorder.start(500);media.play().catch(fail);}catch(e){stop(e);}
      });
      check(signal);
      const type=recorder.mimeType || mime;
      let blob=new Blob(chunks,{type});
      if(type.includes('webm')) {
        report('再生時間の情報を整えています',.99);
        blob=await ysFixWebmDuration(blob,media.duration*1000,{logger:false});check(signal);
      }
      if(!blob.size) throw new Error('空のファイルが生成されました。別の形式で試してください。');
      const ext=type.includes('mp4')?(isVideo?'mp4':'m4a'):type.includes('ogg')?'ogg':'webm';
      return {blob,ext,note:isVideo?'動画を再エンコード（字幕・複数音声・HDRは保持しません）':'音声を再エンコード（曲名・ジャケット画像などは引き継ぎません）'};
    } finally {
      cancelAnimationFrame(raf);media.pause();source?.disconnect();silent?.disconnect();destination?.disconnect();
      stream?.getTracks().forEach(t=>t.stop());destination?.stream.getTracks().forEach(t=>t.stop());
      if(recorder?.state==='recording' || recorder?.state==='paused')recorder.stop();
      media.removeAttribute('src');media.load();URL.revokeObjectURL(url);$('media-host').replaceChildren();$('media-stage').hidden=true;canvas.width=canvas.height=1;
    }
  }
  async function start() {
    if(busy || !files.length) return;
    const s=settings();controller=new AbortController();const signal=controller.signal;
    // Start/resume the audio context within the button's user activation.
    if(s.mode==='shrink' && files.some(x=>x.kind==='video'||x.kind==='audio')) {
      const AC=window.AudioContext || window.webkitAudioContext;
      if(AC) {try{context=new AC();context.resume().catch(()=>{});}catch(e){context=null;}}
    }
    results=[];resultMode=s.mode;$('results').replaceChildren();$('results-area').hidden=true;$('progress-area').hidden=false;notice('');setBusy(true);
    let cancelled=false;
    try {
      if(s.mode==='zip') {
        for(const item of files) results.push({...item,blob:item.file,ext:extOf(item.file.name),base:stemOf(item.file.name),note:'元ファイルを変更せず保存'});
        progress('元ファイルをZIPにまとめています',0);
        renderResults();
        const blob=await zipResults(s.zipLevel,signal,(p)=>progress('ZIPを作成中',p));
        check(signal);
        // Browser save pickers need a fresh user gesture; always offer the ready ZIP.
        $('zip-status').textContent='ZIP全体：'+size(blob.size)+'。保存ボタンを押してください。';
        cachedZip={blob,signature:zipSignature(),level:s.zipLevel};
        $('save-zip').textContent='ZIPを保存';
        progress('ZIPの準備ができました',100);
      } else {
        for(let i=0;i<files.length;i++) {
          const item=files[i];check(signal);
          const report=(label,p)=>progress((i+1)+' / '+files.length+' · '+item.file.name+' · '+label,100*(i+p)/files.length);
          try {
            let result;
            if(item.kind==='image') result=await compressImage(item.file,s,signal,report);
            else if(item.kind==='pdf') result=await compressPDF(item.file,s,signal,report);
            else if(item.kind==='video'||item.kind==='audio') result=await compressMedia(item.file,s,signal,report,item.kind==='video');
            else throw new Error('この種類は軽量化に対応していません。「元ファイルをZIPに」を使ってください。');
            check(signal);
            if(s.keep && result.blob.size>=item.file.size) result={blob:item.file,ext:extOf(item.file.name),note:'小さくならなかったため元ファイルを使用',unchanged:true};
            results.push({...item,...result,base:safeName(stemOf(item.file.name)+s.suffix)});
          } catch(e) {
            if(signal.aborted || e.name==='AbortError') throw abortError();
            results.push({...item,error:e.message || '処理できませんでした。'});
          }
          renderResults();await tick();
        }
        progress('処理が終わりました。結果を確認して保存してください。',100);
      }
    } catch(e) {
      cancelled=signal.aborted || e.name==='AbortError';
      progress(cancelled?'中止しました。完了したファイルは保存できます。':'処理を続けられませんでした。', $('progress').value);
      if(!cancelled)notice(e.message || '処理中にエラーが起きました。');
    } finally {
      if(context){await context.close().catch(()=>{});context=null;}
      controller=null;setBusy(false);renderResults();
      const success=results.filter(r=>r.blob).length;
      $('ready-text').textContent=(cancelled?'中止 · ':'')+success+'件が保存できます'+(results.some(r=>r.error)?'（エラーの内容も確認してください）':'');
    }
  }
  function renderResults() {
    $('results-area').hidden=!results.length;$('results').replaceChildren();
    const ok=results.filter(x=>x.blob);$('result-count').textContent=ok.length+'件成功 / '+results.filter(x=>x.error).length+'件エラー';
    renderTotals();
    for(const r of results) {
      const li=element('li','result'+(r.error?' error':'')),top=element('div','result-top'),info=element('div','file-info');
      info.append(element('div','file-name',r.file.name));
      info.append(element('div','file-meta',r.error?r.error:size(r.file.size)+' → '+size(r.blob.size)+' · '+r.note));
      top.append(element('span','file-badge',names[r.kind]),info,element('span','result-status',r.error?'エラー':r.unchanged?'元のまま':reduction(r.file.size,r.blob.size)>0?reduction(r.file.size,r.blob.size)+'% 削減':'準備完了'));
      li.append(top);
      if(r.blob) {
        const row=element('div','rename-row'),input=element('input');input.type='text';input.value=r.base;input.maxLength=120;input.disabled=busy;input.setAttribute('aria-label',r.file.name+'の保存名');
        input.oninput=()=>{r.base=input.value;cachedZip=null;$('zip-status').textContent='';$('save-zip').textContent='まとめてZIPを作成';renderTotals();};
        const save=element('button','secondary','個別保存');save.type='button';save.disabled=busy;
        save.onclick=()=>saveBlob(r.blob,outputName(r)).catch(e=>notice(e.message));
        row.append(input,element('span','ext',r.ext?'.'+r.ext:''),save);li.append(row);
      }
      $('results').append(li);
    }
    $('save-zip').disabled=busy || !ok.length;
  }
  function renderTotals() {
    const ok=results.filter(r=>r.blob),before=ok.reduce((n,x)=>n+x.file.size,0);
    const ready=resultMode!=='zip' || cachedZip?.signature===zipSignature();
    const after=resultMode==='zip' && ready?cachedZip.blob.size:ok.reduce((n,x)=>n+x.blob.size,0),diff=before-after;
    $('totals').replaceChildren();
    const cell=(label,value,cls='')=>{const div=element('div',cls);div.append(element('div','total-label',label),element('div','total-value',value));return div;};
    $('totals').append(cell('元の合計',size(before)),element('span','quiet','→'),cell(resultMode==='zip'?'ZIP全体':'処理後のファイル合計',ready?size(after):'未作成'),cell(ready?(diff>=0?'削減できた容量':'増えた容量'):'ZIP作成後に表示',ready?size(Math.abs(diff))+' · '+Math.abs(reduction(before,after))+'%':'—','saved-cell'));
  }
  function outputName(r) {return safeName(r.base)+(r.ext?'.'+safeName(r.ext):'');}
  let cachedZip=null;
  function zipSignature() {return results.filter(r=>r.blob).map(r=>r.id+':'+outputName(r)+':'+r.blob.size).join('|');}
  async function zipResults(level,signal,report=()=>{}) {
    const good=results.filter(r=>r.blob), used=new Set(), entries=[];
    for(let i=0;i<good.length;i++) {
      check(signal);const r=good[i];let name=outputName(r),n=2;
      while(used.has(name.toLowerCase())) {name=safeName(r.base)+' ('+n+')'+(r.ext?'.'+r.ext:'');n++;}
      used.add(name.toLowerCase());
      entries.push({name,bytes:new Uint8Array(await r.blob.arrayBuffer())});report(Math.round(70*(i+1)/good.length));
    }
    check(signal);
    const url=URL.createObjectURL(new Blob([decode64(EMBEDDED.zipWorker)],{type:'text/javascript'}));
    let worker;
    try {
      worker=new Worker(url);
      const bytes=await new Promise((resolve,reject)=>{
        const abort=()=>{worker.terminate();reject(abortError());};signal?.addEventListener('abort',abort,{once:true});
        const cleanup=()=>signal?.removeEventListener('abort',abort);
        worker.onmessage=e=>{cleanup();e.data.error?reject(new Error(e.data.error)):resolve(e.data.bytes);};
        worker.onerror=()=>{cleanup();reject(new Error('ZIPを作れませんでした。個別保存か、ファイル数を減らして試してください。'));};
        worker.postMessage({entries,level},entries.map(e=>e.bytes.buffer));
      });
      report(100);return new Blob([bytes],{type:'application/zip'});
    } finally {worker?.terminate();URL.revokeObjectURL(url);}
  }
  async function saveBlob(blob,name) {
    if(window.showSaveFilePicker) {
      try {
        const handle=await window.showSaveFilePicker({suggestedName:name});
        const writer=await handle.createWritable();await writer.write(blob);await writer.close();return;
      } catch(e) {if(e.name==='AbortError')return;if(!['SecurityError','NotAllowedError','TypeError'].includes(e.name))throw new Error('保存できませんでした。保存先や空き容量を確認してください。');}
    }
    const url=URL.createObjectURL(blob),a=element('a');a.href=url;a.download=name;a.rel='noopener';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  $('pick').onclick=()=>$('files').click();$('files').onchange=e=>addFiles(e.target.files);
  $('clear').onclick=()=>{if(busy)return;files=[];notice('');renderQueue();};
  let dragDepth=0;
  document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('drop',e=>e.preventDefault());
  $('dropzone').addEventListener('dragenter',e=>{e.preventDefault();dragDepth++;if(!busy)$('dropzone').classList.add('drag');});
  $('dropzone').addEventListener('dragleave',()=>{dragDepth--;if(dragDepth<=0)$('dropzone').classList.remove('drag');});
  $('dropzone').addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('dropzone').classList.remove('drag');addFiles(e.dataTransfer.files);});
  $('settings').addEventListener('input',updateSettings);$('settings').addEventListener('change',updateSettings);
  document.querySelectorAll('[data-strength]').forEach(b=>b.onclick=()=>{$('strength').value=b.dataset.strength;updateSettings();});
  $('start').onclick=()=>{cachedZip=null;$('zip-status').textContent='';$('save-zip').textContent='まとめてZIPを作成';start();};
  $('cancel').onclick=()=>controller?.abort();
  $('save-zip').onclick=async()=>{
    if(busy)return;const s=settings(),signature=zipSignature(),name=safeName($('zip-name').value.replace(/\.zip$/i,''),'圧縮ファイル')+'.zip';
    // Prepared archives save on the user's click (works with browser save pickers).
    if(cachedZip?.signature===signature && cachedZip.level===s.zipLevel){await saveBlob(cachedZip.blob,name).catch(e=>notice(e.message));return;}
    controller=new AbortController();const signal=controller.signal;setBusy(true);$('progress-area').hidden=false;
    try {
      const blob=await zipResults(s.zipLevel,signal,p=>progress('ZIPを作成中',p));cachedZip={blob,signature,level:s.zipLevel};
      $('zip-status').textContent='ZIP全体：'+size(blob.size)+'。もう一度「ZIPを保存」を押すと保存できます。';renderTotals();
      $('save-zip').textContent='ZIPを保存';progress('ZIPの準備ができました',100);
    } catch(e){notice(e.name==='AbortError'?'ZIPの作成を中止しました。':e.message);}
    finally{controller=null;setBusy(false);}
  };
  $('download-app').onclick=()=>saveBlob(new Blob([originalHTML],{type:'text/html;charset=utf-8'}),'file_asshukukun.html').catch(e=>notice(e.message));
  window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue='';}});
  const videoMIME=supportedMIME(true),audioMIME=supportedMIME(false);
  $('media-support').textContent='このブラウザの出力候補：動画 '+(videoMIME?(videoMIME.includes('mp4')?'MP4':'WebM'):'非対応')+' ／ 音声 '+(audioMIME?(audioMIME.includes('mp4')?'M4A':audioMIME.includes('ogg')?'OGG':'WebM音声'):'非対応')+'。実際の変換可否は読み込むファイルにも依存します。';
  updateSettings();renderQueue();
})();
