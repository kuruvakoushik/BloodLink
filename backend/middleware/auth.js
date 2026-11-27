const crypto = require('node:crypto');
const { pool } = require('../database');
const { send } = require('../utils/responses');
function cookie(req, key) {
  const header = req.headers.cookie || '';
  const part = header.split(';').map(v => v.trim()).find(v => v.startsWith(key + '='));
  return part ? decodeURIComponent(part.slice(key.length + 1)) : '';
}
async function authenticate(req, res) {
  const token = cookie(req, 'bloodlink_session');
  if (!token) { send(res, 401, { error: 'Please sign in to continue.' }); return null; }
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const result = await pool.query('SELECT u.id,u.full_name,u.email,u.phone,u.city,u.state,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()', [hash]);
  if (!result.rowCount) { send(res, 401, { error: 'Your session has expired. Please sign in again.' }); return null; }
  return result.rows[0];
}
async function admin(req, res) {
  const user = await authenticate(req, res);
  if (user && user.role !== 'admin') { send(res, 403, { error: 'Administrator access required.' }); return null; }
  return user;
}
module.exports = { authenticate, admin, cookie };
