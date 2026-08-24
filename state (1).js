/* SAERS Core State Engine — single-file embedded */
(function(){
  'use strict';
  const LS_KEY = 'saers_state_v5';
  const POLL_MS = 1200;
  const ONE_HOUR = 60*60*1000;

  /* Default simulated world */
  function defaults(){
    return {
      updatedAt: Date.now(),
      incident: null,                 // { lat,lng,alt,altName,roadLevel,addr,reportedAt,lockedUntil,severity}
      ambulances: [
        { id:'AMB-1042', type:'Advanced Life Support', driver:'Imran K.', lat:12.9735, lng:77.5920, alt:920, status:'available', lastSeen:Date.now()-180000, online:true },
        { id:'AMB-1101', type:'Basic Life Support',    driver:'Priya S.', lat:12.9690, lng:77.5990, alt:915, status:'available', lastSeen:Date.now()-120000, online:true },
        { id:'AMB-1067', type:'Basic Life Support',    driver:'Suresh P.', lat:12.9680, lng:77.5880, alt:910, status:'busy',      lastSeen:Date.now()-120000, online:true },
        { id:'AMB-1093', type:'Advanced Life Support', driver:'Anita R.',  lat:12.9750, lng:77.6010, alt:925, status:'available', lastSeen:Date.now()-120000, online:false }
      ],
      hospitals: [
        { id:'H1', name:'Apollo Multispecialty',  lat:12.9650, lng:77.5980, alt:905,
          icuBeds:{total:12,avail:4}, ot:{total:6,avail:2}, bloodBank:true,
          specialists:['Trauma','Cardiology','Neuro','Ortho'], dist:0, eta:0 },
        { id:'H2', name:'City General Hospital',   lat:12.9720, lng:77.6050, alt:908,
          icuBeds:{total:8,avail:1}, ot:{total:4,avail:0}, bloodBank:true,
          specialists:['Trauma','Ortho'], dist:0, eta:0 },
        { id:'H3', name:'Sunrise Trauma Center',   lat:12.9620, lng:77.5880, alt:900,
          icuBeds:{total:16,avail:7}, ot:{total:8,avail:3}, bloodBank:true,
          specialists:['Trauma','Neuro','Cardio'], dist:0, eta:0 },
        { id:'H4', name:'Lifeline Cardiac Care',   lat:12.9770, lng:77.5910, alt:912,
          icuBeds:{total:10,avail:3}, ot:{total:5,avail:2}, bloodBank:false,
          specialists:['Cardiology'], dist:0, eta:0 }
      ],
      requests: [],                   // { id, ambId, status:'pending|accepted|declined', createdAt, acceptedAt }
      patientStatus: null,            // { severity, note, setAt }
      selectedHospital: null,         // hospital id
      trafficNotifs: [],              // { id, route, hospital, createdAt, status }
      eventLog: [],                   // { ts, text }
      toggles: { bystanderOnline:true, driverOnline:true, offlineMaps:true, controlNet:true },
      driverPhase: 'idle'             // idle|enroute|at_scene|to_hospital|arrived_hospital
    };
  }

  let state = load() || defaults();
  const subs = [];

  function load(){
    try{ const raw = localStorage.getItem(LS_KEY); return raw? JSON.parse(raw): null; }catch(e){ return null; }
  }
  function save(s){ try{ localStorage.setItem(LS_KEY, JSON.stringify(s)); }catch(e){} }
  function notify(){ subs.forEach(fn=>{ try{fn(state);}catch(e){console.warn(e);} }); }

  function commit(mutator){
    const draft = JSON.parse(JSON.stringify(state));
    mutator(draft);
    draft.updatedAt = Date.now();
    state = draft;
    save(state);
    notify();
  }

  function log(draft, text){
    draft.eventLog.unshift({ ts: new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}), text });
    if(draft.eventLog.length>40) draft.eventLog.length=40;
  }

  /* ---- Haversine (km) ---- */
  function haversine(a,b){
    const R=6371, toRad=d=>d*Math.PI/180;
    const dLat=toRad(b.lat-a.lat), dLng=toRad(b.lng-a.lng);
    const la1=toRad(a.lat), la2=toRad(b.lat);
    const h=Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
    return 2*R*Math.asin(Math.sqrt(h));
  }
  function etaKm(km){ return Math.max(1, Math.round(km/0.5)); } // ~30km/h city avg => 2min/km, use 0.5km/min

  /* ---- Altitude helpers ---- */
  // Ground reference for Bengaluru area ~ 920m. Compute "meters above ground".
  function altAboveGround(altM){
    const GROUND = 920;
    return Math.round(altM - GROUND);
  }
  function roadLevelName(altM){
    const above = altAboveGround(altM);
    if(above <= 1)  return 'Ground-level road';
    if(above <= 8)  return 'Low-level ramp / underpass approach';
    if(above <= 14) return 'Flyover / elevated road';
    return 'High-level overpass / bridge';
  }
  function altColor(altM){
    const above = altAboveGround(altM);
    if(above <= 1)  return '#34d399'; // green — ground
    if(above <= 8)  return '#fbbf24'; // amber — ramp
    return '#f87171';                 // red — flyover
  }

  /* ---- Domain actions ---- */
  function reportIncident(loc, addr){
    commit(d=>{
      const altAG = altAboveGround(loc.alt);
      d.incident = {
        lat: loc.lat, lng: loc.lng, alt: loc.alt,
        altAboveGround: altAG,
        roadLevel: roadLevelName(loc.alt),
        addr: addr,
        reportedAt: Date.now(),
        lockedUntil: Date.now() + ONE_HOUR
      };
      d.requests = [];
      d.patientStatus = null;
      d.selectedHospital = null;
      d.trafficNotifs = [];
      d.driverPhase = 'idle';
      // attach computed dist/eta to hospitals
      d.hospitals.forEach(h=>{
        const km = haversine({lat:loc.lat,lng:loc.lng}, h);
        h.dist = +km.toFixed(2);
        h.eta = etaKm(km);
      });
      log(d, `Accident reported at ${addr}. Location locked. Altitude ${loc.alt}m (${altAG}m above ground — ${roadLevelName(loc.alt)}).`);
    });
  }

  function requestAmbulance(ambId){
    commit(d=>{
      const amb = d.ambulances.find(a=>a.id===ambId);
      if(!amb) return;
      // remove old pending for this amb
      d.requests = d.requests.filter(r=>!(r.ambId===ambId && r.status==='pending'));
      d.requests.push({ id:'R'+Date.now(), ambId, status:'pending', createdAt:Date.now() });
      log(d, `Location-sharing request sent to ${ambId} (${amb.driver}).`);
    });
  }

  function acceptRequest(reqId){
    commit(d=>{
      const r = d.requests.find(x=>x.id===reqId);
      if(!r) return;
      r.status = 'accepted'; r.acceptedAt = Date.now();
      const amb = d.ambulances.find(a=>a.id===r.ambId);
      if(amb){ amb.status = 'dispatched'; amb.online = true; }
      d.driverPhase = 'enroute';
      log(d, `${r.ambId} accepted the request. Ambulance GPS now shared with the system. En route to scene.`);
    });
  }
  function declineRequest(reqId){
    commit(d=>{
      const r = d.requests.find(x=>x.id===reqId);
      if(!r) return;
      r.status = 'declined';
      log(d, `${r.ambId} declined the location request.`);
    });
  }

  function markAtScene(){
    commit(d=>{
      d.driverPhase = 'at_scene';
      log(d, 'Ambulance arrived at the accident scene.');
    });
  }
  function setPatientStatus(severity, note){
    commit(d=>{
      d.patientStatus = { severity, note, setAt:Date.now() };
      log(d, `EMT assessment: ${severity}. ${note||''}`);
    });
  }
  function selectHospital(hid){
    commit(d=>{
      const h = d.hospitals.find(x=>x.id===hid);
      if(!h) return;
      d.selectedHospital = hid;
      d.driverPhase = 'to_hospital';
      const amb = d.ambulances.find(a=>a.status==='dispatched');
      const ambId = amb? amb.id : 'AMB-1042';
      const route = `Via MG Road → Brigade Road → ${h.name}`;
      d.trafficNotifs.unshift({
        id:'T'+Date.now(), route, hospital:h.name, ambId,
        createdAt:Date.now(), status:'sent'
      });
      if(amb) amb.status='transporting';
      log(d, `Hospital selected: ${h.name}. Traffic police auto-notified to clear route: ${route}.`);
    });
  }
  function markAtHospital(){
    commit(d=>{
      d.driverPhase = 'arrived_hospital';
      const amb = d.ambulances.find(a=>a.status==='transporting');
      if(amb){ amb.status='available'; amb.lastSeen=Date.now(); }
      log(d, 'Patient delivered to hospital. Ambulance back to available.');
    });
  }

  function setToggles(partial){
    commit(d=>{ Object.assign(d.toggles, partial); });
  }
  function resetDemo(){
    localStorage.removeItem(LS_KEY);
    state = defaults(); save(state); notify();
  }

  function subscribe(fn){ subs.push(fn); return ()=>{ const i=subs.indexOf(fn); if(i>=0) subs.splice(i,1); }; }
  function get(){ return state; }

  /* ---- cross-tab poll ---- */
  setInterval(()=>{
    const incoming = load();
    if(incoming && incoming.updatedAt !== state.updatedAt){
      state = incoming; notify();
    }
  }, POLL_MS);

  window.SAERS = {
    get, subscribe, resetDemo, setToggles,
    reportIncident, requestAmbulance, acceptRequest, declineRequest,
    markAtScene, setPatientStatus, selectHospital, markAtHospital,
    haversine, etaKm, altAboveGround, roadLevelName, altColor, ONE_HOUR
  };
})();
