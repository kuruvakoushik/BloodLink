// Small REST API using Node's built-in HTTP server. SQL is parameterized throughout.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const { pool } = require('./database');
const { send } = require('./utils/responses');
const { GROUPS, text, validEmail, validPhone, validDate } = require('./utils/validation');
const { authenticate, admin } = require('./middleware/auth');
const ROOT = path.resolve(__dirname, '..');
const COOKIE = 'bloodlink_session';
const DAY = 86400000;

async function body(req) {
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 100000) throw Object.assign(new Error('Request body is too large.'), { status: 413 }); }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 }); }
}
function fail(res, status, message) { send(res, status, { error: message }); }
function cookieHeader(token, maxAge) {
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`;
}
async function pwHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }); return `${salt}:${derived.toString('hex')}`;
}
async function pwMatches(password, stored) {
  const [salt, hash] = (stored || '').split(':'); if (!salt || !hash) return false;
  const actual = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return actual.length === Buffer.from(hash, 'hex').length && crypto.timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
function only(res, user, ownerId) { if (user.id !== ownerId && user.role !== 'admin') { fail(res, 403, 'You can only change your own information.'); return false; } return true; }
function pickDate(d) { return d && validDate(d) ? d : null; }
async function route(req, res, url) {
  const p = url.pathname, method = req.method;
  if (p === '/api/health' && method === 'GET') {
    await pool.query('SELECT 1'); return send(res, 200, { ok: true, database: 'connected' });
  }
  if (p === '/api/stats' && method === 'GET') {
    const r = await pool.query("SELECT (SELECT count(*)::int FROM donor_profiles WHERE is_active AND is_available) AS donors, (SELECT count(*)::int FROM blood_requests WHERE status IN ('open','in_progress')) AS requests, (SELECT count(*)::int FROM users)::int AS members");
    return send(res, 200, r.rows[0]);
  }
  if (p === '/api/auth/register' && method === 'POST') {
    const b = await body(req), name = text(b.fullName,120), email = text(b.email,254).toLowerCase(), phone = text(b.phone,20), city = text(b.city,100), state = text(b.state,100);
    if (!name || !validEmail(email) || !validPhone(phone) || !city || !state || typeof b.password !== 'string' || b.password.length < 10 || b.password.length > 128) return fail(res,400,'Enter all fields and use a password with at least 10 characters.');
    const hash = await pwHash(b.password);
    try {
      const r = await pool.query('INSERT INTO users(full_name,email,phone,password_hash,city,state) VALUES($1,$2,$3,$4,$5,$6) RETURNING id', [name,email,phone,hash,city,state]);
      const token = crypto.randomBytes(32).toString('base64url'), tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const days = Math.max(1, Number(process.env.SESSION_DAYS) || 7);
      await pool.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+($3 * interval \'1 day\'))',[tokenHash,r.rows[0].id,days]);
      return send(res,201,{message:'Account created. Welcome to BloodLink.'},{'Set-Cookie':cookieHeader(token,days*86400)});
    } catch(e) { if(e.code==='23505') return fail(res,409,'An account with this email already exists.'); throw e; }
  }
  if (p === '/api/auth/login' && method === 'POST') {
    const b=await body(req), email=text(b.email,254).toLowerCase();
    const r=await pool.query('SELECT id,password_hash FROM users WHERE email=$1',[email]);
    if (!r.rowCount || !await pwMatches(b.password || '',r.rows[0].password_hash)) return fail(res,401,'Email or password is incorrect.');
    const token=crypto.randomBytes(32).toString('base64url'), hash=crypto.createHash('sha256').update(token).digest('hex'), days=Math.max(1,Number(process.env.SESSION_DAYS)||7);
    await pool.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+($3 * interval \'1 day\'))',[hash,r.rows[0].id,days]);
    return send(res,200,{message:'Signed in successfully.'},{'Set-Cookie':cookieHeader(token,days*86400)});
  }
  if (p === '/api/auth/logout' && method === 'POST') {
    const token=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
    if(token) await pool.query('DELETE FROM sessions WHERE token_hash=$1',[crypto.createHash('sha256').update(decodeURIComponent(token)).digest('hex')]);
    return send(res,200,{message:'You have been signed out.'},{'Set-Cookie':cookieHeader('',0)});
  }
  if(p==='/api/auth/me' && method==='GET') { const u=await authenticate(req,res); if(!u)return; return send(res,200,{user:u}); }

  if(p==='/api/donors' && method==='GET') {
    const group=url.searchParams.get('bloodGroup'), state=text(url.searchParams.get('state'),100), city=text(url.searchParams.get('city'),100);
    if(group && !GROUPS.includes(group)) return fail(res,400,'Choose a valid blood group.');
    const r=await pool.query("SELECT d.id,d.blood_group,d.city,d.state,d.contact_preference,d.user_id,u.full_name, CASE WHEN d.contact_preference='phone' THEN u.phone ELSE NULL END AS phone FROM donor_profiles d JOIN users u ON u.id=d.user_id WHERE d.is_active=true AND d.is_available=true AND ($1::text IS NULL OR d.blood_group=$1) AND ($2='' OR lower(d.state)=lower($2)) AND ($3='' OR lower(d.city)=lower($3)) ORDER BY d.updated_at DESC LIMIT 100",[group||null,state,city]);
    return send(res,200,{donors:r.rows.map(({user_id,...d})=>d)});
  }
  if(p==='/api/donors' && method==='POST') {
    const u=await authenticate(req,res); if(!u)return; const b=await body(req);
    if(!GROUPS.includes(b.bloodGroup)||!Number.isInteger(Number(b.age))||Number(b.age)<18||Number(b.age)>100||!text(b.city,100)||!text(b.state,100)||!['enquiry','phone','hidden'].includes(b.contactPreference||'enquiry')) return fail(res,400,'Check the blood group, age (18–100), location, and contact preference.');
    if(b.lastDonationDate && !validDate(b.lastDonationDate))return fail(res,400,'Enter a valid last donation date.');
    const r=await pool.query('INSERT INTO donor_profiles(user_id,blood_group,age,gender,city,state,last_donation_date,is_available,contact_preference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(user_id) DO UPDATE SET blood_group=EXCLUDED.blood_group,age=EXCLUDED.age,gender=EXCLUDED.gender,city=EXCLUDED.city,state=EXCLUDED.state,last_donation_date=EXCLUDED.last_donation_date,is_available=EXCLUDED.is_available,contact_preference=EXCLUDED.contact_preference,is_active=true,updated_at=now() RETURNING id',[u.id,b.bloodGroup,Number(b.age),text(b.gender,30)||null,text(b.city,100),text(b.state,100),pickDate(b.lastDonationDate),b.isAvailable!==false,b.contactPreference||'enquiry']);
    return send(res,201,{id:r.rows[0].id,message:'Donor profile saved.'});
  }
  let m=p.match(/^\/api\/donors\/([\w-]+)$/);
  if(m && method==='GET') { const r=await pool.query("SELECT d.id,d.blood_group,d.city,d.state,d.contact_preference,u.full_name,CASE WHEN d.contact_preference='phone' THEN u.phone ELSE NULL END AS phone FROM donor_profiles d JOIN users u ON u.id=d.user_id WHERE d.id=$1 AND d.is_active AND d.is_available",[m[1]]); return r.rowCount?send(res,200,{donor:r.rows[0]}):fail(res,404,'Available donor not found.'); }
  if(m && ['PUT','DELETE'].includes(method)) {
    const u=await authenticate(req,res); if(!u)return; const cur=await pool.query('SELECT user_id FROM donor_profiles WHERE id=$1',[m[1]]); if(!cur.rowCount)return fail(res,404,'Donor profile not found.'); if(!only(res,u,cur.rows[0].user_id))return;
    if(method==='DELETE'){await pool.query('DELETE FROM donor_profiles WHERE id=$1',[m[1]]);return send(res,200,{message:'Donor profile removed.'});}
    const b=await body(req); if(b.isAvailable!==undefined && typeof b.isAvailable!=='boolean')return fail(res,400,'Availability must be true or false.');if(b.bloodGroup!==undefined&&!GROUPS.includes(b.bloodGroup))return fail(res,400,'Choose a valid blood group.');if(b.contactPreference!==undefined&&!['enquiry','phone','hidden'].includes(b.contactPreference))return fail(res,400,'Choose a valid contact preference.');if((b.city!==undefined&&!text(b.city,100))||(b.state!==undefined&&!text(b.state,100)))return fail(res,400,'Enter a valid city and state.');
    const r=await pool.query("UPDATE donor_profiles SET is_available=COALESCE($2,is_available),blood_group=COALESCE($3,blood_group),city=COALESCE($4,city),state=COALESCE($5,state),contact_preference=COALESCE($6,contact_preference),updated_at=now() WHERE id=$1 RETURNING id",[m[1],b.isAvailable??null,b.bloodGroup&&GROUPS.includes(b.bloodGroup)?b.bloodGroup:null,b.city?text(b.city,100):null,b.state?text(b.state,100):null,['enquiry','phone','hidden'].includes(b.contactPreference)?b.contactPreference:null]); return send(res,200,{donor:r.rows[0]});
  }

  if(p==='/api/requests' && method==='GET') { const r=await pool.query("SELECT r.id,r.patient_name,r.blood_group,r.units_required,r.hospital_name,r.city,r.state,r.required_date,r.urgency,r.description,r.status,r.created_at,u.full_name AS requester_name FROM blood_requests r JOIN users u ON u.id=r.requester_id WHERE r.status IN ('open','in_progress') ORDER BY CASE r.urgency WHEN 'critical' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END,r.created_at DESC LIMIT 100"); return send(res,200,{requests:r.rows}); }
  if(p==='/api/requests' && method==='POST') {
    const u=await authenticate(req,res);if(!u)return;const b=await body(req);
    if(!text(b.patientName,120)||!GROUPS.includes(b.bloodGroup)||!Number.isInteger(Number(b.unitsRequired))||Number(b.unitsRequired)<1||Number(b.unitsRequired)>100||!text(b.hospitalName,180)||!text(b.city,100)||!text(b.state,100)||!validDate(b.requiredDate)||!validPhone(text(b.contactNumber,20))||!['normal','urgent','critical'].includes(b.urgency))return fail(res,400,'Complete all required fields with valid values.');
    const r=await pool.query('INSERT INTO blood_requests(requester_id,patient_name,blood_group,units_required,hospital_name,city,state,required_date,contact_number,urgency,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',[u.id,text(b.patientName,120),b.bloodGroup,Number(b.unitsRequired),text(b.hospitalName,180),text(b.city,100),text(b.state,100),b.requiredDate,text(b.contactNumber,20),b.urgency,text(b.description,1500)]);
    return send(res,201,{id:r.rows[0].id,requestId:r.rows[0].id,message:'Blood request submitted.'});
  }
  if(p==='/api/requests/my' && method==='GET') {const u=await authenticate(req,res);if(!u)return;const r=await pool.query('SELECT * FROM blood_requests WHERE requester_id=$1 ORDER BY created_at DESC',[u.id]);return send(res,200,{requests:r.rows});}
  m=p.match(/^\/api\/requests\/([\w-]+)$/);
  if(m && method==='GET'){const r=await pool.query('SELECT id,requester_id,patient_name,blood_group,units_required,hospital_name,city,state,required_date,urgency,description,status,created_at FROM blood_requests WHERE id=$1',[m[1]]);return r.rowCount?send(res,200,{request:r.rows[0]}):fail(res,404,'Request not found.');}
  if(m && ['PUT','DELETE'].includes(method)) {const u=await authenticate(req,res);if(!u)return;const q=await pool.query('SELECT requester_id,status FROM blood_requests WHERE id=$1',[m[1]]);if(!q.rowCount)return fail(res,404,'Request not found.');if(!only(res,u,q.rows[0].requester_id))return;
    if(method==='DELETE'){await pool.query("UPDATE blood_requests SET status='cancelled' WHERE id=$1",[m[1]]);return send(res,200,{message:'Request cancelled.'});}
    const b=await body(req);if(!['open','cancelled'].includes(b.status))return fail(res,400,'You can reopen or cancel your request.');await pool.query('UPDATE blood_requests SET status=$2 WHERE id=$1',[m[1],b.status]);return send(res,200,{message:'Request updated.'});
  }
  if(p==='/api/enquiries' && method==='POST') {const u=await authenticate(req,res);if(!u)return;const b=await body(req);const d=await pool.query('SELECT id FROM donor_profiles WHERE user_id=$1 AND is_active AND is_available',[u.id]);if(!d.rowCount)return fail(res,403,'Create an active donor profile before responding to requests.');const reqs=await pool.query("SELECT id,requester_id,blood_group FROM blood_requests WHERE id=$1 AND status IN ('open','in_progress')",[b.requestId]);if(!reqs.rowCount)return fail(res,404,'Open request not found.');const donor=await pool.query('SELECT blood_group FROM donor_profiles WHERE id=$1',[d.rows[0].id]);if(donor.rows[0].blood_group!==reqs.rows[0].blood_group)return fail(res,400,'This request does not match your listed blood group.');try{const r=await pool.query('INSERT INTO donation_enquiries(request_id,donor_id,requester_id,message) VALUES($1,$2,$3,$4) RETURNING id',[b.requestId,d.rows[0].id,reqs.rows[0].requester_id,text(b.message,1000)]);await pool.query('INSERT INTO notifications(user_id,message) VALUES($1,$2)',[reqs.rows[0].requester_id,'A donor responded to your blood request.']);return send(res,201,{id:r.rows[0].id,message:'Your enquiry was sent.'});}catch(e){if(e.code==='23505')return fail(res,409,'You have already responded to this request.');throw e;}}
  if(p==='/api/enquiries/my' && method==='GET'){const u=await authenticate(req,res);if(!u)return;const r=await pool.query("SELECT e.id,e.message,e.status,e.created_at,r.id AS request_id,r.patient_name,r.blood_group,r.requester_id,d.user_id AS donor_user_id,du.full_name AS donor_name,ru.full_name AS requester_name FROM donation_enquiries e JOIN blood_requests r ON r.id=e.request_id JOIN donor_profiles d ON d.id=e.donor_id JOIN users du ON du.id=d.user_id JOIN users ru ON ru.id=e.requester_id WHERE e.requester_id=$1 OR d.user_id=$1 ORDER BY e.created_at DESC",[u.id]);return send(res,200,{enquiries:r.rows});}
  m=p.match(/^\/api\/enquiries\/([\w-]+)\/status$/);if(m&&method==='PUT'){const u=await authenticate(req,res);if(!u)return;const b=await body(req);if(!['accepted','declined'].includes(b.status))return fail(res,400,'Choose accepted or declined.');const r=await pool.query('SELECT requester_id FROM donation_enquiries WHERE id=$1',[m[1]]);if(!r.rowCount)return fail(res,404,'Enquiry not found.');if(!only(res,u,r.rows[0].requester_id))return;await pool.query('UPDATE donation_enquiries SET status=$2 WHERE id=$1',[m[1],b.status]);return send(res,200,{message:'Enquiry status updated.'});}

  if(p==='/api/dashboard'&&method==='GET'){const u=await authenticate(req,res);if(!u)return;const [donor,requests,enquiries,notifications]=await Promise.all([pool.query('SELECT * FROM donor_profiles WHERE user_id=$1',[u.id]),pool.query('SELECT * FROM blood_requests WHERE requester_id=$1 ORDER BY created_at DESC',[u.id]),pool.query("SELECT e.id,e.message,e.status,e.created_at,e.requester_id,r.patient_name,r.blood_group,d.user_id AS donor_user_id FROM donation_enquiries e JOIN blood_requests r ON r.id=e.request_id JOIN donor_profiles d ON d.id=e.donor_id WHERE e.requester_id=$1 OR d.user_id=$1 ORDER BY e.created_at DESC",[u.id]),pool.query('SELECT id,message,is_read,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20',[u.id])]);return send(res,200,{user:u,donor:donor.rows[0]||null,requests:requests.rows,enquiries:enquiries.rows,notifications:notifications.rows});}

  if(p==='/api/admin/dashboard'&&method==='GET'){const u=await admin(req,res);if(!u)return;const r=await pool.query("SELECT (SELECT count(*)::int FROM users) users,(SELECT count(*)::int FROM donor_profiles) donors,(SELECT count(*)::int FROM blood_requests) requests,(SELECT count(*)::int FROM reports WHERE status='open') open_reports");return send(res,200,{stats:r.rows[0]});}
  if(p==='/api/admin/users'&&method==='GET'){if(!await admin(req,res))return;const r=await pool.query('SELECT id,full_name,email,phone,city,state,role,created_at FROM users ORDER BY created_at DESC LIMIT 500');return send(res,200,{users:r.rows});}
  if(p==='/api/admin/requests'&&method==='GET'){if(!await admin(req,res))return;const r=await pool.query('SELECT * FROM blood_requests ORDER BY created_at DESC LIMIT 500');return send(res,200,{requests:r.rows});}
  if(p==='/api/admin/donors'&&method==='GET'){if(!await admin(req,res))return;const r=await pool.query('SELECT d.id,d.blood_group,d.city,d.state,d.is_available,d.is_active,d.contact_preference,u.full_name,u.email FROM donor_profiles d JOIN users u ON u.id=d.user_id ORDER BY d.created_at DESC LIMIT 500');return send(res,200,{donors:r.rows});}
  m=p.match(/^\/api\/admin\/requests\/([\w-]+)\/status$/);if(m&&method==='PUT'){if(!await admin(req,res))return;const b=await body(req);if(!['open','in_progress','fulfilled','cancelled','rejected'].includes(b.status))return fail(res,400,'Invalid request status.');const r=await pool.query('UPDATE blood_requests SET status=$2 WHERE id=$1 RETURNING id',[m[1],b.status]);return r.rowCount?send(res,200,{message:'Request status updated.'}):fail(res,404,'Request not found.');}
  m=p.match(/^\/api\/admin\/donors\/([\w-]+)\/active$/);if(m&&method==='PUT'){if(!await admin(req,res))return;const b=await body(req);if(typeof b.active!=='boolean')return fail(res,400,'active must be true or false.');const r=await pool.query('UPDATE donor_profiles SET is_active=$2,updated_at=now() WHERE id=$1 RETURNING id',[m[1],b.active]);return r.rowCount?send(res,200,{message:'Donor profile updated.'}):fail(res,404,'Donor profile not found.');}
  if(p==='/api/admin/reports'&&method==='GET'){if(!await admin(req,res))return;const r=await pool.query('SELECT * FROM reports ORDER BY created_at DESC LIMIT 500');return send(res,200,{reports:r.rows});}
  if(p==='/api/reports'&&method==='POST'){const u=await authenticate(req,res);if(!u)return;const b=await body(req);const reason=text(b.reason,1000);if(!reason||!b.requestId)return fail(res,400,'Choose a request and provide a report reason.');const q=await pool.query('SELECT id FROM blood_requests WHERE id=$1',[b.requestId]);if(!q.rowCount)return fail(res,404,'Request not found.');const r=await pool.query('INSERT INTO reports(reported_by,request_id,reason) VALUES($1,$2,$3) RETURNING id',[u.id,b.requestId,reason]);return send(res,201,{id:r.rows[0].id,message:'Report submitted for review.'});}
  m=p.match(/^\/api\/admin\/reports\/([\w-]+)\/status$/);if(m&&method==='PUT'){if(!await admin(req,res))return;const b=await body(req);if(!['reviewed','dismissed'].includes(b.status))return fail(res,400,'Choose reviewed or dismissed.');const r=await pool.query('UPDATE reports SET status=$2 WHERE id=$1 RETURNING id',[m[1],b.status]);return r.rowCount?send(res,200,{message:'Report status updated.'}):fail(res,404,'Report not found.');}
  return fail(res,404,'API endpoint not found.');
}

const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Credentials':'true'});return res.end();}
    if(url.pathname.startsWith('/api/')) return await route(req,res,url);
    let pathname=decodeURIComponent(url.pathname);if(pathname==='/')pathname='/index.html';
    const file=path.resolve(ROOT,'frontend',`.${pathname}`);if(!file.startsWith(path.resolve(ROOT,'frontend')+path.sep))return fail(res,403,'Forbidden.');
    fs.readFile(file,(err,data)=>{if(err){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Page not found');}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"});res.end(data);});
  } catch(e) {
    if (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'EHOSTUNREACH') {
      console.error(`PostgreSQL connection failed (${e.code})`);
      if (!res.headersSent) send(res, 503, { error: 'BloodLink cannot reach PostgreSQL. Start the PostgreSQL service, create the bloodlink database, apply database/schema.sql, and check DATABASE_URL in .env. See README.md for Windows setup.' });
      else res.end();
      return;
    }
    console.error(e);
    if(!res.headersSent)send(res,e.status||500,{error:e.status?e.message:'The server could not complete this request.'});else res.end();
  }
});
const port=Number(process.env.PORT)||3000;
server.listen(port,()=>console.log(`BloodLink listening on http://localhost:${port}`));
process.on('SIGINT',async()=>{await pool.end();server.close(()=>process.exit(0));});
