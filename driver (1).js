/* SAERS Ambulance Driver Dashboard — single-file embedded */
(function(){
  'use strict';
  const { $, $$, el, toast, commsState, makeMap, accidentMarker, ambulanceMarker, hospitalMarker,
          fmtKm, fmtEta, timeAgo, topbar, simbarHTML, bindSimbar } = UI;

  const ME_ID = 'AMB-1042';

  let rendered = false, map = null, layerAcc = null, layerAmb = null, layerHosp = null, layerRoute = null;

  function me(s){ return s.ambulances.find(a=>a.id===ME_ID); }

  function layout(){
    const s = SAERS.get();
    const cs = commsState(s);
    const inc = s.incident;
    const amb = me(s);
    const req = s.requests.find(r=>r.ambId===ME_ID && (r.status==='pending'||r.status==='accepted'));
    const phase = s.driverPhase;

    const distKm = inc ? SAERS.haversine({lat:amb.lat,lng:amb.lng}, inc) : 0;
    const eta = SAERS.etaKm(distKm);
    const altAG = inc ? inc.altAboveGround : 0;

    const phaseBadge = {
      idle:'<span class="pill gray">Idle — awaiting dispatch</span>',
      enroute:'<span class="pill cyan"><span class="dot b"></span>En route to scene</span>',
      at_scene:'<span class="pill amber"><span class="dot a"></span>At scene — assess patient</span>',
      to_hospital:'<span class="pill blue"><span class="dot b"></span>Transporting to hospital</span>',
      arrived_hospital:'<span class="pill green"><span class="dot g"></span>Patient delivered</span>'
    }[phase];

    return `
    ${topbar('driver')}
    ${simbarHTML(s.toggles)}
    <div class="content cols-2">
      <!-- LEFT: Request + Navigation map -->
      <div style="display:flex;flex-direction:column;gap:16px">
        ${req && req.status==='pending' ? `
        <div class="card" style="border-color:rgba(34,211,238,.4)">
          <h2>📨 Incoming Location-Sharing Request</h2>
          <div class="meta" style="font-size:12.5px;color:var(--tx2)">A bystander reported an accident and is requesting your GPS location to dispatch you to the scene.</div>
          ${inc ? `<div class="item">
            <div class="row1"><span class="id">Accident location</span><span class="pill cyan">Locked GPS</span></div>
            <div class="meta">${inc.addr}</div>
            <div class="stat-grid" style="margin-top:4px">
              <div class="stat"><div class="k">Lat</div><div class="v" style="font-size:15px">${inc.lat.toFixed(5)}</div></div>
              <div class="stat"><div class="k">Lng</div><div class="v" style="font-size:15px">${inc.lng.toFixed(5)}</div></div>
              <div class="stat alt"><div class="k">Altitude</div><div class="v" style="font-size:15px">${inc.alt}m</div></div>
            </div>
            <div class="alt-banner ${altAG<=1?'green':''}"><span class="ic">📐</span><span><b class="big">${altAG>=0?altAG:0} m</b> above ground — <b>${inc.roadLevel}</b></span></div>
          </div>` : ''}
          <div style="display:flex;gap:8px">
            <button class="btn green" id="btn-accept">✓ Accept &amp; Share GPS</button>
            <button class="btn" id="btn-decline">✗ Decline</button>
          </div>
        </div>` : ''}

        <div class="card">
          <h2>Scene Navigation <span class="hint">${phaseBadge}</span></h2>
          ${inc ? `
            <div class="stat-grid">
              <div class="stat"><div class="k">Distance to scene</div><div class="v">${fmtKm(distKm)}</div><div class="u">${amb.online?'live':'last known'}</div></div>
              <div class="stat"><div class="k">ETA</div><div class="v">${fmtEta(eta)}</div><div class="u">at 30 km/h</div></div>
              <div class="stat alt"><div class="k">Accident altitude</div><div class="v">${inc.alt}m</div><div class="u">${altAG>=0?altAG:0}m above ground</div></div>
            </div>
            <div class="alt-banner ${altAG<=1?'green':''}"><span class="ic">📐</span><span>Target is <b class="big">${altAG>=0?altAG:0} m</b> above ground — <b>${inc.roadLevel}</b>. Use this to pick the correct road level (flyover vs. road below).</span></div>
            <div class="map tall" id="map"></div>
            <div class="legend">
              <span><i style="background:${SAERS.altColor(inc.alt)}"></i> Accident</span>
              <span><i style="background:#22d3ee"></i> Your ambulance</span>
              <span><i style="background:#60a5fa"></i> Hospital</span>
            </div>
          ` : '<div class="muted">No incident assigned yet. When a bystander sends a location request, it will appear above.</div>'}
        </div>
      </div>

      <!-- RIGHT: Patient assessment + Hospital selection + Traffic -->
      <div style="display:flex;flex-direction:column;gap:16px">
        ${phase==='enroute' ? `
        <div class="card">
          <h2>En Route to Scene</h2>
          <div class="alert green">Navigating to the locked accident GPS. Distance ${fmtKm(distKm)} · ETA ${fmtEta(eta)}. The bystander's location is locked and will not change for 1 hour.</div>
          <button class="btn cyan full" id="btn-scene">📍 Mark Arrived at Scene</button>
        </div>` : ''}

        ${phase==='at_scene' ? `
        <div class="card">
          <h2>Patient Assessment (EMT)</h2>
          <div class="muted">Assess the patient and set severity. This drives hospital selection to avoid wrong-facility transfers.</div>
          <div class="assess">
            <div class="sev-row">
              <button class="sev crit ${s.patientStatus&&s.patientStatus.severity==='Critical'?'active':''}" data-sev="Critical">🔴 Critical</button>
              <button class="sev ser ${s.patientStatus&&s.patientStatus.severity==='Serious'?'active':''}" data-sev="Serious">🟠 Serious</button>
              <button class="sev mod ${s.patientStatus&&s.patientStatus.severity==='Moderate'?'active':''}" data-sev="Moderate">🔵 Moderate</button>
              <button class="sev min ${s.patientStatus&&s.patientStatus.severity==='Minor'?'active':''}" data-sev="Minor">🟢 Minor</button>
            </div>
            <input class="btn" style="text-align:left" id="pat-note" placeholder="e.g. Head injury, unconscious, bleeding" value="${s.patientStatus? s.patientStatus.note:''}">
          </div>
        </div>` : ''}

        <div class="card">
          <h2>Select Hospital &amp; Route <span class="hint">facilities near accident</span></h2>
          ${inc ? (phase==='at_scene'||phase==='to_hospital'||phase==='arrived_hospital') ? hospSelectHTML(s) : '<div class="muted">Reach the scene and assess the patient first, then select the most appropriate hospital.</div>'
                : '<div class="muted">No incident yet.</div>'}
        </div>

        ${s.trafficNotifs.length ? `
        <div class="card">
          <h2>🚓 Traffic Police Notifications</h2>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${s.trafficNotifs.map(t=>`
              <div class="item" style="border-color:rgba(96,165,250,.3)">
                <div class="row1"><span class="id">Route to ${t.hospital}</span><span class="pill green"><span class="dot g"></span>Sent</span></div>
                <div class="meta">${t.route}</div>
                <div class="meta">Ambulance ${t.ambId} · ${timeAgo(t.createdAt)}</div>
              </div>`).join('')}
          </div>
        </div>` : ''}

        <div class="card">
          <h2>Vehicle Status</h2>
          <div class="netbox">
            <div class="netrow"><span class="lbl">Ambulance ID</span><span class="val mono">${ME_ID}</span></div>
            <div class="netrow"><span class="lbl">Type</span><span class="val">${amb?amb.type:''}</span></div>
            <div class="netrow"><span class="lbl">Driver</span><span class="val">${amb?amb.driver:''}</span></div>
            <div class="netrow"><span class="lbl">Status</span><span class="val">${amb?amb.status:''}</span></div>
            <div class="netrow"><span class="lbl">Internet</span><span class="val ${cs.driverOnline?'on':'off'}">${cs.driverOnline?'Online':'Offline'}</span></div>
            ${!cs.driverOnline?`<div class="alert">🟠 You are offline. The bystander sees your last known location. Accept the request when network returns.</div>`:''}
          </div>
        </div>
      </div>
    </div>`;
  }

  function hospSelectHTML(s){
    const inc = s.incident;
    const sorted = s.hospitals.slice().sort((a,b)=>a.dist-b.dist);
    return sorted.map(h=>{
      const icuPct = h.icuBeds.avail/h.icuBeds.total;
      const otPct  = h.ot.avail/h.ot.total;
      const icuClass = icuPct>0.3?'ok':(icuPct>0?'warn':'bad');
      const otClass  = otPct>0.3?'ok':(otPct>0?'warn':'bad');
      const sel = s.selectedHospital===h.id;
      const reason = recommendReason(s.patientStatus, h);
      let btn = '';
      if(sel) btn = '<button class="btn sm" disabled>✅ Selected</button>';
      else if(s.driverPhase==='to_hospital'||s.driverPhase==='arrived_hospital') btn = '<button class="btn sm" disabled>Locked</button>';
      else btn = `<button class="btn sm cyan" data-hosp="${h.id}">✓ Select &amp; Go</button>`;
      return `
      <div class="item" ${sel?'style="border-color:#a78bfa"':''}>
        <div class="row1">
          <span class="id">🏥 ${h.name}</span>
          <span class="pill ${h.dist<1?'green':'blue'}">${fmtKm(h.dist)} · ${fmtEta(h.eta)}</span>
        </div>
        <div class="fac-grid">
          <div class="fac ${icuClass}"><span class="fname">🛏 ICU beds</span><span class="fval">${h.icuBeds.avail}/${h.icuBeds.total} free</span></div>
          <div class="fac ${otClass}"><span class="fname">🔪 Operation Theatre</span><span class="fval">${h.ot.avail>0?h.ot.avail+'/'+h.ot.total+' free':'All busy'}</span></div>
          <div class="fac ${h.bloodBank?'ok':'bad'}"><span class="fname">🩸 Blood Bank</span><span class="fval">${h.bloodBank?'Available':'No'}</span></div>
          <div class="fac ok"><span class="fname">🩺 Specialists</span><span class="fval">${h.specialists.join(', ')}</span></div>
        </div>
        ${reason?`<div class="muted" style="color:var(--green)">💡 ${reason}</div>`:''}
        ${btn}
      </div>`;
    }).join('') + (s.driverPhase==='to_hospital'?`<button class="btn green full" id="btn-hosp-arrived" style="margin-top:6px">🏥 Mark Arrived at Hospital</button>`:'');
  }

  function recommendReason(ps, h){
    if(!ps) return '';
    if(ps.severity==='Critical' && h.icuBeds.avail>0 && h.ot.avail>0) return 'Has ICU + OT available — ideal for critical patient.';
    if(ps.note && /head|neuro|brain/i.test(ps.note) && h.specialists.some(s=>/Neuro/i.test(s))) return 'Neuro specialist available — matches head injury.';
    if(ps.note && /card|chest|heart/i.test(ps.note) && h.specialists.some(s=>/Cardio/i.test(s))) return 'Cardiology specialist available.';
    if(ps.severity==='Minor' && h.icuBeds.avail>0) return 'Suitable for minor cases — ICU available if needed.';
    return '';
  }

  function initMap(){
    const s = SAERS.get();
    const node = $('#map'); if(!node) return;
    const amb = me(s);
    map = makeMap(node, [amb.lat, amb.lng], 14);
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
    const amb = me(s);
    if(s.incident){
      layerAcc.addLayer(accidentMarker(s.incident));
      layerAmb.addLayer(ambulanceMarker(amb));
      L.polyline([[amb.lat,amb.lng],[s.incident.lat,s.incident.lng]], {color:'#22d3ee',weight:3,dashArray:'6 6'}).addTo(layerRoute);
      if(s.selectedHospital){
        const h = s.hospitals.find(x=>x.id===s.selectedHospital);
        if(h){
          layerHosp.addLayer(hospitalMarker(h, true));
          L.polyline([[s.incident.lat,s.incident.lng],[h.lat,h.lng]], {color:'#a78bfa',weight:3,dashArray:'6 6'}).addTo(layerRoute);
        }
      } else {
        s.hospitals.forEach(h=> layerHosp.addLayer(hospitalMarker(h,false)));
      }
      map.fitBounds([[amb.lat,amb.lng],[s.incident.lat,s.incident.lng]], {padding:[40,40]});
    }
  }

  function bindControls(){
    const s = SAERS.get();
    const a = $('#btn-accept'); if(a) a.addEventListener('click', ()=>{
      const req = s.requests.find(r=>r.ambId===ME_ID && r.status==='pending');
      if(req){ SAERS.acceptRequest(req.id); toast('Request accepted · GPS shared','ok'); }
    });
    const d = $('#btn-decline'); if(d) d.addEventListener('click', ()=>{
      const req = s.requests.find(r=>r.ambId===ME_ID && r.status==='pending');
      if(req){ SAERS.declineRequest(req.id); toast('Request declined','warn'); }
    });
    const sc = $('#btn-scene'); if(sc) sc.addEventListener('click', ()=>{ SAERS.markAtScene(); toast('Marked arrived at scene','ok'); });
    $$('button[data-sev]').forEach(b=> b.addEventListener('click', ()=>{
      const note = $('#pat-note') ? $('#pat-note').value : '';
      SAERS.setPatientStatus(b.dataset.sev, note);
      toast('Patient severity set: '+b.dataset.sev,'ok');
    }));
    $('#pat-note') && $('#pat-note').addEventListener('change', e=>{
      const ps = SAERS.get().patientStatus;
      if(ps) SAERS.setPatientStatus(ps.severity, e.target.value);
    });
    $$('button[data-hosp]').forEach(b=> b.addEventListener('click', ()=>{
      SAERS.selectHospital(b.dataset.hosp);
      const h = SAERS.get().hospitals.find(x=>x.id===b.dataset.hosp);
      toast('Hospital selected: '+h.name+' · traffic police notified','ok');
    }));
    const ha = $('#btn-hosp-arrived'); if(ha) ha.addEventListener('click', ()=>{ SAERS.markAtHospital(); toast('Patient delivered to hospital','ok'); });
  }

  function render(){
    const app = $('#app');
    rendered = true;
    app.innerHTML = layout();
    bindSimbar();
    bindControls();
    try{ initMap(); }catch(e){ console.warn('map init skipped', e); }
  }

  SAERS.subscribe(render);
  document.addEventListener('DOMContentLoaded', render);
})();
