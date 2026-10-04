(() => {
  const $ = (id) => document.getElementById(id);
  const lobby = $("lobby"), gameArea = $("gameArea"), canvas = $("gameCanvas"), ctx = canvas.getContext("2d");
  const COLS = 30, ROWS = 20, CELL = canvas.width / COLS;
  const COLORS = ["#9dfc63", "#65e6e0", "#ff79b8", "#ffca66"];
  let peer = null, hostConn = null, connections = [], isHost = false, roomCode = "";
  let world = null, playerId = "", tickTimer = null, renderTimer = null, lastDirection = "right", localStatus = "lobby";
  let soundOn = false, audioCtx = null, bestScore = Number(localStorage.getItem("snakeSquadBest") || 0); 
  $("bestScore").textContent = bestScore;

  function setLobbyStatus(msg) { $("lobbyStatus").textContent = msg; }
  function showGame() { lobby.classList.add("hidden"); gameArea.classList.remove("hidden"); }
  function showLobby() {
    stopLoops();
    if (peer && !peer.destroyed) peer.destroy();
    peer = null; hostConn = null; connections = []; world = null; isHost = false; roomCode = "";
    gameArea.classList.add("hidden"); lobby.classList.remove("hidden"); localStatus = "lobby";
    setLobbyStatus("Create a room and share the code with a friend.");
  }
  function stopLoops() { clearInterval(tickTimer); clearInterval(renderTimer); tickTimer = renderTimer = null; }
  function beep(freq=520, duration=0.08) {
    if (!soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.frequency.value = freq; osc.type = "sine"; gain.gain.value = 0.035;
      osc.connect(gain); gain.connect(audioCtx.destination); osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) {}
  }
  function randomCode() { return Math.random().toString(36).slice(2, 7).toUpperCase(); }
  function makeSnake(id, name, x, y, dir, color) {
    return { id, name, color, dir, nextDir: dir, alive: true, score: 0, body: [{x,y},{x:x-(dir==="right"?1:dir==="left"?-1:0),y:y-(dir==="down"?1:dir==="up"?-1:0)}] };
  }
  function randomFood(snakes) {
    let p, tries = 0;
    do { p = {x:Math.floor(Math.random()*COLS), y:Math.floor(Math.random()*ROWS)}; tries++; }
    while (tries < 500 && (snakes.some(s => s.body.some(b => b.x===p.x && b.y===p.y))));
    return p;
  }
  function newWorld(includeTeammate = false) {
    const a = makeSnake("p1", "You", 7, 10, "right", COLORS[0]);
    const snakes = [a];
    if (includeTeammate) snakes.push(makeSnake("p2", "Teammate", 22, 10, "left", COLORS[1]));
    return { snakes, food:randomFood(snakes), score:0, running:false, over:false, message:"Waiting for teammate…", tick:0 };
  }
  function hostStart() {
    if (!world || world.snakes.length < 2 || !connections.some(c => c.open)) {
      if (world) { world.message = "Waiting for your teammate to connect."; updateWorld(world); }
      return;
    }
    world.running = true; world.over = false; world.message = "Go, squad! Eat food and avoid every snake.";
    $("overlay").classList.add("hidden");
    broadcast({type:"state", world});
  }
  function startLoops() {
    stopLoops();
    tickTimer = setInterval(() => {
      if (isHost && world && world.running && !world.over) stepWorld();
    }, 125);
    renderTimer = setInterval(draw, 45);
  }
  function stepWorld() {
    world.tick++;
    const alive = world.snakes.filter(s => s.alive);
    const oldHeads = alive.map(s => ({id:s.id, ...s.body[0]}));
    const proposed = new Map();
    for (const s of alive) {
      s.dir = s.nextDir;
      const h = s.body[0], d = delta(s.dir);
      proposed.set(s.id, {x:h.x+d.x, y:h.y+d.y});
    }
    const dead = new Set();
    for (const s of alive) {
      const p = proposed.get(s.id);
      if (p.x<0 || p.x>=COLS || p.y<0 || p.y>=ROWS) dead.add(s.id);
      if (s.body.some((b,i) => i>0 && b.x===p.x && b.y===p.y)) dead.add(s.id);
    }
    // Head-to-head collisions and running into any teammate's body are dangerous.
    for (const s of alive) {
      const p = proposed.get(s.id);
      for (const other of alive) {
        if (other.id===s.id) continue;
        if (other.body.some((b,i) => !(i===other.body.length-1 && !world.food) && b.x===p.x && b.y===p.y)) dead.add(s.id);
        const q = proposed.get(other.id);
        if (p.x===q.x && p.y===q.y) { dead.add(s.id); dead.add(other.id); }
      }
    }
    for (const s of alive) {
      const p = proposed.get(s.id);
      if (dead.has(s.id)) { s.alive = false; continue; }
      s.body.unshift(p);
      if (p.x===world.food.x && p.y===world.food.y) {
        world.score += 10; s.score += 10; beep(740, 0.09);
        if (world.score > bestScore) { bestScore = world.score; localStorage.setItem("snakeSquadBest", String(bestScore)); $("bestScore").textContent = bestScore; }
        world.food = randomFood(world.snakes.filter(sn => sn.alive));
      } else s.body.pop();
    }
    if (world.snakes.every(s=>!s.alive)) {
      world.over = true; world.running = false; world.message = "Squad wiped out! Team score: " + world.score;
    } else if (world.snakes.some(s=>!s.alive)) {
      world.message = "One snake is out! Keep collecting for the squad.";
    }
    broadcast({type:"state", world});
  }
  function delta(dir) { return ({up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}})[dir]; }
  function reverse(a,b) { return (a==="up"&&b==="down")||(a==="down"&&b==="up")||(a==="left"&&b==="right")||(a==="right"&&b==="left"); }
  function setDirection(dir) {
    if (!world || world.over) return;
    const snake = world.snakes.find(s=>s.id===playerId);
    if (!snake || !snake.alive || reverse(snake.dir,dir)) return;
    lastDirection = dir;
    if (isHost) { snake.nextDir = dir; }
    else if (hostConn && hostConn.open) hostConn.send({type:"input", dir});
  }
  function broadcast(data) {
    connections = connections.filter(c=>c.open);
    connections.forEach(c=>{ try { c.send(data); } catch(e) {} });
  }
  function updateWorld(next) {
    world = next;
    $("score").textContent = world.score;
    if (world.score > bestScore) { bestScore = world.score; localStorage.setItem("snakeSquadBest", String(bestScore)); $("bestScore").textContent = bestScore; }
    $("gameStatus").textContent = world.message || "Stay sharp!";
    $("players").innerHTML = world.snakes.map(s=>`<div class="player-chip"><span class="player-dot" style="background:${s.color}"></span>${escapeHtml(s.name)}${s.alive?"":" · OUT"}</div>`).join("");
    $("pauseBtn").textContent = world.running ? "Ⅱ Pause" : (world.over ? "↻ New run" : "▶ Resume");
    if (world.over) {
      beep(180, 0.22);
      $("overlay").classList.remove("hidden");
      $("overlayTitle").textContent = "Squad game over";
      $("overlayText").textContent = "Final team score: " + world.score + ". Try again and beat it!";
      $("restartBtn").classList.remove("hidden");
    } else if (!world.running) {
      $("overlay").classList.remove("hidden");
      $("overlayTitle").textContent = world.snakes.length < 2 ? "Waiting for teammate…" : "Ready, squad?";
      $("overlayText").textContent = world.snakes.length < 2 ? "Share your room code so a friend can join." : "Both snakes are in. Start the run!";
      $("restartBtn").classList.toggle("hidden", !isHost || world.snakes.length < 2);
      if (isHost && world.snakes.length >= 2) { $("restartBtn").textContent = "Start game"; }
    } else $("overlay").classList.add("hidden");
    draw();
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  function draw() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle="#172b24"; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.strokeStyle="rgba(208,240,185,.065)"; ctx.lineWidth=1;
    for(let x=0;x<=canvas.width;x+=CELL){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke();}
    for(let y=0;y<=canvas.height;y+=CELL){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke();}
    // Subtle border around the playable field.
    ctx.strokeStyle="rgba(198,243,106,.22)";ctx.strokeRect(1,1,canvas.width-2,canvas.height-2);
    if (!world) return;
    if (world.food) {
      const f=world.food, cx=(f.x+.5)*CELL, cy=(f.y+.5)*CELL;
      ctx.shadowColor="#c6f36a";ctx.shadowBlur=17;ctx.fillStyle="#c6f36a";ctx.beginPath();ctx.arc(cx,cy,CELL*.3,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
      ctx.fillStyle="#f4ffd7";ctx.beginPath();ctx.arc(cx-2,cy-2,CELL*.09,0,Math.PI*2);ctx.fill();
    }
    for(const s of world.snakes) {
      s.body.forEach((b,i)=>{
        const pad=i===0?1.8:3.1, x=b.x*CELL+pad, y=b.y*CELL+pad, size=CELL-pad*2;
        ctx.globalAlpha=s.alive?1:.24;
        ctx.fillStyle=i===0?s.color:(s.id==="p1"?"#477e61":"#4d9c9a");
        roundedRect(ctx,x,y,size,size,i===0?5:3);ctx.fill();
        if(i===0 && s.alive){
          ctx.fillStyle="#172b24";
          const eyeX=s.dir==="left"?x+3:s.dir==="right"?x+size-5:x+size/2;
          const eyeY=s.dir==="up"?y+3:s.dir==="down"?y+size-5:y+size/2;
          ctx.beginPath();ctx.arc(eyeX,eyeY,1.5,0,Math.PI*2);ctx.fill();
        }
      });
      ctx.globalAlpha=1;
    }
  }
  function roundedRect(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}

  function setupHost(code) {
    isHost = true; roomCode = code; playerId = "p1"; world = newWorld(false);
    world.snakes[0].name = "You";
    $("roomLabel").textContent = code;
    showGame(); startLoops(); updateWorld(world);
    peer = new Peer(code, {debug:1});
    peer.on("open", id => { setLobbyStatus("Room created!"); $("gameStatus").textContent="Room ready. Waiting for your teammate…"; });
    peer.on("connection", conn => {
      if (connections.some(c => c.open)) { conn.on("open",()=>conn.send({type:"error",message:"This room is full."})); setTimeout(()=>conn.close(),500); return; }
      connections.push(conn);
      conn.on("open",()=>{
        if (!world.snakes.some(s => s.id === "p2")) world.snakes.push(makeSnake("p2","Teammate",22,10,"left",COLORS[1]));
        world.snakes[1].name="Teammate";
        conn.send({type:"welcome", playerId:"p2", world});
        broadcast({type:"state",world});
        updateWorld(world);
      });
      conn.on("data", data=>{
        if (!data || typeof data!=="object") return;
        if (data.type==="input" && world) {
          const s=world.snakes.find(x=>x.id==="p2");
          if (s && s.alive && !reverse(s.dir,data.dir) && delta(data.dir)) s.nextDir=data.dir;
        } else if (data.type==="restart" && world && world.over) {
          world=newWorld(connections.some(c=>c.open));
          updateWorld(world);
          hostStart();
        } else if (data.type==="start" && world && !world.running && !world.over) hostStart();
      });
      conn.on("close",()=>{
        connections=connections.filter(c=>c!==conn);
        if(world){
          world.running=false;
          world.snakes=world.snakes.filter(s=>s.id!=="p2");
          world.message="Teammate disconnected. Waiting for them to reconnect.";
          updateWorld(world);
          broadcast({type:"state",world});
        }
      });
    });
    peer.on("error",err=>{ $("gameStatus").textContent="Connection issue: "+err.type+". Try another room code."; });
  }
  function setupClient(code) {
    isHost=false; roomCode=code; $("roomLabel").textContent=code;
    showGame(); $("overlayTitle").textContent="Connecting…";$("overlayText").textContent="Finding your teammate's room.";
    peer=new Peer(undefined,{debug:1});
    peer.on("open",()=>{
      hostConn=peer.connect(code,{reliable:true});
      hostConn.on("open",()=>{$("gameStatus").textContent="Connected! Waiting for the host to start.";});
      hostConn.on("data",data=>{
        if(!data)return;
        if(data.type==="welcome"){playerId=data.playerId;updateWorld(data.world);}
        else if(data.type==="state")updateWorld(data.world);
        else if(data.type==="error"){$("gameStatus").textContent=data.message;}
      });
      hostConn.on("close",()=>{$("overlay").classList.remove("hidden");$("overlayTitle").textContent="Room disconnected";$("overlayText").textContent="The host left the room. Return to the lobby to try again.";});
    });
    peer.on("error",err=>{$("gameStatus").textContent=err.type==="peer-unavailable"?"Room not found. Check the code and try again.":"Connection issue: "+err.type;});
    startLoops();
  }
  $("createBtn").addEventListener("click",()=>{
    const code=randomCode();setLobbyStatus("Creating room "+code+"…");setupHost(code);
  });
  $("joinBtn").addEventListener("click",()=>{
    const code=$("roomInput").value.trim().toUpperCase();
    if(!/^[A-Z0-9_-]{3,8}$/.test(code)){setLobbyStatus("Enter a valid room code (3–8 letters or numbers).");return;}
    setupClient(code);
  });
  $("roomInput").addEventListener("keydown",e=>{if(e.key==="Enter")$("joinBtn").click();});
  $("copyBtn").addEventListener("click",async()=>{
    try{await navigator.clipboard.writeText(roomCode);$("copyBtn").textContent="Copied!";setTimeout(()=>$("copyBtn").textContent="Copy",1200);}
    catch(e){window.prompt("Copy this room code:",roomCode);}
  });
  $("restartBtn").addEventListener("click",()=>{
    if(!world)return;
    if(isHost){
      if(world.over){world=newWorld(connections.some(c=>c.open));updateWorld(world);}
      hostStart();
    } else if(hostConn&&hostConn.open)hostConn.send({type:world.over?"restart":"start"});
  });
  $("leaveBtn").addEventListener("click",showLobby);
  $("soundBtn").addEventListener("click",()=>{
    soundOn=!soundOn;
    $("soundBtn").textContent=soundOn?"🔊 Sound on":"🔇 Sound off";
    $("soundBtn").setAttribute("aria-pressed",String(soundOn));
    if(soundOn)beep(620,0.07);
  });
  $("pauseBtn").addEventListener("click",()=>{
    if(!world)return;
    if(world.over){$("restartBtn").click();return;}
    if(isHost){
      world.running=!world.running;
      world.message=world.running?"Back in action!":"Paused by host";
      broadcast({type:"state",world});updateWorld(world);
    } else if(hostConn&&hostConn.open && !world.running) hostConn.send({type:"start"});
  });
  document.addEventListener("keydown",e=>{
    if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(e.key))e.preventDefault();
    const map={ArrowUp:"up",w:"up",W:"up",ArrowDown:"down",s:"down",S:"down",ArrowLeft:"left",a:"left",A:"left",ArrowRight:"right",d:"right",D:"right"};
    if(map[e.key])setDirection(map[e.key]);
    if(e.key.toLowerCase()==="p"&&isHost&&world&&!world.over){world.running=!world.running;world.message=world.running?"Back in action!":"Paused by host";broadcast({type:"state",world});updateWorld(world);}
  });
  // Touch-first controls: pointer events work on phones, tablets, and desktop.
  document.querySelectorAll("[data-dir]").forEach(btn=>{
    const steer=event=>{event.preventDefault();setDirection(btn.dataset.dir);};
    btn.addEventListener("pointerdown",steer);
    btn.addEventListener("click",event=>event.preventDefault());
  });
  // Swiping across the board is an optional, natural mobile control.
  let swipeStart=null;
  canvas.addEventListener("pointerdown",event=>{
    if(event.pointerType==="mouse")return;
    swipeStart={x:event.clientX,y:event.clientY};
  },{passive:true});
  canvas.addEventListener("pointerup",event=>{
    if(!swipeStart)return;
    const dx=event.clientX-swipeStart.x,dy=event.clientY-swipeStart.y;
    swipeStart=null;
    if(Math.max(Math.abs(dx),Math.abs(dy))<22)return;
    setDirection(Math.abs(dx)>Math.abs(dy)?(dx>0?"right":"left"):(dy>0?"down":"up"));
  },{passive:true});
  canvas.addEventListener("pointercancel",()=>{swipeStart=null;});
  // Host owns the shared world; clients only send steering input.
})();