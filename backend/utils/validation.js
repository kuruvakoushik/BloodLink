const GROUPS = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];
function text(value, max = 200) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254; }
function validPhone(value) { return /^[+\d][\d\s()-]{7,19}$/.test(value); }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)); }
module.exports = { GROUPS, text, validEmail, validPhone, validDate };
