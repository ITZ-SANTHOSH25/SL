/* SAERS Bystander Dashboard — single-file embedded */
(function(){
  'use strict';
  const { $, $$, el, toast, commsState, makeMap, accidentMarker, ambulanceMarker, hospitalMarker,
          fmtKm, fmtEta, timeAgo, topbar, simbarHTML, bindSimbar } = UI;

  // Simulated bystander GPS (Bengaluru MG Road area, on a flyover)
  const MY_GPS = { lat: 12.9716, lng: 77.5946, alt: 927 }; // 927m => 7m above ground = ramp/elevated

  let rendered = false, map = null, layerAcc = null, layerAmb = null, layerHosp = null, layerRoute = null;

  function layout(){
    const s = SAERS.get();
    const cs = commsState(s);
    const inc = s.incident;
    const altAG = inc ? inc.altAboveGround : SAERS.altAboveGround(MY_GPS.alt);
    const roadName = inc ? inc.roadLevel : SAERS.roadLevelName(MY_GPS.alt);
    const altCol = SAERS.altColor(inc? inc.alt : MY_GPS.alt);
    const lockActive = inc && (Date.now() < inc.lockedUntil);
    const lockRemain = inc ? Math.max(0, Math.round((inc.lockedUntil - Date.now())/60000)) : 0;

    return `
    ${topbar('bystander')}
    ${simbarHTML(s.toggles)}
    <div class="content cols-2">
      <!-- LEFT: Map + GPS -->
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="card">
          <h2>Accident Location — GPS/GNSS <span class="hint">offline map pack ${s.toggles.offlineMaps?'loaded':'disabled'}</span></h2>
          <div class="stat-grid">
            <div class="stat"><div class="k">Latitude</div><div class="v">${(inc?inc.lat:MY_GPS.lat).toFixed(5)}</div><div class="u">degrees</div></div>
            <div class="stat"><div class="k">Longitude</div><div class="v">${(inc?inc.lng:MY_GPS.lng).toFixed(5)}</div><div class="u">degrees</div></div>
            <div class="stat alt ${inc?'locked':''}"><div class="k">Altitude (MSL)</div><div class="v">${inc?inc.alt:MY_GPS.alt}</div><div class="u">meters</div></div>
          </div>

          <div class="alt-banner ${altAG<=1?'green':''}">
            <span class="ic">📐</span>
            <span><b class="big">${altAG >= 0 ? altAG : 0} m</b> above ground level — <b>${roadName}</b>. This lets the ambulance driver distinguish a flyover from the parallel road below.</span>
          </div>

          ${inc ? `
            <div class="alt-banner green" style="margin-top:-2px">
              <span class="ic">🔒</span>
              <span>Location <b class="big">LOCKED</b> at report time. Next GPS update in <b>${lockRemain} min</b> (1-hour lock prevents wrong/changing location).</span>
            </div>` : `
            <div class="muted">Address: Capture location by reporting the accident. GPS is live; location is not yet locked.</div>`}

          <div class="map" id="map"></div>

          <div class="legend">
            <span><i style="background:${altCol}"></i> Accident (altitude-coded)</span>
            <span><i style="background:#34d399"></i> Available ambulance</span>
            <span><i style="background:#22d3ee"></i> Dispatched ambulance</span>
            <span><i style="background:#60a5fa"></i> Hospital</span>
          </div>

          ${inc ? `` : `<button class="btn primary full" id="btn-report">📍 Report Accident &amp; Lock Location</button>`}
          ${inc ? `<div class="alert green">✅ Accident reported. Nearby ambulances and hospitals listed on the right. Select an ambulance to send a location-sharing request.</div>` : ``}
        </div>
      </div>

      <!-- RIGHT: Ambulances + Hospitals + Network -->
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="card">
          <h2>Nearby Available Ambulances <span class="hint">by last known GPS</span></h2>
          <div id="amb-list" class="grow" style="display:flex;flex-direction:column;gap:8px">
            ${inc ? ambListHTML(s, cs) : '<div class="muted">Report the accident to see nearby ambulances.</div>'}
          </div>
        </div>

        <div class="card">
          <h2>Hospital Availability Dashboard <span class="hint">near accident location</span></h2>
          <div id="hosp-list" style="display:flex;flex-direction:column;gap:10px">
            ${inc ? hospListHTML(s) : '<div class="muted">Report the accident to see nearby hospitals with live facility availability.</div>'}
          </div>
        </div>

        <div class="card">
          <h2>Network &amp; Connectivity</h2>
          <div class="netbox">
            <div class="netrow"><span class="lbl">Bystander phone internet</span><span class="val ${cs.bystanderOnline?'on':'off'}">${cs.bystanderOnline?'Online':'Offline'}</span></div>
            <div class="netrow"><span class="lbl">Ambulance internet</span><span class="val ${cs.driverOnline?'on':'off'}">${cs.driverOnline?'Online':'Offline'}</span></div>
            <div class="netrow"><span class="lbl">Real-time communication</span><span class="val ${cs.realtime?'on':'off'}">${cs.realtime?'Available':'Unavailable'}</span></div>
            ${!cs.realtime ? `<div class="alert">🟠 Real-time communication is unavailable. The system uses the last known ambulance GPS location and shows estimated distance/ETA. The location-sharing request is queued and will be delivered when network connectivity returns.</div>` : ``}
          </div>
        </div>
      </div>
    </div>`;
  }

  function ambListHTML(s, cs){
    const inc = s.incident;
    const offline = !cs.realtime;
    return s.ambulances.map(a=>{
      const km = SAERS.haversine({lat:inc.lat,lng:inc.lng}, a);
      const eta = SAERS.etaKm(km);
      const req = s.requests.find(r=>r.ambId===a.id);
      const reqStatus = req ? req.status : null;
      const statusPill = a.status==='available'?'<span class="pill green"><span class="dot g"></span>Available</span>'
                       : a.status==='busy'?'<span class="pill amber"><span class="dot a"></span>On Another Call</span>'
                       : a.status==='dispatched'?'<span class="pill cyan"><span class="dot b"></span>Dispatched</span>'
                       : '<span class="pill blue"><span class="dot b"></span>Transporting</span>';
      let btn = '';
      if(reqStatus==='pending') btn = '<button class="btn sm" disabled>⏳ Request sent</button>';
      else if(reqStatus==='accepted') btn = '<button class="btn sm cyan" disabled>✓ Accepted · GPS shared</button>';
      else if(reqStatus==='declined') btn = '<button class="btn sm" disabled>✗ Declined</button>';
      else if(a.status==='available') btn = `<button class="btn sm cyan" data-amb="${a.id}">📤 Send Location Request</button>`;
      else btn = '<button class="btn sm" disabled>Busy</button>';

      return `
      <div class="item">
        <div class="row1">
          <span class="id">${a.id}</span>
          ${statusPill}
        </div>
        <div class="meta">${a.type} · Driver ${a.driver} · Last seen ${timeAgo(a.lastSeen)} ${a.online?'':'(offline)'}</div>
        <div class="row1">
          <span class="dist">${fmtKm(km)} ${offline?'(last known)':''}</span>
          <span class="eta">${offline?'est. ':''}${fmtEta(eta)}</span>
        </div>
        ${btn}
      </div>`;
    }).join('') + (offline?`<div class="alert" style="margin-top:6px">⚠ Real-time communication unavailable. Showing last known ambulance location. Distance &amp; ETA are estimates; live updates resume when network returns.</div>`:'');
  }

  function hospListHTML(s){
    const inc = s.incident;
    const sorted = s.hospitals.slice().sort((a,b)=>a.dist-b.dist);
    return sorted.map(h=>{
      const icuPct = h.icuBeds.avail/h.icuBeds.total;
      const otPct  = h.ot.avail/h.ot.total;
      const icuClass = icuPct>0.3?'ok':(icuPct>0?'warn':'bad');
      const otClass  = otPct>0.3?'ok':(otPct>0?'warn':'bad');
      const bbClass  = h.bloodBank?'ok':'bad';
      const sel = s.selectedHospital===h.id;
      return `
      <div class="item" ${sel?'style="border-color:#a78bfa"':''}>
        <div class="row1">
          <span class="id" style="${sel?'color:#a78bfa':''}">🏥 ${h.name}</span>
          <span class="pill ${sel?'cyan':h.dist<1?'green':'blue'}">${fmtKm(h.dist)} · ${fmtEta(h.eta)}</span>
        </div>
        <div class="fac-grid">
          <div class="fac ${icuClass}"><span class="fname">🛏 ICU beds</span><span class="fval">${h.icuBeds.avail}/${h.icuBeds.total} free</span></div>
          <div class="fac ${otClass}"><span class="fname">🔪 Operation Theatre</span><span class="fval">${h.ot.avail>0?h.ot.avail+'/'+h.ot.total+' free':'All busy'}</span></div>
          <div class="fac ${bbClass}"><span class="fname">🩸 Blood Bank</span><span class="fval">${h.bloodBank?'Available':'Not available'}</span></div>
          <div class="fac ok"><span class="fname">🩺 Specialists</span><span class="fval">${h.specialists.length} on-call</span></div>
        </div>
        <div class="tag-row">
          ${h.specialists.map(sp=>`<span class="pill gray">${sp}</span>`).join('')}
        </div>
        ${sel?'<div class="alert green" style="margin-top:4px">✅ Selected by EMT — traffic police notified.</div>':''}
      </div>`;
    }).join('');
  }

  function initMap(){
    const s = SAERS.get();
    const node = $('#map'); if(!node) return;
    map = makeMap(node, [MY_GPS.lat, MY_GPS.lng], 14);
    if(!map) return;
    layerAcc = L.layerGroup().addTo(map);
    layerAmb = L.layerGroup().addTo(map);
    layerHosp = L.layerGroup().addTo(map);
    layerRoute = L.layerGroup().addTo(map);
    drawMap(s);
  }

  function drawMap(s){
    if(!map) return;
    layerAcc.clearLayers(); layerAmb.clearLayers(); layerHosp.clearLayers(); layerRoute.clearLayers();
    if(s.incident){
      layerAcc.addLayer(accidentMarker(s.incident));
      s.ambulances.forEach(a=> layerAmb.addLayer(ambulanceMarker(a)));
      s.hospitals.forEach(h=> layerHosp.addLayer(hospitalMarker(h, s.selectedHospital===h.id)));
      // route line to dispatched amb
      const disp = s.ambulances.find(a=>a.status==='dispatched'||a.status==='transporting');
      if(disp){
        L.polyline([[disp.lat,disp.lng],[s.incident.lat,s.incident.lng]], {color:'#22d3ee',weight:3,dashArray:'6 6'}).addTo(layerRoute);
      }
      if(s.selectedHospital){
        const h = s.hospitals.find(x=>x.id===s.selectedHospital);
        if(h) L.polyline([[s.incident.lat,s.incident.lng],[h.lat,h.lng]], {color:'#a78bfa',weight:3,dashArray:'6 6'}).addTo(layerRoute);
      }
      map.setView([s.incident.lat, s.incident.lng], 14);
    }
  }

  function bindControls(){
    const btn = $('#btn-report');
    if(btn) btn.addEventListener('click', ()=>{
      const addr = 'MG Road Flyover, near Brigade Junction, Bengaluru';
      SAERS.reportIncident(MY_GPS, addr);
      toast('Accident reported · location locked · altitude 927m (7m above ground)','ok');
    });
    $$('button[data-amb]').forEach(b=>{
      b.addEventListener('click', ()=>{
        SAERS.requestAmbulance(b.dataset.amb);
        toast('Location request sent to '+b.dataset.amb,'ok');
      });
    });
  }

  function render(){
    const app = $('#app');
    if(!rendered){
      rendered = true;
      app.innerHTML = layout();
      bindSimbar();
      bindControls();
      try{ initMap(); }catch(e){ console.warn('map init skipped', e); }
    } else {
      app.innerHTML = layout();
      bindSimbar();
      bindControls();
      // re-init map since innerHTML wiped the node
      try{ initMap(); }catch(e){ console.warn('map re-init skipped', e); }
    }
  }

  SAERS.subscribe(render);
  document.addEventListener('DOMContentLoaded', render);
})();
