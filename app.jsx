// contact-verifier frontend — talks to the Node backend at API_BASE.
const { useState, useEffect, useCallback, useRef, useMemo } = React;

const DEFAULT_API_BASE = localStorage.getItem('cv_api_base') || 'http://localhost:3001';

const SAMPLE_CONTACTS = [
  { name:"Sarah Johnson",    type:"realtor", phone:"312-555-0101", email:"sarah.johnson@realty.com",   address:"123 Main St, Chicago, IL 60601",    company:"Chicago Premier Realty" },
  { name:"Michael Torres",   type:"lawyer",  phone:"312-555-0202", email:"m.torres@torreslaw.com",     address:"456 Oak Ave, Evanston, IL 60201",   company:"Torres Law Group" },
  { name:"Jennifer Park",    type:"realtor", phone:"847-555-0303", email:"jpark@northshoreprops.net",  address:"789 Elm Blvd, Wilmette, IL 60091",  company:"North Shore Properties" },
  { name:"David Chen",       type:"lawyer",  phone:"312-555-0404", email:"dchen@chenlegalservices.com",address:"321 Lake St, Chicago, IL 60614",    company:"Chen Legal Services" },
  { name:"Amanda Williams",  type:"realtor", phone:"847-555-0505", email:"awilliams@lakeforestlux.com",address:"555 Forest Rd, Lake Forest, IL 60045", company:"Lake Forest Luxury Homes" },
  { name:"Robert Martinez",  type:"lawyer",  phone:"312-555-0606", email:"rmartinez@martinezlaw.net",  address:"100 N Clark, Chicago, IL 60602",    company:"Martinez & Associates" },
];

const KNOWN_COLS = ["name","type","phone","email","address","company","license","notes"];

function mkId() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function initials(name) {
  const parts = String(name||"").trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0]||"")+(parts[parts.length-1][0]||"");
  return (parts[0]||"").slice(0,2).toUpperCase();
}
function avatarColor(name) {
  const COLORS = ["#1b2b4b","#2d7a4f","#b8932f","#2563eb","#7c3aed","#0e7490","#c0392b","#d4851a"];
  let h = 0; for (let i=0;i<name.length;i++) h = name.charCodeAt(i) + ((h<<5)-h);
  return COLORS[Math.abs(h) % COLORS.length];
}

/* ══════════════════════════════════════════════════════════════
   API CLIENT
══════════════════════════════════════════════════════════════ */
function apiClient(base) {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('cv_api_token');
  if (token) headers.Authorization = `Bearer ${token}`;

  return {
    async health() {
      const r = await fetch(`${base}/api/health`, { headers });
      if (!r.ok) throw new Error(`API ${r.status}`);
      return r.json();
    },
    async verify(contact, opts = {}) {
      const r = await fetch(`${base}/api/verify`, {
        method:'POST', headers, body: JSON.stringify({ contact, ...opts }),
      });
      if (!r.ok) throw new Error(`Verify failed (${r.status})`);
      return r.json();
    },
    async batch(contacts, options = {}) {
      const r = await fetch(`${base}/api/verify/batch`, {
        method:'POST', headers, body: JSON.stringify({ contacts, options }),
      });
      if (!r.ok) throw new Error(`Batch failed (${r.status})`);
      return r.json();
    },
    async batchStatus(jobId) {
      const r = await fetch(`${base}/api/verify/${jobId}`, { headers });
      if (!r.ok) throw new Error(`Status failed (${r.status})`);
      return r.json();
    },
  };
}

/* ══════════════════════════════════════════════════════════════
   CSV
══════════════════════════════════════════════════════════════ */
function parseCSV(text) {
  const r = Papa.parse(text.trim(), { header:true, skipEmptyLines:true, transformHeader:h=>h.trim().toLowerCase() });
  if (!r.data?.length) throw new Error("CSV has no rows.");
  if (!r.meta.fields.includes("name")) throw new Error("CSV must have a 'name' column.");
  return r.data.map(row => {
    const c = {};
    KNOWN_COLS.forEach(k => { c[k] = String(row[k]||"").trim(); });
    if (!["realtor","lawyer"].includes((c.type||"").toLowerCase())) c.type = "realtor";
    else c.type = c.type.toLowerCase();
    c.id = mkId();
    return c;
  }).filter(c => c.name);
}

function exportCSV(rows) {
  const cols = ["name","type","originalCompany","verifiedCompany","originalEmail","verifiedEmail",
                "originalPhone","verifiedPhone","originalAddress","verifiedAddress",
                "title","linkedinUrl","photoUrl","instagram","facebook","twitter",
                "overallStatus","confidence","autoUpdateFields","reviewFields","sources","changes","timestamp"];
  const out = [cols.join(",")];
  rows.forEach(r => {
    const c = r.input || r;
    const v = r.result?.verified || {};
    const changes = (r.result?.changes || []).map(ch => `${ch.field}:${ch.from}→${ch.to}`).join("; ");
    const line = [
      c.name, c.type,
      c.company, v.company||"",
      c.email, v.email||"",
      c.phone, v.phone||"",
      c.address, v.address||"",
      v.title||"",
      v.linkedinUrl||"", v.photoUrl||"",
      v.social?.instagram||"", v.social?.facebook||"", v.social?.twitter||"",
      r.result?.overall||"pending",
      r.result?.confidence!=null ? r.result.confidence : "",
      (r.result?.autoUpdate||[]).join("; "),
      (r.result?.manualReview||[]).join("; "),
      (r.result?.sources||[]).join("; "),
      changes,
      r.result?.timestamp||"",
    ].map(s => JSON.stringify(String(s||"")));
    out.push(line.join(","));
  });
  const blob = new Blob([out.join("\n")], { type:"text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `contact-verification-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

function downloadSampleCSV() {
  const header = "name,type,phone,email,address,company";
  const rows = SAMPLE_CONTACTS.map(c => [c.name,c.type,c.phone,c.email,c.address,c.company].map(s=>JSON.stringify(s)).join(","));
  const blob = new Blob([[header,...rows].join("\n")], { type:"text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "sample-contacts.csv";
  a.click();
}

/* ══════════════════════════════════════════════════════════════
   COMPONENTS
══════════════════════════════════════════════════════════════ */
function Toast({ msg, type="info", onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, []);
  return <div className={`toast ${type}`}>{msg}</div>;
}

function Avatar({ name, photoUrl, size=40 }) {
  const [err, setErr] = useState(false);
  const url = err ? null : photoUrl;
  return (
    <div className="photo-cell" style={{width:size,height:size}}>
      {url
        ? <img src={url} alt={name} onError={()=>setErr(true)} referrerPolicy="no-referrer" />
        : <span style={{background:avatarColor(name||''),width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:size*.34,fontWeight:700}}>{initials(name||'')}</span>}
    </div>
  );
}

function StatusBadge({ status }) {
  const M = {
    verified:   { label:"✓ Verified",   cls:"verified" },
    partial:    { label:"◐ Partial",    cls:"partial" },
    changed:    { label:"↻ Company Change", cls:"changed" },
    "not-found":{ label:"✗ Not Found",  cls:"not-found" },
    pending:    { label:"⋯ Pending",    cls:"pending" },
    error:      { label:"! Error",       cls:"error" },
  };
  const s = M[status] || M.pending;
  return <span className={`status-badge ${s.cls}`}>{s.label}</span>;
}

function ConnectionCard({ apiBase, onChange, health, healthErr, onRecheck }) {
  const [base, setBase] = useState(apiBase);
  const [token, setToken] = useState(localStorage.getItem('cv_api_token') || '');
  const sources = health?.sources || {};
  const hasAny = Object.values(sources).some(Boolean);
  return (
    <div className="card">
      <div className="card-title">🔌 Backend Connection</div>
      <div className="wiz-field">
        <label>API Base URL</label>
        <input value={base} onChange={e=>setBase(e.target.value)} placeholder="http://localhost:3001" />
      </div>
      <div className="wiz-field">
        <label>Auth Token (optional)</label>
        <input value={token} onChange={e=>setToken(e.target.value)} placeholder="Bearer token if API_AUTH_TOKEN is set" type="password" />
      </div>
      <div style={{display:'flex',gap:8,marginBottom:14}}>
        <button className="btn btn-primary" onClick={()=>{
          localStorage.setItem('cv_api_base', base);
          if (token) localStorage.setItem('cv_api_token', token); else localStorage.removeItem('cv_api_token');
          onChange(base);
        }}>Save & Reconnect</button>
        <button className="btn btn-ghost" onClick={onRecheck}>Recheck</button>
      </div>

      {healthErr && (
        <div className="alert alert-err">
          <strong>Cannot reach {apiBase}</strong><br/>
          {healthErr}<br/>
          <span style={{fontSize:'.75rem',opacity:.8}}>Run <code>cd server && npm install && npm start</code> to start the API.</span>
        </div>
      )}
      {!healthErr && health && (
        <>
          <div className={`alert ${hasAny ? 'alert-ok' : 'alert-warn'}`} style={{marginBottom:12}}>
            {hasAny
              ? <><strong>✓ Connected.</strong> {Object.values(sources).filter(Boolean).length} of {Object.keys(sources).length} sources active.</>
              : <><strong>⚠ Connected but no API keys configured.</strong> Verification will only try free sources (website scrape + Gravatar). Add keys to <code>server/.env</code>.</>
            }
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:8,fontSize:'.82rem'}}>
            {Object.entries(sources).map(([k,v]) => (
              <div key={k} style={{padding:'6px 10px',background:'var(--cream)',borderRadius:6}}>
                <span className={`src-dot ${v?'on':'off'}`}></span>{k}
              </div>
            ))}
          </div>
          {health.cache && <div style={{fontSize:'.75rem',color:'var(--muted)',marginTop:10}}>Cache: {health.cache.total} records stored (reused if &lt; 30 days old)</div>}
        </>
      )}
    </div>
  );
}

function UploadCard({ onLoad }) {
  const fileRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  function handleFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const contacts = parseCSV(e.target.result);
        onLoad(contacts);
      } catch (err) { alert(err.message); }
    };
    reader.readAsText(file);
  }

  return (
    <div className="card">
      <div className="card-title">📥 Upload Contacts</div>
      <div className={`upload-zone ${dragOver?'dragover':''}`}
           onClick={()=>fileRef.current?.click()}
           onDragOver={e=>{e.preventDefault();setDragOver(true);}}
           onDragLeave={()=>setDragOver(false)}
           onDrop={e=>{e.preventDefault();setDragOver(false); const f=e.dataTransfer.files[0]; if(f) handleFile(f);}}>
        <div style={{fontSize:'2rem',marginBottom:8}}>📄</div>
        <div className="upload-title">Drop CSV here or click to upload</div>
        <div className="upload-hint">Required column: <code>name</code>. Optional: type, phone, email, address, company</div>
        <input ref={fileRef} type="file" accept=".csv" style={{display:'none'}} onChange={e=>e.target.files[0] && handleFile(e.target.files[0])} />
      </div>
      <div style={{display:'flex',gap:8,marginTop:12,flexWrap:'wrap'}}>
        <button className="btn btn-ghost" onClick={downloadSampleCSV}>Download sample CSV</button>
        <button className="btn btn-ghost" onClick={()=>onLoad(SAMPLE_CONTACTS.map(c=>({...c,id:mkId()})))}>Load 6 sample contacts</button>
      </div>
    </div>
  );
}

function ResultsTable({ contacts, results, onSelect, filter }) {
  const rows = contacts.map(c => ({ contact: c, result: results[c.id] || null }));
  const filtered = rows.filter(r => {
    if (filter.status !== 'all' && (r.result?.overall || 'pending') !== filter.status) return false;
    if (filter.q) {
      const q = filter.q.toLowerCase();
      if (![r.contact.name, r.contact.company, r.contact.email, r.contact.phone].join(' ').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  if (!rows.length) return (
    <div className="card" style={{textAlign:'center',padding:'40px 24px',color:'var(--muted)'}}>
      No contacts loaded yet.
    </div>
  );

  return (
    <div className="card" style={{padding:'0',overflow:'hidden'}}>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th style={{width:48}}></th>
              <th>Name</th>
              <th>Type</th>
              <th>Company (on record)</th>
              <th>Verified Company</th>
              <th>Status</th>
              <th>Confidence</th>
              <th>Sources</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({contact, result}) => {
              const v = result?.verified || {};
              const overall = result?.overall || 'pending';
              const changed = v.company && contact.company && v.company !== contact.company;
              return (
                <tr key={contact.id} onClick={()=>onSelect(contact.id)}>
                  <td><Avatar name={contact.name} photoUrl={v.photoUrl} /></td>
                  <td className="td-name">{contact.name}</td>
                  <td><span className={`td-type ${contact.type}`}>{contact.type}</span></td>
                  <td className="td-muted">{contact.company || '—'}</td>
                  <td style={{color: changed ? 'var(--red)' : 'var(--ink)', fontWeight: changed ? 600 : 400}}>
                    {v.company || '—'}
                  </td>
                  <td><StatusBadge status={overall} /></td>
                  <td style={{color:'var(--muted)',fontSize:'.8rem'}}>
                    {result?.confidence != null ? `${result.confidence}%` : '—'}
                  </td>
                  <td>{(result?.sources || []).map(s => <span key={s} className="src-tag">{s}</span>)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DetailPanel({ contact, result, onClose, onReverify }) {
  const v = result?.verified || {};
  const audit = result?.fieldAudit || {};

  const fields = [
    { key:'company', label:'Company' },
    { key:'title',   label:'Title' },
    { key:'phone',   label:'Phone' },
    { key:'email',   label:'Email' },
    { key:'address', label:'Address' },
  ];

  return (
    <div className="detail-overlay" onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div className="detail-panel si">
        <div className="detail-head">
          <div className="detail-photo">
            {v.photoUrl
              ? <img src={v.photoUrl} alt={contact.name} referrerPolicy="no-referrer" />
              : <span style={{background:avatarColor(contact.name),width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff'}}>{initials(contact.name)}</span>}
          </div>
          <div style={{flex:1}}>
            <div className="detail-name">{contact.name}</div>
            <div className="detail-role">{contact.type === 'lawyer' ? 'Attorney' : 'Realtor'}{v.company ? ` · ${v.company}` : (contact.company ? ` · ${contact.company}`:'')}</div>
            <div style={{marginTop:6,display:'flex',gap:6,flexWrap:'wrap'}}>
              <StatusBadge status={result?.overall || 'pending'} />
              {result?.confidence != null && <span style={{fontSize:'.75rem',color:'var(--muted)'}}>{result.confidence}% confidence</span>}
            </div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} style={{padding:'6px 12px'}}>✕</button>
        </div>

        {!result && <div style={{color:'var(--muted)',padding:'20px 0'}}>Not yet verified. Run verification to see results.</div>}

        {result && (
          <>
            <div className="compare-grid">
              <div className="cg-h">Field</div>
              <div className="cg-h">On Record</div>
              <div className="cg-h">Verified</div>
              <div className="cg-h">Action</div>
              {fields.map(f => {
                const orig = contact[f.key] || '';
                const verified = v[f.key] || '';
                const conf = audit[f.key]?.confidence;
                const sources = audit[f.key]?.sources || [];
                const changed = orig && verified && orig.toLowerCase() !== verified.toLowerCase();
                const newVal = !orig && verified;
                let action = '—', cls = 'same';
                if (result.autoUpdate?.includes(f.key)) { action = 'Auto-update'; cls='updated'; }
                else if (result.manualReview?.includes(f.key)) { action = 'Review'; cls='review'; }
                return (
                  <div key={f.key} className="cg-row">
                    <div className="cg-field">{f.label}</div>
                    <div className="cg-val same">{orig || <span style={{opacity:.4}}>—</span>}</div>
                    <div className={`cg-val ${cls}`}>
                      {verified || <span style={{opacity:.4}}>—</span>}
                      {conf != null && <div style={{fontSize:'.7rem',color:'var(--muted)',marginTop:2}}>
                        {conf}% · {sources.join(', ')}
                      </div>}
                    </div>
                    <div className="cg-conf">{action}</div>
                  </div>
                );
              })}
            </div>

            {(v.linkedinUrl || v.social || v.photoUrl) && (
              <div style={{marginTop:20,paddingTop:16,borderTop:'1px solid var(--rule)'}}>
                <div style={{fontSize:'.7rem',fontWeight:700,letterSpacing:'.12em',textTransform:'uppercase',color:'var(--muted)',marginBottom:10}}>Profiles & Links</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:8,fontSize:'.82rem'}}>
                  {v.linkedinUrl && <a href={v.linkedinUrl} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{fontSize:'.75rem'}}>LinkedIn ↗</a>}
                  {v.social?.instagram && <a href={v.social.instagram} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{fontSize:'.75rem'}}>Instagram ↗</a>}
                  {v.social?.facebook && <a href={v.social.facebook} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{fontSize:'.75rem'}}>Facebook ↗</a>}
                  {v.social?.twitter && <a href={v.social.twitter} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{fontSize:'.75rem'}}>Twitter ↗</a>}
                </div>
              </div>
            )}

            {result.changes?.length > 0 && (
              <div style={{marginTop:20,paddingTop:16,borderTop:'1px solid var(--rule)'}}>
                <div style={{fontSize:'.7rem',fontWeight:700,letterSpacing:'.12em',textTransform:'uppercase',color:'var(--muted)',marginBottom:10}}>Detected Changes</div>
                {result.changes.map((ch, i) => (
                  <div key={i} style={{fontSize:'.82rem',marginBottom:6}}>
                    <strong style={{textTransform:'capitalize'}}>{ch.field}:</strong> <span style={{color:'var(--red)',textDecoration:'line-through'}}>{ch.from}</span> → <span style={{color:'var(--green)',fontWeight:600}}>{ch.to}</span>
                    <span style={{marginLeft:6,fontSize:'.72rem',color:'var(--muted)'}}>({ch.source}, {ch.confidence}%)</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div style={{display:'flex',gap:8,marginTop:24}}>
          <button className="btn btn-primary" onClick={()=>onReverify(contact, true)}>
            {result ? 'Re-verify (skip cache)' : 'Verify Now'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   APP
══════════════════════════════════════════════════════════════ */
function App() {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [health, setHealth] = useState(null);
  const [healthErr, setHealthErr] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [results, setResults] = useState({});  // { contactId: verificationResult }
  const [selectedId, setSelectedId] = useState(null);
  const [toast, setToast] = useState(null);
  const [batch, setBatch] = useState(null); // { jobId, progress, total, status }
  const [filter, setFilter] = useState({ status:'all', q:'' });
  const api = useMemo(() => apiClient(apiBase), [apiBase]);

  const checkHealth = useCallback(async () => {
    setHealthErr(null);
    try {
      const h = await api.health();
      setHealth(h);
    } catch (e) {
      setHealth(null);
      setHealthErr(String(e.message || e));
    }
  }, [api]);

  useEffect(() => { checkHealth(); }, [checkHealth]);

  // Batch polling
  useEffect(() => {
    if (!batch?.id || batch.status === 'done' || batch.status === 'failed') return;
    const t = setInterval(async () => {
      try {
        const status = await api.batchStatus(batch.id);
        setBatch(b => ({ ...b, progress: status.progress, total: status.total, status: status.status }));
        // merge results as they arrive
        setResults(prev => {
          const next = { ...prev };
          for (const { input, result } of status.results) {
            const c = contacts.find(x => x.name === input.name && x.company === input.company);
            if (c) next[c.id] = result;
          }
          return next;
        });
        if (status.status === 'done' || status.status === 'failed') {
          clearInterval(t);
          setToast({ msg: `Batch ${status.status} (${status.progress}/${status.total})`, type: status.status==='done'?'success':'error' });
        }
      } catch (e) { clearInterval(t); }
    }, 2000);
    return () => clearInterval(t);
  }, [batch?.id, batch?.status, api, contacts]);

  async function verifyOne(contact, skipCache=false) {
    try {
      setResults(p => ({ ...p, [contact.id]: { overall:'pending' } }));
      const r = await api.verify(contact, { skipCache });
      setResults(p => ({ ...p, [contact.id]: r }));
      return r;
    } catch (e) {
      setResults(p => ({ ...p, [contact.id]: { overall:'error', error: String(e.message||e) } }));
      setToast({ msg: `Verify failed: ${e.message}`, type:'error' });
    }
  }

  async function verifyAll() {
    if (!contacts.length) return;
    try {
      const pending = contacts.filter(c => !results[c.id] || results[c.id].overall === 'error' || results[c.id].overall === 'pending');
      if (!pending.length) { setToast({ msg: 'All contacts already verified. Use detail panel to re-verify.', type:'info' }); return; }
      const job = await api.batch(pending, { concurrency: 3 });
      setBatch({ id: job.jobId || job.id, progress: 0, total: pending.length, status: 'running' });
      pending.forEach(c => setResults(p => ({ ...p, [c.id]: { overall:'pending' } })));
      setToast({ msg: `Batch started: ${pending.length} contacts`, type:'info' });
    } catch (e) {
      setToast({ msg: `Batch failed: ${e.message}`, type:'error' });
    }
  }

  const selected = contacts.find(c => c.id === selectedId);

  const stats = useMemo(() => {
    const s = { total: contacts.length, verified:0, partial:0, changed:0, notFound:0, pending:0 };
    for (const c of contacts) {
      const st = results[c.id]?.overall;
      if (st === 'verified') s.verified++;
      else if (st === 'partial') s.partial++;
      else if (st === 'changed') s.changed++;
      else if (st === 'not-found') s.notFound++;
      else s.pending++;
    }
    return s;
  }, [contacts, results]);

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-brand">
          📇 Contact Verifier
          <span className="topbar-sub">Realtor · Lawyer · DB Migration</span>
        </div>
        <div className="topbar-right">
          <span style={{fontSize:'.75rem',opacity:.7}}>{contacts.length} loaded</span>
        </div>
      </div>

      <div className="main">
        <ConnectionCard apiBase={apiBase} onChange={setApiBase} health={health} healthErr={healthErr} onRecheck={checkHealth} />

        <UploadCard onLoad={loaded => {
          setContacts(loaded);
          setResults({});
          setToast({ msg:`Loaded ${loaded.length} contacts`, type:'success' });
        }} />

        {contacts.length > 0 && (
          <>
            <div className="stats-row">
              <div className="stat-box"><div className="stat-num">{stats.total}</div><div className="stat-lbl">Loaded</div></div>
              <div className="stat-box green"><div className="stat-num">{stats.verified}</div><div className="stat-lbl">Verified</div></div>
              <div className="stat-box amber"><div className="stat-num">{stats.partial}</div><div className="stat-lbl">Partial</div></div>
              <div className="stat-box blue"><div className="stat-num">{stats.changed}</div><div className="stat-lbl">Company Changed</div></div>
              <div className="stat-box red"><div className="stat-num">{stats.notFound}</div><div className="stat-lbl">Not Found</div></div>
              <div className="stat-box"><div className="stat-num">{stats.pending}</div><div className="stat-lbl">Pending</div></div>
            </div>

            {batch && batch.status !== 'done' && (
              <div className="card">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:6}}>
                  <strong>Batch running…</strong>
                  <span style={{fontSize:'.8rem',color:'var(--muted)'}}>{batch.progress} / {batch.total}</span>
                </div>
                <div className="prog-bar-wrap">
                  <div className="prog-bar" style={{width: `${(batch.progress/batch.total)*100}%`}} />
                </div>
              </div>
            )}

            <div className="card" style={{paddingBottom:0}}>
              <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center',marginBottom:12}}>
                <button className="btn btn-primary" onClick={verifyAll} disabled={!!batch && batch.status!=='done'}>
                  {batch && batch.status!=='done' ? <>⟳ Running…</> : '▶ Verify All'}
                </button>
                <button className="btn btn-gold" onClick={()=>exportCSV(contacts.map(c => ({ input: c, result: results[c.id] })))}>
                  ⬇ Export CSV
                </button>
                <div style={{flex:1}}></div>
                <input placeholder="Search name, company, email…" value={filter.q} onChange={e=>setFilter(f=>({...f,q:e.target.value}))}
                       style={{padding:'8px 12px',border:'1px solid var(--rule)',borderRadius:6,fontSize:'.82rem',background:'var(--cream)',minWidth:200}} />
                <select value={filter.status} onChange={e=>setFilter(f=>({...f,status:e.target.value}))}
                        style={{padding:'8px 12px',border:'1px solid var(--rule)',borderRadius:6,fontSize:'.82rem',background:'var(--cream)'}}>
                  <option value="all">All statuses</option>
                  <option value="verified">Verified</option>
                  <option value="partial">Partial</option>
                  <option value="changed">Company Changed</option>
                  <option value="not-found">Not Found</option>
                  <option value="pending">Pending</option>
                </select>
              </div>
            </div>

            <ResultsTable contacts={contacts} results={results} onSelect={setSelectedId} filter={filter} />
          </>
        )}
      </div>

      {selected && (
        <DetailPanel
          contact={selected}
          result={results[selected.id]}
          onClose={()=>setSelectedId(null)}
          onReverify={(c, skipCache) => { verifyOne(c, skipCache); }}
        />
      )}
      {toast && <Toast msg={toast.msg} type={toast.type} onDone={()=>setToast(null)} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
