/* SAERS Shared UI Helpers — single-file embedded */
(function(){
  'use strict';
  const $  = (q, root=document) => root.querySelector(q);
  const $$ = (q, root=document) => Array.from(root.querySelectorAll(q));

  function el(tag, cls, html){
    const e = document.createElement(tag);
    if(cls) e.className = cls;
    if(html!=null) e.innerHTML = html;
    return e;
  }

  function toast(msg, kind){
    let wrap = $('.toasts');
    if(!wrap){ wrap = el('div','toasts'); document.body.appendChild(wrap); }
    const t = el('div', 'toast '+(kind||''), msg);
    wrap.appendChild(t);
    setTimeout(()=>{ t.style.opacity='0'; t.style.transition='.3s'; setTimeout(()=>t.remove(),300); }, 3200);
  }

  function commsState(s){
    const both = s.toggles.bystanderOnline && s.toggles.driverOnline;
    return {
      realtime: both,
      bystanderOnline: s.toggles.bystanderOnline,
      driverOnline: s.toggles.driverOnline,
      label: both ? 'Real-time link active' : 'Real-time communication unavailable'
    };
  }

  /* ---- Map factory ---- */
  function makeMap(node, center, zoom){
    if(typeof L === 'undefined'){ node.innerHTML = '<div style="padding:20px;color:#9fb0cc">Map library unavailable</div>'; return null; }
    const map = L.map(node, {
      zoomControl:true, zoomAnimation:false, fadeAnimation:false, preferCanvas:true
    }).setView(center, zoom||14);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
      maxZoom:19, attribution:'&copy; OpenStreetMap &copy; CARTO'
    }).addTo(map);
    setTimeout(()=>map.invalidateSize(), 200);
    return map;
  }

  /* ---- Markers ---- */
  function accidentMarker(incident){
    const color = SAERS.altColor(incident.alt);
    const above = incident.altAboveGround;
    const icon = L.divIcon({
      className:'', html:
        `<div class="accident-icon" style="background:${color};width:30px;height:30px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 12px ${color}">✖</div>`,
      iconSize:[30,30], iconAnchor:[15,15]
    });
    const m = L.marker([incident.lat, incident.lng], {icon});
    m.bindPopup(`<b>Accident location</b><br>Altitude: ${incident.alt} m<br>${above>=0?above+' m above ground':''}<br>Road level: ${incident.roadLevel}<br>${incident.addr}`);
    return m;
  }
  function ambulanceMarker(amb, selected){
    const color = amb.status==='dispatched'||amb.status==='transporting' ? '#22d3ee' : amb.status==='busy' ? '#fbbf24' : '#34d399';
    const label = amb.id.replace('AMB-','A');
    const icon = L.divIcon({
      className:'', html:
        `<div class="amb-icon" style="background:${color};width:26px;height:26px;border:2px solid #fff;box-shadow:0 0 10px ${color}">${label}</div>`,
      iconSize:[26,26], iconAnchor:[13,13]
    });
    const m = L.marker([amb.lat, amb.lng], {icon});
    m.bindPopup(`<b>${amb.id}</b><br>${amb.type}<br>Driver: ${amb.driver}<br>Status: ${amb.status}<br>${amb.online?'Online':'Offline (last known)'}`);
    return m;
  }
  function hospitalMarker(h, selected){
    const color = selected ? '#a78bfa' : '#60a5fa';
    const icon = L.divIcon({
      className:'', html:
        `<div class="hosp-icon" style="background:${color};width:26px;height:26px;border-radius:6px;border:2px solid #fff;box-shadow:0 0 10px ${color}">🏥</div>`,
      iconSize:[26,26], iconAnchor:[13,13]
    });
    const m = L.marker([h.lat, h.lng], {icon});
    const icu = h.icuBeds;
    m.bindPopup(`<b>${h.name}</b><br>ICU: ${icu.avail}/${icu.total} beds free<br>OT: ${h.ot.avail}/${h.ot.total} free<br>Blood Bank: ${h.bloodBank?'Yes':'No'}<br>Specialists: ${h.specialists.join(', ')}`);
    return m;
  }

  function fmtKm(km){ return km<1 ? Math.round(km*1000)+' m' : km.toFixed(1)+' km'; }
  function fmtEta(min){ return min<60 ? Math.round(min)+' min' : (min/60).toFixed(1)+' hr'; }
  function timeAgo(ts){ const s=Math.round((Date.now()-ts)/1000); if(s<60)return s+'s ago'; const m=Math.round(s/60); if(m<60)return m+'m ago'; return Math.round(m/60)+'h ago'; }

  /* ---- Common topbar + sim controls ---- */
  function topbar(active){
    return `
    <div class="topbar">
      <div class="brand">
        <div class="logo">🚑</div>
        <div>
          <h1>Smart Ambulance Emergency Response</h1>
          <div class="sub">SAERS · Offline-capable GPS dispatch</div>
        </div>
      </div>
      <nav class="dashnav">
        <a href="index.html" class="${active==='bystander'?'active':''}">🧍 Bystander</a>
        <a href="driver.html" class="${active==='driver'?'active':''}">🚑 Ambulance Driver</a>
        <a href="control.html" class="${active==='control'?'active':''}">🛰️ Control Room</a>
      </nav>
    </div>`;
  }

  function simbarHTML(t){
    return `
    <div class="simbar">
      <span class="lbl">Simulation controls</span>
      <div class="toggle ${t.bystanderOnline?'on':''}" id="t-bystander"><div class="sw"></div><span class="tname">Bystander Internet</span></div>
      <div class="toggle ${t.driverOnline?'on':''}" id="t-driver"><div class="sw"></div><span class="tname">Ambulance Internet</span></div>
      <div class="toggle ${t.offlineMaps?'on':''}" id="t-offmap"><div class="sw"></div><span class="tname">Offline Maps</span></div>
      <button class="btn-reset" id="btn-reset">↺ Reset Demo</button>
    </div>`;
  }

  function bindSimbar(){
    setupToggle('t-bystander','bystanderOnline');
    setupToggle('t-driver','driverOnline');
    setupToggle('t-offmap','offlineMaps');
    $('#btn-reset').addEventListener('click', ()=>{ SAERS.resetDemo(); toast('Demo reset','warn'); });
  }
  function setupToggle(id, key){
    const node = $('#'+id);
    if(!node) return;
    const s = SAERS.get();
    node.classList.toggle('on', !!s.toggles[key]);
    node.addEventListener('click', ()=>{
      const val = !node.classList.contains('on');
      node.classList.toggle('on', val);
      SAERS.setToggles({ [key]: val });
      toast((val?'Enabled':'Disabled')+': '+node.querySelector('.tname').textContent, val?'ok':'warn');
    });
  }

  window.UI = {
    $, $$, el, toast, commsState, makeMap,
    accidentMarker, ambulanceMarker, hospitalMarker,
    fmtKm, fmtEta, timeAgo, topbar, simbarHTML, bindSimbar
  };
})();
