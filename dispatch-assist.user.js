// ==UserScript==
// @name         MissionChief – Dispatch Assist (HRL FO + own missions)
// @namespace    https://www.missionchief.co.uk/
// @version      2.0.3
// @description  Alliance missions: pre-selects your nearest free zHRL Fire Officer. Own missions: pre-selects the nearest units for everything still required. You still press Dispatch yourself.
// @author       Aaron
// @updateURL    https://raw.githubusercontent.com/aallen92/missionchief-dispatch-assist/main/dispatch-assist.user.js
// @downloadURL  https://raw.githubusercontent.com/aallen92/missionchief-dispatch-assist/main/dispatch-assist.user.js
// @match        https://www.missionchief.co.uk/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Settings ----------
  const CFG = {
    // Alliance missions
    alliance: {
      enabled: true,
      captionPrefix: 'zHRL',        // vehicle name must start with this
      vehicleType: 'Fire Officer',  // vehicle type shown in the dispatch list
      maxDistanceMiles: 0,          // 0 = no limit
      includePlannedEvents: false,  // also step through alliance planned events
    },
    // Your own missions
    own: {
      enabled: true,
      // Skip vehicles whose name starts with any of these (e.g. keep your zHRL FOs free for alliance work)
      excludeCaptionPrefixes: [],
      // On a fresh mission some units are only needed sometimes (e.g. "50% chance of needing an aerial").
      // false = leave those out and let the game tell you once the first unit arrives.
      includeChanceRequirements: false,
      maxDistanceMiles: 0,          // 0 = no limit
      // One ambulance per patient that doesn't have one yet (minus ambulances already en route)
      ambulancesForPatients: true,
      // Missing armed response personnel are covered by sending ARVs: personnel ÷ this, rounded up
      armedPersonnelPerArv: 4,
      // Patients not yet assessed: send ambulances for (mission's transport chance + grace)% of them.
      // Patients known not to need transport share one ambulance. false = one ambulance per patient.
      useTransportProbability: true,
      transportGracePct: 10,
      maxAmbulancesPerClick: 0,     // 0 = no cap. Set e.g. 20 to stop huge incidents ticking 100+ ambulances at once
      // The game adds an Ambulance Officer and Mass Casualty Equipment itself once a big incident has
      // patients, but they are missing from the mission data, so a fresh call never asks for them.
      // If the mission is guaranteed at least this many patients (or already shows this many), send one of
      // each straight away. 0 = off (then they only get sent once the game lists them as missing).
      largeIncidentMinPatients: 10,
    },
    rememberMinutes: 30,
  };
  // ------------------------------

  // Requirement → which vehicles satisfy it.
  //  keys:     names used in the game's mission data (fresh missions)
  //  captions: wording used in the "Missing Vehicles" box (singular, lower case)
  //  attr / any / types: how to recognise a matching vehicle in the dispatch list
  // Order matters: specific units first, generic ones (fire engines) last, so e.g. a Rescue Pump
  // picked for "rescue support" also counts towards fire engines.
  const REQS = [
    { keys: ['hazard_response_primary'], captions: ['primary response vehicle', 'prv'], types: [27] },
    { keys: ['hazard_response_secondary'], captions: ['secondary response vehicle', 'srv'], types: [28] },
    { keys: ['ems_mobile_command'], captions: ['ambulance control unit', 'acu'], types: [31] },
    { keys: ['atv_carrier'], captions: ['atv carrier'], types: [30] },
    { keys: ['police_horse'], captions: ['mounted unit'], types: [55] },
    { keys: ['arff'], captions: ['major foam tender'], types: [75] },
    { keys: ['large_coastal_boat'], captions: ['ilb'], types: [68] },
    { keys: ['coastal_guard_boat'], captions: ['alb'], types: [69] },
    { keys: ['oneof_coastal_guard_boat_or_boat_large'], captions: ['ilbs or alb'], types: [68, 69] },
    { keys: ['mass_casualty_equipment'], captions: ['mass casualty equipment', 'mass casualty equipment or medical equipment trailer'], attr: 'mass_casualty_equipment' },
    { keys: ['kdow_orgl'], captions: ['ambulance officer', 'operational team leader', 'otl'], attr: 'kdow_orgl_any' },
    { keys: ['platform_trucks'], captions: ['aerial appliance truck'], attr: 'dlk' },
    { keys: ['heavy_rescue_vehicles'], captions: ['rescue support vehicle', 'rescue support unit'], attr: 'rw' },
    // ICCUs can stand in for Fire Officers. Both share the 'command' group so one ICCU is never
    // counted for both jobs: ICCU needs are filled first, then Fire Officers from FOs or spare ICCUs.
    { keys: ['mobile_command_vehicles'], captions: ['iccu or ambulance control unit', 'iccu'], attr: 'elw2_or_ab_elw', group: 'command' },
    { keys: ['battalion_chief_vehicles'], captions: ['fire officer', 'fire officer or iccu'], attr: 'elw1_or_elw2', group: 'command' },
    { keys: ['water_tankers'], captions: ['water carrier'], attr: 'gwl2wasser' },
    { keys: ['hazmat_vehicles'], captions: ['hazmat units or cbrn vehicle', 'hazmat unit', 'cbrn vehicle'], attr: 'gwgefahrgut' },
    { keys: ['mobile_air_vehicles'], captions: ['breathing apparatus support unit'], attr: 'gwa' },
    { keys: ['foam'], captions: ['foam tender', 'foam tenders or riv'], attr: 'foam' },
    { keys: ['emergency_welfare'], captions: ['welfare vehicle', 'crew welfare vehicle'], attr: 'emergency_welfare_value' },
    { keys: ['k9'], captions: ['dog support unit', 'dsu'], attr: 'k9' },
    { keys: ['police_helicopters', 'oneof_police_drone_or_helicopter'], captions: ['police helicopter', 'police helicopters or drone'], attr: 'polizeihubschrauber' },
    { keys: ['traffic_car'], captions: ['traffic car'], attr: 'any_traffic_car' },
    { keys: ['flood_equipment'], captions: ['flood rescue unit'], attr: 'flood_equipment' },
    { keys: ['coastal_rescue'], captions: ['crv', 'coastguard rescue vehicle'], attr: 'coastal_rescue' },
    { keys: ['coastal_helicopter'], captions: ['coastguard rescue helicopter'], attr: 'coastal_helicopter' },
    { keys: ['search_and_rescue'], captions: ['operational support vans, trailers or personal sar vehicle'], attr: 'search_and_rescue' },
    { keys: ['search_and_rescue_command'], captions: ['control van'], attr: 'search_and_rescue_command' },
    { keys: ['water_rescue'], captions: ['4x4 vehicle'], attr: 'gw_wasserrettung' },
    { keys: ['drone'], captions: ['drone'], attr: 'drone' },
    { keys: ['rescue_dogs'], captions: ['rescue dog'], attr: 'rescue_dogs' },
    { keys: ['ambulances'], captions: ['ambulance'], attr: 'rtw' },
    { keys: ['police_cars'], captions: ['police car'], attr: 'fustw' },
    { keys: ['firetrucks'], captions: ['fire engine'], attr: 'fire' },
    { keys: ['oneof_police_patrol_or_swat'], captions: ['police cars or armed response vehicles (arvs)', 'police cars or armed response vehicle'], any: ['fustw', 'swat_suv'], group: 'arv' },
    { keys: ['oneof_fire_engine_or_rescue'], captions: ['fire engines or rescue support vehicle'], any: ['fire', 'rw'] },
    { keys: ['oneof_fire_engine_or_rescue_or_ladder'], captions: ['fire engines, rescue support vehicles or aerial appliance truck'], any: ['fire', 'rw', 'dlk'] },
  ];

  // Personnel shortfalls that are covered by sending whole vehicles
  const ARV_REQ = { keys: [], captions: [], attr: 'swat_suv', group: 'arv' };
  const PERSONNEL = [
    { match: /armed response personnel/i, req: ARV_REQ, perVehicle: () => CFG.own.armedPersonnelPerArv, label: 'ARV (armed personnel)' },
  ];
  function personnelEntry(text) {
    const m = text.match(/^(\d+)\s*x?\s+(.+)$/i);
    if (!m) return null;
    const p = PERSONNEL.find((x) => x.match.test(m[2]));
    if (!p) return null;
    return { req: p.req, label: p.label, count: Math.ceil(+m[1] / Math.max(1, p.perVehicle())), personnel: +m[1] };
  }

  const SS_DONE = 'hrlfo_done';
  const LS_TYPES = 'dispatchassist_type_attrs';

  const store = (s) => ({
    get(k, d) { try { const v = s.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { s.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  });
  const ss = store(window.sessionStorage);
  const ls = store(window.localStorage);

  function doneIds() {
    const now = Date.now();
    const all = ss.get(SS_DONE, {});
    const fresh = {};
    for (const [id, t] of Object.entries(all)) if (now - t < CFG.rememberMinutes * 60000) fresh[id] = t;
    ss.set(SS_DONE, fresh);
    return fresh;
  }
  function markDone(id) { const d = doneIds(); d[id] = Date.now(); ss.set(SS_DONE, d); }

  function mainDoc() {
    try {
      if (document.getElementById('mission_list_alliance')) return document;
      if (window.parent && window.parent !== window && window.parent.document.getElementById('mission_list_alliance')) return window.parent.document;
    } catch { /* ignore */ }
    return null;
  }

  function unjoinedAllianceMissions(doc, excludeId) {
    const sel = ['#mission_list_alliance > div[mission_id]'];
    if (CFG.alliance.includePlannedEvents) sel.push('#mission_list_sicherheitswache_alliance > div[mission_id]');
    const done = doneIds();
    return [...doc.querySelectorAll(sel.join(','))].filter((d) => {
      const id = d.getAttribute('mission_id');
      if (!id || id === String(excludeId) || done[id]) return false;
      if (d.classList.contains('mission_deleted')) return false;
      const joined = d.querySelector('[id^="mission_participant_"]:not([id*="_new_"])');
      return !(joined && !joined.classList.contains('hidden'));
    });
  }

  function initMissionPage(missionId) {
    if (!document.getElementById('vehicle_show_table_body_all')) return; // no dispatch list (finished mission etc.)
    learnTypeAttrs();
    const kind = missionKind(missionId);
    if (kind === 'alliance' && CFG.alliance.enabled) initAllianceMission(missionId);
    else if (kind === 'own' && CFG.own.enabled) initOwnMission(missionId);
  }

  function missionKind(id) {
    const doc = mainDoc();
    const row = doc && doc.getElementById('mission_' + id);
    if (row) {
      if (row.closest('#mission_list_alliance, #mission_list_sicherheitswache_alliance, #mission_list_alliance_event')) return 'alliance';
      if (row.closest('#mission_list, #mission_list_krankentransporte, #mission_list_sicherheitswache')) return 'own';
    }
    const h1 = document.getElementById('missionH1');
    return h1 && /\[Alliance\]/i.test(h1.textContent) ? 'alliance' : 'own';
  }

  // ================= Alliance missions: 1 x HRL FO =================
  function initAllianceMission(missionId) {
    if (alreadyJoined(missionId)) { banner('You are already on this mission.', 'info'); return; }
    selectFo(missionId, false);
  }

  function alreadyJoined(id) {
    const doc = mainDoc();
    const icon = doc && doc.getElementById('mission_participant_' + id);
    return !!(icon && !icon.classList.contains('hidden'));
  }

  function findFoRows() {
    const c = CFG.alliance;
    return vehicleRows()
      .filter((tr) => (tr.getAttribute('vehicle_caption') || '').startsWith(c.captionPrefix))
      .filter((tr) => tr.getAttribute('vehicle_type') === c.vehicleType)
      .filter((tr) => withinDistance(tr, c.maxDistanceMiles));
  }

  function selectFo(missionId, triedLoadMore) {
    const ticked = findFoRows().find((tr) => checkbox(tr)?.checked);
    if (ticked) { showFo(ticked, missionId); return; }
    const tr = findFoRows()[0];
    if (tr) { tick(tr); showFo(tr, missionId); return; }
    if (!triedLoadMore && loadMore(() => selectFo(missionId, true))) {
      banner('No HRL FO in the first batch, loading more vehicles…', 'info');
      return;
    }
    banner('No free HRL Fire Officer available for this mission.', 'warn', missionId);
  }

  function showFo(tr, missionId) {
    highlight(tr);
    tr.scrollIntoView({ block: 'center' });
    banner(`Selected <b>${esc(tr.getAttribute('vehicle_caption'))}</b> (${tr.getAttribute('data-distance')} mi).`, 'ok', missionId);
  }

  function skipToNext(missionId) {
    markDone(missionId);
    const doc = mainDoc();
    const next = doc && unjoinedAllianceMissions(doc, missionId)[0];
    if (next) location.href = '/missions/' + next.getAttribute('mission_id');
    else banner('No more unjoined alliance missions.', 'info');
  }

  // ================= Own missions: everything still required =================
  async function initOwnMission(missionId) {
    const needs = await workOutNeeds();
    if (!needs) return;
    if (!needs.list.length && !needs.unknown.length && !needs.notes.length) {
      banner('Nothing missing on this mission.', 'info');
      return;
    }
    fillNeeds(needs, false);
  }

  // Returns { source, list: [{req, label, count}], unknown: [text], notes: [text] }
  async function workOutNeeds() {
    const needs = await requirementNeeds();
    if (needs && CFG.own.enabled && CFG.own.ambulancesForPatients) await addPatientNeeds(needs);
    return needs;
  }

  // Patients: each one needs an ambulance on scene. Patients already "with" an ambulance are covered,
  // and every ambulance still driving to the mission will take one more.
  async function addPatientNeeds(needs) {
    const patients = [...document.querySelectorAll('.mission_patient')];
    if (!patients.length) return;
    const text = (p) => p.textContent.replace(/\$\(function[\s\S]*$/, '').replace(/\s+/g, ' ');

    const ambReq = REQS.find((r) => r.keys.includes('ambulances'));
    const typeAttrs = ls.get(LS_TYPES, {});
    const isAmb = (e) => { const t = +e.getAttribute('vehicle_type_id'); return attrsMatch(t, (a) => (typeAttrs[t] || {})[a], ambReq); };
    const ambDriving = [...document.querySelectorAll('#mission_vehicle_driving tbody tr [vehicle_type_id]')].filter(isAmb).length;
    const ambOnScene = [...document.querySelectorAll('#mission_vehicle_at_mission tbody tr [vehicle_type_id]')].filter(isAmb).length;

    // Sort patients still without an ambulance by what we know about them
    let transportYes = 0; // known to need transport: one ambulance each
    let transportNo = 0;  // known not to need transport: one ambulance can treat several
    let unknown = 0;      // not assessed yet: use the mission's transport probability
    for (const p of patients) {
      const t = text(p);
      if (/Ambulance with the patient:\s*Yes/i.test(t)) continue;
      if (/Requires Transport:\s*Yes/i.test(t)) transportYes++;
      else if (/Requires Transport:\s*No/i.test(t)) transportNo++;
      else unknown++;
    }

    let need;
    let how;
    if (CFG.own.useTransportProbability) {
      const typeId = missionTypeId();
      const mtype = typeId != null ? (await missionTypes())[typeId] : null;
      const prob = mtype && mtype.chances && typeof mtype.chances.patient_transport === 'number' ? mtype.chances.patient_transport : 100;
      const rate = Math.min(1, (prob + CFG.own.transportGracePct) / 100);
      need = transportYes + Math.ceil(unknown * rate);
      // Patients that don't need transport still need one ambulance there to treat them
      if ((transportNo || unknown) && need === 0) need = 1;
      how = unknown ? ` (${prob}% transport chance +${CFG.own.transportGracePct}%)` : '';
    } else {
      need = transportYes + transportNo + unknown;
      how = '';
    }
    // Ambulances on their way cover patients; one on scene already covers the treat-only patients
    need = Math.max(0, need - ambDriving);
    if (!transportYes && !unknown && ambOnScene) need = 0;

    const cap = CFG.own.maxAmbulancesPerClick;
    if (cap && need > cap) {
      needs.notes.push(`${need} ambulances needed for patients, capped at ${cap} this time`);
      need = cap;
    }
    if (need) {
      const existing = needs.list.find((n) => n.req === ambReq);
      if (existing) existing.count = Math.max(existing.count, need);
      else needs.list.push({ req: ambReq, label: 'ambulance (patients)', count: need });
      needs.patientInfo = `${need} ambulance${need === 1 ? '' : 's'} for ${transportYes + transportNo + unknown} patient${transportYes + transportNo + unknown === 1 ? '' : 's'}${how}`;
    }

    // Patients saying "We need: Mass Casualty Equipment": one unit covers the whole incident,
    // so send one unless there is already one on scene or on its way
    const mceReq = REQS.find((r) => r.keys.includes('mass_casualty_equipment'));
    const needsMce = patients.some((p) => [...p.querySelectorAll('.alert')].some((a) => /We need:.*Mass Casualty Equipment/i.test(a.textContent)));
    if (needsMce && !needs.list.some((n) => n.req === mceReq)) {
      const isMce = (e) => { const t = +e.getAttribute('vehicle_type_id'); return attrsMatch(t, (a) => (typeAttrs[t] || {})[a], mceReq); };
      const mceHere = [...document.querySelectorAll('#mission_vehicle_at_mission tbody tr [vehicle_type_id], #mission_vehicle_driving tbody tr [vehicle_type_id]')].some(isMce);
      if (!mceHere) needs.list.push({ req: mceReq, label: 'mass casualty equipment (patients)', count: 1 });
    }

    // Other per-patient needs the script can't fill yet (e.g. Critical Care) get flagged
    const cc = patients.filter((p) => [...p.querySelectorAll('.alert')].some((a) => /We need:.*Critical Care/i.test(a.textContent))).length;
    if (cc) needs.unknown.push(`${cc} × Critical Care (patients)`);
  }


  async function requirementNeeds() {
    const missingBox = document.getElementById('missing_text');
    const vehiclesEl = missingBox && missingBox.querySelector('[data-requirement-type="vehicles"]');
    const notes = [];
    const personnelList = [];
    if (missingBox) {
      missingBox.querySelectorAll('[data-requirement-type]:not([data-requirement-type="vehicles"])').forEach((el) => {
        const full = el.textContent.replace(/\s+/g, ' ').trim();
        if (el.getAttribute('data-requirement-type') !== 'personnel') { notes.push(full); return; }
        const leftover = [];
        full.replace(/^.*?:/, '').trim().split(/,\s*/).forEach((part) => {
          const e = personnelEntry(part.trim());
          if (e) personnelList.push(e);
          else if (part.trim()) leftover.push(part.trim());
        });
        if (leftover.length) notes.push('Missing Personnel: ' + leftover.join(', '));
      });
    }

    // 1) Game already told us what is missing (a unit has arrived on scene)
    if (missingBox && !missingBox.classList.contains('hidden') && (vehiclesEl || notes.length || personnelList.length)) {
      const list = [...personnelList];
      const unknown = [];
      if (vehiclesEl) {
        const text = vehiclesEl.textContent.replace(/\s+/g, ' ').replace(/^.*?:/, '').trim();
        text.split(/,\s*/).forEach((part) => {
          const m = part.match(/^(\d+)\s*x?\s+(.+)$/i);
          if (!m) return;
          const req = findReqByCaption(m[2]);
          if (req) list.push({ req, label: m[2].trim(), count: +m[1] });
          else unknown.push(part.trim());
        });
      }
      // The game's list ignores units that are still driving, so take those off
      subtractDriving(list);
      return { source: 'missing', list, unknown, notes };
    }

    // 2) Something is already on scene but the game says nothing is missing
    if (document.querySelectorAll('#mission_vehicle_at_mission tbody tr').length) return { source: 'missing', list: [], unknown: [], notes };

    // 3) Fresh mission: use the mission type's requirements
    const typeId = missionTypeId();
    if (typeId == null) { banner('Could not work out the mission type.', 'warn'); return null; }
    const mtype = (await missionTypes())[typeId];
    if (!mtype) { banner('Mission type ' + esc(typeId) + ' not found in mission data.', 'warn'); return null; }
    const chances = mtype.chances || {};
    const list = [];
    if (mtype.swatPersonnel) {
      const e = personnelEntry(`${mtype.swatPersonnel} Armed Response Personnel`);
      if (e) list.push(e);
    }
    const unknown = [];
    for (const [key, count] of Object.entries(mtype.requirements || {})) {
      if (!count || typeof count !== 'number') continue;
      if (key in chances && chances[key] < 100 && !CFG.own.includeChanceRequirements) {
        notes.push(`${prettyKey(key)}: ${chances[key]}% chance, not selected`);
        continue;
      }
      const req = REQS.find((r) => r.keys.includes(key));
      if (req) list.push({ req, label: req.captions[0], count });
      else unknown.push(`${count} × ${prettyKey(key)}`);
    }
    // Big incidents: the game will ask for an Ambulance Officer and Mass Casualty Equipment later, so send them now
    const bigMin = CFG.own.largeIncidentMinPatients;
    if (bigMin > 0) {
      const sure = Math.max(mtype.patientsMin || 0, document.querySelectorAll('.mission_patient').length);
      if (sure >= bigMin) {
        for (const key of ['kdow_orgl', 'mass_casualty_equipment']) {
          const req = REQS.find((r) => r.keys.includes(key));
          if (req && !list.some((n) => n.req === req)) list.push({ req, label: `${req.captions[0]} (large incident)`, count: 1 });
        }
      }
    }
    subtractDriving(list);
    return { source: 'fresh', list, unknown, notes };
  }

  function fillNeeds(needs, triedLoadMore) {
    // Order by REQS priority (specific first)
    const ordered = [...needs.list].sort((a, b) => REQS.indexOf(a.req) - REQS.indexOf(b.req));
    const short = [];
    const picked = [];
    const claimed = {}; // group -> Set of rows already counted for another requirement in that group
    for (const n of ordered) {
      const cl = n.req.group ? (claimed[n.req.group] = claimed[n.req.group] || new Set()) : null;
      let have = 0;
      for (const tr of vehicleRows()) {
        if (have >= n.count) break;
        if (!checkbox(tr)?.checked || !matches(tr, n.req) || (cl && cl.has(tr))) continue;
        have += value(tr, n.req);
        if (cl) cl.add(tr);
      }
      if (have >= n.count) continue;
      for (const tr of candidateRows(n.req)) {
        tick(tr);
        highlight(tr);
        if (cl) cl.add(tr);
        picked.push(tr.getAttribute('vehicle_caption'));
        have += value(tr, n.req);
        if (have >= n.count) break;
      }
      if (have < n.count) short.push(`${n.count - have} × ${n.label}`);
    }

    if (short.length && !triedLoadMore && loadMore(() => fillNeeds(needs, true))) {
      banner('Loading more vehicles to fill the gaps…', 'info');
      return;
    }

    const parts = [];
    const ticked = vehicleRows().filter((tr) => checkbox(tr)?.checked).length;
    if (ticked) parts.push(`${needs.source === 'fresh' ? 'Fresh call' : 'Missing units'}: <b>${ticked}</b> vehicle${ticked === 1 ? '' : 's'} selected${needs.patientInfo ? ` (incl. ${needs.patientInfo})` : ''}.`);
    else parts.push('No extra vehicles needed, units already en route cover it.');
    if (short.length) parts.push(`<br>⚠️ Not enough free: ${esc(short.join(', '))}`);
    if (needs.unknown.length) parts.push(`<br>❓ Not handled, pick manually: ${esc(needs.unknown.join(', '))}`);
    if (needs.notes.length) parts.push(`<br>ℹ️ ${esc(needs.notes.join(' · '))}`);
    banner(parts.join(''), short.length || needs.unknown.length ? 'warn' : 'ok', null, true);
  }

  function candidateRows(req) {
    const c = CFG.own;
    return vehicleRows()
      .filter((tr) => !checkbox(tr)?.checked)
      .filter((tr) => matches(tr, req))
      .filter((tr) => !c.excludeCaptionPrefixes.some((p) => (tr.getAttribute('vehicle_caption') || '').startsWith(p)))
      .filter((tr) => withinDistance(tr, c.maxDistanceMiles));
  }

  function matches(tr, req) {
    const cb = checkbox(tr);
    if (!cb) return false;
    return attrsMatch(+cb.getAttribute('vehicle_type_id'), (a) => cb.getAttribute(a), req);
  }

  function attrsMatch(typeId, getAttr, req) {
    if (req.types) return req.types.includes(typeId);
    const has = (a) => { const v = getAttr(a); return v != null && v !== '0' && v !== 'false'; };
    if (req.attr) return has(req.attr);
    if (req.any) return req.any.some(has);
    return false;
  }

  function value(tr, req) {
    if (req.attr && /_value$/.test(req.attr)) return parseFloat(checkbox(tr).getAttribute(req.attr)) || 1;
    return 1;
  }

  // Units already driving to the mission count towards what's needed
  function subtractDriving(list) {
    const typeAttrs = ls.get(LS_TYPES, {});
    const driving = [...document.querySelectorAll('#mission_vehicle_driving tbody tr [vehicle_type_id]')].map((e) => +e.getAttribute('vehicle_type_id'));
    const claimed = {}; // group -> Set of driving-list indexes already counted
    const ordered = [...list].sort((a, b) => REQS.indexOf(a.req) - REQS.indexOf(b.req));
    for (const n of ordered) {
      const cl = n.req.group ? (claimed[n.req.group] = claimed[n.req.group] || new Set()) : null;
      driving.forEach((t, i) => {
        if (n.count <= 0 || (cl && cl.has(i))) return;
        const attrs = typeAttrs[t] || {};
        if (attrsMatch(t, (a) => attrs[a], n.req)) { n.count--; if (cl) cl.add(i); }
      });
      n.count = Math.max(0, n.count);
    }
    for (let i = list.length - 1; i >= 0; i--) if (!list[i].count) list.splice(i, 1);
  }

  // Remember which category flags each vehicle type has (used to recognise units already driving)
  function learnTypeAttrs() {
    const known = ls.get(LS_TYPES, {});
    const skip = new Set(['type', 'value', 'class', 'id', 'name', 'autocomplete', 'building_id', 'fms', 'possible_tractive', 'data-direct', 'data-distance', 'data-equipment-types']);
    let changed = false;
    document.querySelectorAll('#vehicle_show_table_body_all input.vehicle_checkbox').forEach((cb) => {
      const t = cb.getAttribute('vehicle_type_id');
      if (!t || known[t]) return;
      const a = {};
      for (const at of cb.attributes) if (!skip.has(at.name)) a[at.name] = at.value;
      known[t] = a;
      changed = true;
    });
    if (changed) ls.set(LS_TYPES, known);
  }

  function missionTypeId() {
    const doc = mainDoc();
    const row = doc && doc.getElementById('mission_' + location.pathname.match(/\d+/)[0]);
    if (row && row.getAttribute('mission_type_id')) return row.getAttribute('mission_type_id');
    const help = document.querySelector('#mission_help');
    const m = help && (help.getAttribute('href') || '').match(/einsaetze\/(\d+)/);
    return m ? m[1] : null;
  }

  let typesPromise = null;
  function missionTypes() {
    if (!typesPromise) {
      const cached = ls.get('dispatchassist_mission_types_v3', null);
      if (cached && Date.now() - cached.t < 24 * 3600 * 1000) typesPromise = Promise.resolve(cached.d);
      else {
        typesPromise = fetch('/einsaetze.json').then((r) => r.json()).then((arr) => {
          const d = {};
          arr.forEach((m) => {
            const a = m.additional || {};
            d[m.id] = { requirements: m.requirements, chances: m.chances, swatPersonnel: a.swat_personnel || 0, patientsMin: a.possible_patient_min || 0 };
          });
          ls.set('dispatchassist_mission_types_v3', { t: Date.now(), d });
          return d;
        });
      }
    }
    return typesPromise;
  }

  const norm = (s) => String(s).toLowerCase().replace(/^required\s+/, '').replace(/\s+/g, ' ').trim().replace(/s$/, '');
  function findReqByCaption(caption) {
    const c = norm(caption);
    const c2 = norm(caption.replace(/\(.*?\)/g, ''));
    return REQS.find((r) => r.captions.some((x) => norm(x) === c || norm(x) === c2));
  }
  const prettyKey = (k) => k.replace(/^oneof_/, '').replace(/_/g, ' ');

  // ================= Main map page =================
  function initMainPage() {
    if (!CFG.alliance.enabled) return;
    const btn = document.createElement('button');
    btn.id = 'hrlfo-next';
    btn.type = 'button';
    btn.className = 'btn btn-warning btn-sm';
    btn.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:10000;box-shadow:0 2px 6px rgba(0,0,0,.3)';
    btn.title = 'Open the next alliance mission you have not joined';
    document.body.appendChild(btn);
    const refresh = () => {
      const n = unjoinedAllianceMissions(document).length;
      btn.textContent = `HRL FO: next alliance (${n})`;
      btn.disabled = n === 0;
    };
    refresh();
    setInterval(refresh, 3000);
    btn.addEventListener('click', () => {
      const next = unjoinedAllianceMissions(document)[0];
      const link = next && next.querySelector('a.mission-alarm-button');
      if (link) link.click();
    });
  }

  // ================= Shared helpers =================
  function vehicleRows() {
    // Sorted nearest first
    return [...document.querySelectorAll('#vehicle_show_table_body_all tr[vehicle_type]')]
      .sort((a, b) => parseFloat(a.getAttribute('data-distance')) - parseFloat(b.getAttribute('data-distance')));
  }
  const checkbox = (tr) => tr.querySelector('input.vehicle_checkbox');
  function tick(tr) { const cb = checkbox(tr); if (cb && !cb.checked) cb.click(); } // click so the game updates its counters
  function untick(tr) { const cb = checkbox(tr); if (cb && cb.checked) cb.click(); }
  function highlight(tr) { tr.dataset.dispatchAssist = '1'; tr.style.outline = '2px solid #f0ad4e'; tr.style.background = 'rgba(240,173,78,.18)'; }
  function withinDistance(tr, max) {
    const d = parseFloat(tr.getAttribute('data-distance'));
    return !max || (!isNaN(d) && d <= max);
  }

  // Click the game's "load more vehicles" link once, then run cb when the list grows
  function loadMore(cb) {
    const more = document.querySelector('a.missing_vehicles_load');
    const body = document.getElementById('vehicle_show_table_body_all');
    if (!more || !body) return false;
    const obs = new MutationObserver(() => { obs.disconnect(); setTimeout(cb, 300); });
    obs.observe(body, { childList: true });
    setTimeout(() => obs.disconnect(), 15000);
    more.click();
    return true;
  }

  function banner(html, kind, allianceMissionId, withUndo) {
    let el = document.getElementById('hrlfo-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hrlfo-banner';
      el.style.cssText = 'position:sticky;top:0;z-index:9999;padding:6px 10px;margin:0 0 6px;font-size:13px;border-radius:4px;display:flex;gap:8px;align-items:center;flex-wrap:wrap';
      const anchor = document.getElementById('missionH1') || document.body.firstElementChild;
      anchor.parentNode.insertBefore(el, anchor);
    }
    const colours = { ok: ['#dff0d8', '#3c763d'], info: ['#d9edf7', '#31708f'], warn: ['#fcf8e3', '#8a6d3b'] }[kind] || ['#eee', '#333'];
    el.style.background = colours[0];
    el.style.color = colours[1];
    el.innerHTML = `<span>🚒 ${html}</span>`;
    if (allianceMissionId) {
      el.appendChild(button('Skip → next alliance', () => skipToNext(allianceMissionId)));
    }
    if (withUndo) {
      el.appendChild(button('Clear selection', () => {
        document.querySelectorAll('#vehicle_show_table_body_all tr[data-dispatch-assist]').forEach((tr) => {
          untick(tr); tr.style.outline = ''; tr.style.background = ''; delete tr.dataset.dispatchAssist;
        });
        el.remove();
      }));
    }
  }

  function button(text, onclick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-default btn-xs';
    b.textContent = text;
    b.onclick = onclick;
    return b;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ================= Start (kept last so everything above is defined) =================
  const missionMatch = location.pathname.match(/^\/missions\/(\d+)/);
  if (missionMatch) initMissionPage(missionMatch[1]);
  else if (document.getElementById('mission_list_alliance')) initMainPage();
})();
